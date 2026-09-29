// Story 4.1 / 4.2: one contract suite for every StorageBackend. The local
// backend runs it in `npm test` (scripts/storage.test.mjs) against a temp
// directory; the S3 backend runs it in the `s3` CI job
// (`npm run test:s3`, scripts/storage-s3.contract.mjs) against a real
// S3-compatible server. Both must give the same results.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';

const { StorageError } = await import('../src/modules/storage/errors.ts');
const { storageKeys } = await import('../src/modules/storage/keys.ts');

const md5 = (buf) => createHash('md5').update(buf).digest('hex');

async function readAll(stream) {
  const chunks = [];
  for await (const c of stream) chunks.push(Buffer.from(c));
  return Buffer.concat(chunks);
}

async function rejectsWith(promise, code) {
  await assert.rejects(promise, (err) => {
    assert.ok(err instanceof StorageError, `a StorageError, got ${err?.name}: ${err?.message}`);
    assert.equal(err.code, code);
    return true;
  });
}

/**
 * Registers the contract tests for one backend. `make()` answers the backend
 * (called once); `partSize` is the size of every part but the last (S3
 * requires at least 5 MiB there).
 */
export function storageContract(name, make, { partSize = 64 * 1024 } = {}) {
  let backend;
  const backendOf = async () => (backend ??= await make());
  const fileId = () => randomUUID();

  test(`${name}: putStream, stat, exists, getStream whole and ranged, delete idempotent`, async () => {
    const b = await backendOf();
    const key = storageKeys.original(fileId(), 'bin');
    const data = randomBytes(1000);
    const put = await b.putStream(key, Readable.from(data), { contentType: 'application/octet-stream', size: data.length });
    assert.equal(put.size, 1000);
    assert.equal((await b.stat(key)).size, 1000);
    assert.equal(await b.exists(key), true);
    assert.deepEqual(await readAll(await b.getStream(key)), data);
    const part = await readAll(await b.getStream(key, { start: 100, end: 199 }));
    assert.equal(part.length, 100);
    assert.deepEqual(part, data.subarray(100, 200));
    await b.delete(key);
    assert.equal(await b.exists(key), false);
    await b.delete(key); // deleting again is not an error
  });

  test(`${name}: a missing key answers NOT_FOUND`, async () => {
    const b = await backendOf();
    const key = storageKeys.original(fileId(), 'mp4');
    await rejectsWith(b.stat(key), 'NOT_FOUND');
    await rejectsWith(b.getStream(key), 'NOT_FOUND');
    assert.equal(await b.exists(key), false);
  });

  test(`${name}: unsafe keys are refused`, async () => {
    const b = await backendOf();
    for (const key of ['../etc/passwd', '/abs/key', 'files/../../x', 'a\\b', '.parts/x', '']) {
      await rejectsWith(b.stat(key), 'INVALID_KEY');
    }
  });

  test(`${name}: multipart round trip, parts out of order, re-sent part replaces`, async () => {
    const b = await backendOf();
    const key = storageKeys.original(fileId(), 'bin');
    const whole = randomBytes(partSize * 2 + 1234);
    const parts = [whole.subarray(0, partSize), whole.subarray(partSize, partSize * 2), whole.subarray(partSize * 2)];
    const id = await b.beginUpload(key);
    const stored = [];
    stored[2] = await b.putPart(id, 3, Readable.from(parts[2]), parts[2].length, { md5: md5(parts[2]) });
    stored[0] = await b.putPart(id, 1, Readable.from(parts[0]), parts[0].length);
    // Part 2 twice: first with other bytes of the same size, then the real ones.
    await b.putPart(id, 2, Readable.from(randomBytes(partSize)), partSize);
    stored[1] = await b.putPart(id, 2, Readable.from(parts[1]), parts[1].length, { md5: md5(parts[1]) });
    const done = await b.completeUpload(id, stored);
    assert.equal(done.size, whole.length);
    if (done.md5) assert.equal(done.md5, md5(whole));
    assert.equal((await b.stat(key)).size, whole.length);
    assert.equal(md5(await readAll(await b.getStream(key))), md5(whole));
    const tail = await readAll(await b.getStream(key, { start: whole.length - 10, end: whole.length - 1 }));
    assert.deepEqual(tail, whole.subarray(whole.length - 10));
    await b.delete(key);
  });

  test(`${name}: a part with a wrong MD5 or size is refused`, async () => {
    const b = await backendOf();
    const key = storageKeys.original(fileId(), 'bin');
    const id = await b.beginUpload(key);
    const bytes = randomBytes(1024);
    await rejectsWith(b.putPart(id, 1, Readable.from(bytes), bytes.length, { md5: md5(randomBytes(8)) }), 'CHECKSUM_MISMATCH');
    await rejectsWith(b.putPart(id, 1, Readable.from(bytes), bytes.length + 10), 'PART_SIZE_MISMATCH');
    await rejectsWith(b.putPart(id, 1, Readable.from(bytes), bytes.length - 10), 'PART_SIZE_MISMATCH');
    await b.abortUpload(id);
  });

  test(`${name}: abort removes staged parts; completing afterwards fails`, async () => {
    const b = await backendOf();
    const key = storageKeys.original(fileId(), 'bin');
    const id = await b.beginUpload(key);
    const bytes = randomBytes(2048);
    const p = await b.putPart(id, 1, Readable.from(bytes), bytes.length);
    await b.abortUpload(id);
    await b.abortUpload(id); // idempotent
    await assert.rejects(b.completeUpload(id, [p]));
    assert.equal(await b.exists(key), false);
  });

  test(`${name}: an empty file is one empty part`, async () => {
    const b = await backendOf();
    const key = storageKeys.original(fileId(), 'txt');
    const id = await b.beginUpload(key);
    const p = await b.putPart(id, 1, Readable.from([]), 0);
    const done = await b.completeUpload(id, [p]);
    assert.equal(done.size, 0);
    assert.equal((await b.stat(key)).size, 0);
    await rejectsWith(b.getStream(key, { start: 0, end: 0 }), 'INVALID_RANGE');
    await b.delete(key);
  });

  test(`${name}: copy, move, probe, withLocalInput`, async () => {
    const b = await backendOf();
    const a = storageKeys.original(fileId(), 'jpg');
    const c = storageKeys.original(fileId(), 'jpg');
    const d = storageKeys.thumbnail(fileId(), 1);
    const data = randomBytes(4096);
    await b.putStream(a, Readable.from(data), { size: data.length });
    await b.copy(a, c);
    assert.deepEqual(await readAll(await b.getStream(c)), data);
    await b.move(c, d);
    assert.equal(await b.exists(c), false);
    assert.deepEqual(await readAll(await b.getStream(d)), data);
    assert.deepEqual(await b.probe('write'), { ok: true });
    assert.deepEqual(await b.probe('read'), { ok: true });
    const input = await b.withLocalInput(a, async (i) => i);
    assert.equal(typeof input, 'string');
    assert.ok(input.length > 0);
    await b.delete(a);
    await b.delete(d);
  });
}
