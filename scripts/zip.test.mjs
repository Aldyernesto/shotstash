// Story 4.6: streamed ZIPs on yazl. STORE entries, declared sizes, the
// missing-files list and a mid-stream failure that never ends the archive.
// The ZIP64 case (an entry above 4 GiB) runs in CI through zip64-check.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';

const { zipStream, MISSING_FILES_NAME } = await import('../src/modules/media/zip.ts');

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
  const buf = await collect(zipStream([{ key: 'k/a', name: 'Shoot/a.bin' }, { key: 'k/b', name: 'Shoot/b.txt' }], src, { emptyDirs: ['Shoot/Empty'] }));
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

test('zip: objects that cannot be read are listed in _MISSING_FILES.txt at the end', async () => {
  const src = memorySource(new Map([['k/a', Buffer.from('x')], ['k/c', Buffer.from('y')]]));
  const buf = await collect(zipStream([{ key: 'k/a', name: 'a.txt' }, { key: 'k/gone', name: 'gone.mov' }, { key: 'k/c', name: 'c.txt' }], src));
  const names = readCentralDirectory(buf).map((e) => e.name);
  assert.deepEqual(names, ['a.txt', 'c.txt', MISSING_FILES_NAME]);
  assert.ok(buf.includes(Buffer.from('  - gone.mov')));
});

test('zip: the response starts before later entries are checked; each stat comes just before its entry', async () => {
  const order = [];
  const objects = new Map([['k/1', Buffer.alloc(10, 1)], ['k/2', Buffer.alloc(10, 2)], ['k/3', Buffer.alloc(10, 3)]]);
  const src = {
    async stat(key) {
      order.push(`stat ${key}`);
      return { size: objects.get(key).length };
    },
    async getStream(key) {
      order.push(`read ${key}`);
      return Readable.from([objects.get(key)]);
    },
  };
  const stream = zipStream([{ key: 'k/1', name: '1' }, { key: 'k/2', name: '2' }, { key: 'k/3', name: '3' }], src);
  await collect(stream);
  // Never all stats up front: the stat of entry n+1 follows the start of entry n.
  assert.deepEqual(order, ['stat k/1', 'read k/1', 'stat k/2', 'read k/2', 'stat k/3', 'read k/3']);
});

test('zip: entries carry the given mtime', async () => {
  const src = memorySource(new Map([['k', Buffer.from('x')]]));
  const when = new Date(Date.UTC(2024, 0, 2, 3, 4, 6));
  const buf = await collect(zipStream([{ key: 'k', name: 'x.txt', mtime: when }], src));
  // Info-ZIP universal timestamp (0x5455): flags byte, then mtime seconds.
  const ut = buf.indexOf(Buffer.from([0x55, 0x54]));
  assert.ok(ut > 0);
  assert.equal(buf.readUInt32LE(ut + 5), Math.floor(when.getTime() / 1000));
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
  const stream = zipStream([{ key: 'k', name: 'big.mov' }], src, { onError: (e) => (reported = e) });
  const chunks = [];
  await assert.rejects(async () => {
    for await (const c of stream) chunks.push(c);
  }, /backend dropped/);
  assert.ok(reported);
  const buf = Buffer.concat(chunks);
  assert.equal(buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06])), -1, 'no end of central directory');
});

test('zip: a size that differs from the declared one fails the archive', async () => {
  const src = { stat: async () => ({ size: 50 }), getStream: async () => Readable.from([Buffer.from('short')]) };
  const stream = zipStream([{ key: 'k', name: 'x.bin' }], src);
  await assert.rejects(collect(stream), /unexpected number of bytes/);
});
