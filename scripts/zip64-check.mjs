// Story 4.6 (CI): a ZIP with one synthetic entry above 4 GiB, built by the
// same code as share and dashboard ZIPs, must pass `unzip -t` and show its
// full size in `zipinfo`. Writes to a temporary file (the product never
// does) and removes it afterwards.
//
//   node scripts/zip64-check.mjs            4.1 GiB entry
//   ZIP64_CHECK_MB=64 node scripts/zip64-check.mjs   quick local run
import { createWriteStream, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { execFileSync } from 'node:child_process';

const { buildZipStream } = await import('../src/modules/media/zip.ts');

const MIB = 1024 * 1024;
const size = process.env.ZIP64_CHECK_MB ? Number(process.env.ZIP64_CHECK_MB) * MIB : Math.round(4.1 * 1024) * MIB;
const CHUNK = Buffer.alloc(4 * MIB, 0x5a);

function synthetic(total) {
  let left = total;
  return new Readable({
    read() {
      if (left <= 0) return this.push(null);
      const n = Math.min(left, CHUNK.length);
      left -= n;
      this.push(n === CHUNK.length ? CHUNK : CHUNK.subarray(0, n));
    },
  });
}

const dir = mkdtempSync(path.join(tmpdir(), 'shotstash-zip64-'));
const file = path.join(dir, 'big.zip');
try {
  const started = Date.now();
  const stream = buildZipStream({
    present: [
      { key: 'big', name: 'Shoot/big.mov', size },
      { key: 'small', name: 'Shoot/small.txt', size: 5 },
    ],
    missing: ['Shoot/gone.jpg'],
    source: {
      async getStream(key) {
        return key === 'big' ? synthetic(size) : Readable.from([Buffer.from('hello')]);
      },
    },
  });
  await pipeline(stream, createWriteStream(file));
  console.log(`zip written: ${statSync(file).size} bytes in ${Math.round((Date.now() - started) / 1000)} s`);

  const test = execFileSync('unzip', ['-t', file], { encoding: 'utf8' });
  if (!/No errors detected/.test(test)) throw new Error(`unzip -t failed:\n${test}`);
  console.log(test.trim().split('\n').slice(-1)[0]);

  const info = execFileSync('zipinfo', [file], { encoding: 'utf8' });
  console.log(info.trim());
  const line = info.split('\n').find((l) => l.endsWith('Shoot/big.mov'));
  if (!line || !line.includes(String(size))) throw new Error(`zipinfo does not show ${size} bytes for the big entry`);
  if (!/ stor /.test(line)) throw new Error('the big entry is not stored (STORE mode)');
  if (!info.includes('_MISSING_FILES.txt')) throw new Error('missing-files list absent');
  console.log(`ZIP64 check passed (${size} byte entry)`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
