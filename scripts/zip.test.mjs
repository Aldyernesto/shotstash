// Story 4.6: streamed ZIPs on yazl. STORE entries, declared sizes, the
// missing-files list and a mid-stream failure that never ends the archive.
// The ZIP64 case (an entry above 4 GiB) runs in CI through zip64-check.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';

const { planZipEntries, buildZipStream, zipStream, MISSING_FILES_NAME } = await import('../src/modules/media/zip.ts');

function memorySource(objects) {
  return {
    async stat(key) {
      if (!objects.has(key)) throw Object.assign(new Error('missing'), { code: 'NOT_FOUND' });
      return { size: objects.get(key).length };
    },
    async getStream(key) {
      if (!objects.has(key)) throw new Error('missing');
      return Readable.from([objects.get(key)]);
    },
  };
}

async function collect(stream) {
  const chunks = [];
  for await (const c of stream) chunks.push(c);
  return Buffer.concat(chunks);
}

/** Minimal central-directory reader: name, method, sizes. */
function readCentralDirectory(buf) {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(eocd >= 0, 'end of central directory record present');
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const out = [];
  for (let i = 0; i < count; i++) {
    assert.equal(buf.readUInt32LE(off), 0x02014b50);
    const method = buf.readUInt16LE(off + 10);
    const compressed = buf.readUInt32LE(off + 20);
    const size = buf.readUInt32LE(off + 24);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localOffset = buf.readUInt32LE(off + 42);
    const name = buf.subarray(off + 46, off + 46 + nameLen).toString('utf8');
    out.push({ name, method, compressed, size, localOffset });
    off += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

test('zip: entries are stored uncompressed with their declared sizes', async () => {
  const a = Buffer.alloc(5000, 7);
  const b = Buffer.from('hello world');
  const src = memorySource(new Map([['k/a', a], ['k/b', b]]));
  const buf = await collect(await zipStream([{ key: 'k/a', name: 'Shoot/a.bin' }, { key: 'k/b', name: 'Shoot/b.txt' }], src, { emptyDirs: ['Shoot/Empty'] }));
  const entries = readCentralDirectory(buf);
  const files = entries.filter((e) => !e.name.endsWith('/'));
  assert.deepEqual(files.map((e) => e.name), ['Shoot/a.bin', 'Shoot/b.txt']);
  for (const e of files) {
    assert.equal(e.method, 0, 'STORE');
    assert.equal(e.compressed, e.size);
  }
  assert.equal(files[0].size, 5000);
  assert.ok(entries.some((e) => e.name === 'Shoot/Empty/'));
  // Stored bytes appear verbatim.
  assert.ok(buf.includes(b));
  assert.equal(entries.some((e) => e.name === MISSING_FILES_NAME), false);
});

test('zip: objects that cannot be read are listed in _MISSING_FILES.txt', async () => {
  const src = memorySource(new Map([['k/a', Buffer.from('x')]]));
  const plan = await planZipEntries([{ key: 'k/a', name: 'a.txt' }, { key: 'k/gone', name: 'gone.mov' }], src);
  assert.deepEqual(plan.present.map((e) => e.name), ['a.txt']);
  assert.deepEqual(plan.missing, ['gone.mov']);
  const buf = await collect(buildZipStream({ ...plan, source: src }));
  const names = readCentralDirectory(buf).map((e) => e.name);
  assert.deepEqual(names, ['a.txt', MISSING_FILES_NAME]);
  assert.ok(buf.includes(Buffer.from('  - gone.mov')));
});

test('zip: planning keeps the input order with bounded concurrency', async () => {
  let inFlight = 0;
  let peak = 0;
  const entries = Array.from({ length: 30 }, (_, i) => ({ key: `k/${i}`, name: `${i}.bin` }));
  const src = {
    async stat(key) {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 2));
      inFlight--;
      return { size: Number(key.split('/')[1]) };
    },
  };
  const plan = await planZipEntries(entries, src, 4);
  assert.ok(peak <= 4, `peak ${peak}`);
  assert.deepEqual(plan.present.map((e) => e.size), entries.map((_, i) => i));
});

test('zip: a stream that fails mid-entry destroys the archive (no end record)', async () => {
  const src = {
    async stat() {
      return { size: 1000 };
    },
    async getStream() {
      let sent = false;
      return new Readable({
        read() {
          if (sent) return;
          sent = true;
          this.push(Buffer.alloc(100, 1));
          setImmediate(() => this.destroy(new Error('backend dropped the connection')));
        },
      });
    },
  };
  let reported = null;
  const stream = buildZipStream({ present: [{ key: 'k', name: 'big.mov', size: 1000 }], missing: [], source: src, onError: (e) => (reported = e) });
  const chunks = [];
  await assert.rejects(async () => {
    for await (const c of stream) chunks.push(c);
  }, /backend dropped/);
  assert.ok(reported);
  const buf = Buffer.concat(chunks);
  assert.equal(buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06])), -1, 'no end of central directory');
});

test('zip: a size that differs from the declared one fails the archive', async () => {
  const src = memorySource(new Map([['k', Buffer.from('short')]]));
  const stream = buildZipStream({ present: [{ key: 'k', name: 'x.bin', size: 50 }], missing: [], source: src });
  await assert.rejects(collect(stream), /unexpected number of bytes/);
});
