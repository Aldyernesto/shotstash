// Story 4.2: the S3 backend against the shared contract, on a real
// S3-compatible server, plus a Range and ZIP smoke through the media
// module. Not part of `npm test` (it needs a server): `npm run test:s3`,
// run by the `s3` CI job against RustFS.
//
//   docker run -d --name rustfs -p 9000:9000 \
//     -e RUSTFS_ACCESS_KEY=shotstash -e RUSTFS_SECRET_KEY=shotstash-secret rustfs/rustfs:1.0.0
//   npm run test:s3
//
// S3_TEST_ENDPOINT (default http://127.0.0.1:9000), S3_TEST_BUCKET
// (default shotstash-test, created here), S3_TEST_ACCESS_KEY_ID,
// S3_TEST_SECRET_ACCESS_KEY, S3_TEST_REGION. Refuses anything but a local
// endpoint unless S3_TEST_ALLOW_REMOTE=true.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import { CreateBucketCommand } from '@aws-sdk/client-s3';
import { storageContract } from './storage-contract.mjs';

const endpoint = process.env.S3_TEST_ENDPOINT || 'http://127.0.0.1:9000';
const opts = {
  endpoint,
  region: process.env.S3_TEST_REGION || 'us-east-1',
  bucket: process.env.S3_TEST_BUCKET || 'shotstash-test',
  accessKeyId: process.env.S3_TEST_ACCESS_KEY_ID || 'shotstash',
  secretAccessKey: process.env.S3_TEST_SECRET_ACCESS_KEY || 'shotstash-secret',
  forcePathStyle: true,
};
const host = new URL(endpoint).hostname;
if (!['127.0.0.1', 'localhost', '::1'].includes(host) && process.env.S3_TEST_ALLOW_REMOTE !== 'true') {
  console.error(`test:s3 refuses to run against ${endpoint}: set S3_TEST_ALLOW_REMOTE=true for a remote server.`);
  process.exit(2);
}

// The media module reads its backend from the configuration.
Object.assign(process.env, {
  STORAGE_BACKEND: 's3',
  S3_ENDPOINT: opts.endpoint,
  S3_REGION: opts.region,
  S3_BUCKET: opts.bucket,
  S3_ACCESS_KEY_ID: opts.accessKeyId,
  S3_SECRET_ACCESS_KEY: opts.secretAccessKey,
  S3_FORCE_PATH_STYLE: 'true',
  DATABASE_URL: process.env.DATABASE_URL || 'postgresql://unused@127.0.0.1:5432/unused',
  SESSION_SECRET: process.env.SESSION_SECRET || 's'.repeat(64),
  LOG_LEVEL: 'silent',
});

const { S3Backend } = await import('../src/modules/storage/s3.ts');
const { storageKeys } = await import('../src/modules/storage/keys.ts');
const backend = new S3Backend(opts);

before(async () => {
  try {
    await backend.client.send(new CreateBucketCommand({ Bucket: opts.bucket }));
  } catch (err) {
    if (!['BucketAlreadyOwnedByYou', 'BucketAlreadyExists'].includes(err?.name)) throw err;
  }
});

storageContract('s3', () => backend, { partSize: 5 * 1024 * 1024 });

test('s3: a missing bucket or endpoint is reported by probe, never thrown', async () => {
  const gone = new S3Backend({ ...opts, bucket: `missing-${randomBytes(4).toString('hex')}` });
  const r = await gone.probe('read');
  assert.equal(r.ok, false);
  const down = new S3Backend({ ...opts, endpoint: 'http://127.0.0.1:9' });
  assert.equal((await down.probe('read')).ok, false);
});

test('s3: the configured backend comes from the environment; MD5 and head of an assembled object', async () => {
  const { createConfiguredBackend, objectMd5, readHead } = await import('../src/modules/storage/backend.ts');
  const configured = createConfiguredBackend();
  assert.equal(configured.name, 's3');
  assert.equal(configured.bucket, opts.bucket);
  const { createHash } = await import('node:crypto');
  const key = storageKeys.original('0192a4f1-0000-7000-8000-0000000000cc', 'bin');
  const part = 5 * 1024 * 1024;
  const whole = Buffer.concat([Buffer.from('%PDF-1.7'), randomBytes(part + 1000 - 8)]);
  const id = await configured.beginUpload(key);
  const p1 = await configured.putPart(id, 1, Readable.from(whole.subarray(0, part)), part);
  const p2 = await configured.putPart(id, 2, Readable.from(whole.subarray(part)), whole.length - part);
  await configured.completeUpload(id, [p1, p2]);
  assert.equal(await objectMd5(key, configured), createHash('md5').update(whole).digest('hex'));
  const head = await readHead(key, 4100, configured);
  assert.equal(head.length, 4100);
  assert.equal(head.subarray(0, 8).toString(), '%PDF-1.7');
  await configured.delete(key);
});

test('s3: Range and ZIP through the media module', async () => {
  const { fileResponse, zipResponse } = await import('../src/modules/media/stream.ts');
  const { setStorageForTests } = await import('../src/modules/storage/backend.ts');
  setStorageForTests(backend);
  const id = '0192a4f1-0000-7000-8000-0000000000aa';
  const key = storageKeys.original(id, 'bin');
  const data = randomBytes(1000);
  await backend.putStream(key, Readable.from(data), { size: data.length });

  const ranged = await fileResponse({
    req: new Request('http://x/media/d/x', { headers: { range: 'bytes=100-199' } }),
    key,
    mimeType: 'application/octet-stream',
    cache: 'cookie',
  });
  assert.equal(ranged.status, 206);
  assert.equal(ranged.headers.get('content-range'), 'bytes 100-199/1000');
  const body = Buffer.from(await ranged.arrayBuffer());
  assert.deepEqual(body, data.subarray(100, 200));

  const bad = await fileResponse({
    req: new Request('http://x/media/d/x', { headers: { range: 'bytes=5000-' } }),
    key,
    mimeType: 'application/octet-stream',
    cache: 'cookie',
  });
  assert.equal(bad.status, 416);

  const zip = await zipResponse({
    entries: [
      { key, name: 'Section/one.bin' },
      { key: storageKeys.original('0192a4f1-0000-7000-8000-0000000000bb', 'bin'), name: 'Section/missing.bin' },
    ],
    zipName: 'Section.zip',
    cache: 'signed',
  });
  assert.equal(zip.headers.get('content-type'), 'application/zip');
  const bytes = Buffer.from(await zip.arrayBuffer());
  assert.equal(bytes.readUInt32LE(0), 0x04034b50, 'starts with a local file header');
  assert.ok(bytes.includes(Buffer.from('Section/one.bin')));
  assert.ok(bytes.includes(Buffer.from('_MISSING_FILES.txt')), 'the missing object is listed');
  assert.ok(bytes.includes(data.subarray(0, 64)) || bytes.length > 1000, 'the object bytes are in the archive');
  await backend.delete(key);
  setStorageForTests(null);
});
