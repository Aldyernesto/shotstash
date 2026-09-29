// Stories 4.1-4.3: the local storage backend against the shared contract,
// plus key validation, part size maths, MIME sniffing and the source rules
// (no media paths or storage reads outside their modules).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { storageContract } from './storage-contract.mjs';

const { LocalDiskBackend } = await import('../src/modules/storage/local.ts');
const { assertSafeKey, isSafeKey, storageKeys } = await import('../src/modules/storage/keys.ts');
const { partPlan, expectedPartSize, MIB } = await import('../src/modules/storage/partSize.ts');
const { sniffMime, sniffType, extensionFor, mimeFromName } = await import('../src/modules/storage/mime.ts');
const { md5Hex } = await import('../src/modules/storage/meter.ts');

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const dir = mkdtempSync(path.join(tmpdir(), 'shotstash-storage-'));
after(() => rmSync(dir, { recursive: true, force: true }));

storageContract('local', () => new LocalDiskBackend(dir));

test('local: staged parts live under .parts and go away after completion', async () => {
  const b = new LocalDiskBackend(dir);
  const { Readable } = await import('node:stream');
  const key = storageKeys.original('0192a4f1-0000-7000-8000-000000000001', 'bin');
  const id = await b.beginUpload(key);
  assert.ok(existsSync(path.join(dir, '.parts', id)));
  const p = await b.putPart(id, 1, Readable.from([Buffer.from('hello')]), 5);
  await b.completeUpload(id, [p]);
  assert.equal(existsSync(path.join(dir, '.parts', id)), false);
  assert.equal(readFileSync(path.join(dir, 'files', '0192a4f1-0000-7000-8000-000000000001', 'original.bin'), 'utf8'), 'hello');
  await b.delete(key);
  // The now-empty file directory is pruned, the root stays.
  assert.equal(existsSync(path.join(dir, 'files', '0192a4f1-0000-7000-8000-000000000001')), false);
  assert.ok(existsSync(dir));
});

test('local: a malformed upload id never reaches the file system', async () => {
  const b = new LocalDiskBackend(dir);
  const { Readable } = await import('node:stream');
  await assert.rejects(b.putPart('../../etc', 1, Readable.from([]), 0), (e) => e.code === 'INVALID_UPLOAD');
  await b.abortUpload('../..'); // ignored
  assert.ok(existsSync(dir));
});

test('local: the read probe needs the marker and never creates the root (unmounted NAS)', async () => {
  const fresh = mkdtempSync(path.join(tmpdir(), 'shotstash-probe-'));
  try {
    const empty = new LocalDiskBackend(fresh);
    assert.equal((await empty.probe('read')).ok, false, 'an empty mountpoint is not the storage root');
    assert.equal(existsSync(path.join(fresh, '.shotstash-storage')), false);
    assert.equal((await empty.probe('read', { init: true })).ok, true, 'before setup the root is initialised');
    assert.equal(existsSync(path.join(fresh, '.shotstash-storage')), true);
    assert.equal((await empty.probe('read')).ok, true);
    const missing = new LocalDiskBackend(path.join(fresh, 'not-mounted'));
    assert.equal((await missing.probe('read')).ok, false);
    assert.equal(existsSync(path.join(fresh, 'not-mounted')), false, 'the read probe created nothing');
  } finally {
    rmSync(fresh, { recursive: true, force: true });
  }
});

test('local: raw file system errors become StorageError', async () => {
  const b = new LocalDiskBackend(dir);
  const { Readable } = await import('node:stream');
  await assert.rejects(b.copy('files/nope/original.bin', 'files/x/original.bin'), (e) => e.name === 'StorageError' && e.code === 'NOT_FOUND');
  await assert.rejects(b.move('files/nope/original.bin', 'files/x/original.bin'), (e) => e.name === 'StorageError' && e.code === 'NOT_FOUND');
  const failing = new Readable({ read() { this.destroy(Object.assign(new Error('disk'), { code: 'EIO' })); } });
  await assert.rejects(b.putStream('files/y/original.bin', failing), (e) => e.name === 'StorageError' && e.code === 'UNAVAILABLE');
});

test('local: the sweeper removes old staging leftovers no live upload references', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'shotstash-staging-'));
  try {
    const b = new LocalDiskBackend(root);
    const { Readable } = await import('node:stream');
    const live = await b.beginUpload('files/a/original.bin');
    const dead = await b.beginUpload('files/b/original.bin');
    await b.putStream('files/c/original.bin', Readable.from([Buffer.from('x')]));
    const { writeFileSync, utimesSync } = await import('node:fs');
    writeFileSync(path.join(root, '.tmp', 'leftover'), 'x');
    const old = new Date(Date.now() - 72 * 3600 * 1000);
    for (const p of [path.join(root, '.tmp', 'leftover'), path.join(root, '.parts', live), path.join(root, '.parts', dead)]) utimesSync(p, old, old);
    const removed = await b.sweepStaging(new Date(Date.now() - 48 * 3600 * 1000), new Set([live]));
    assert.equal(removed, 2);
    assert.ok(existsSync(path.join(root, '.parts', live)));
    assert.equal(existsSync(path.join(root, '.parts', dead)), false);
    assert.equal(existsSync(path.join(root, '.tmp', 'leftover')), false);
    assert.ok(await b.exists('files/c/original.bin'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('local: capacity reports disk size and free space', async () => {
  const cap = await new LocalDiskBackend(dir).capacity();
  assert.ok(cap && cap.total > 0 && cap.free >= 0 && cap.free <= cap.total);
});

/* ---------------- keys ---------------- */

test('keys never encode hierarchy and are validated', () => {
  const id = '0192a4f1-0000-7000-8000-000000000002';
  assert.equal(storageKeys.original(id, 'MP4'), `files/${id}/original.mp4`);
  assert.equal(storageKeys.thumbnail(id, 3), `files/${id}/thumb-3.jpg`);
  assert.equal(storageKeys.processed(id, 'v1', 'mp4'), `files/${id}/proc/v1.mp4`);
  assert.equal(storageKeys.cover('project', id), `covers/project/${id}.jpg`);
  assert.throws(() => storageKeys.original('../x', 'mp4'));
  assert.throws(() => storageKeys.original(id, 'mp4/../../x'));
  assert.throws(() => storageKeys.thumbnail(id, 0));
  assert.throws(() => storageKeys.cover('team', id));
  for (const bad of ['', '/abs', 'a//b', 'a/../b', 'a/./b', 'a\\b', '.parts/x', 'x\0y', 'a/b c']) {
    assert.equal(isSafeKey(bad), false, JSON.stringify(bad));
  }
  assert.equal(assertSafeKey('files/a/original.mp4'), 'files/a/original.mp4');
});

/* ---------------- part size ---------------- */

test('part size: 16 MiB, raised for files that would need more than 10,000 parts', () => {
  assert.deepEqual(partPlan(0), { partSize: 16 * MIB, partCount: 1 });
  assert.deepEqual(partPlan(1), { partSize: 16 * MIB, partCount: 1 });
  assert.deepEqual(partPlan(16 * MIB), { partSize: 16 * MIB, partCount: 1 });
  assert.deepEqual(partPlan(16 * MIB + 1), { partSize: 16 * MIB, partCount: 2 });
  assert.deepEqual(partPlan(50 * MIB), { partSize: 16 * MIB, partCount: 4 });
  const twenty = 20 * 1024 ** 3;
  assert.deepEqual(partPlan(twenty), { partSize: 16 * MIB, partCount: 1280 });
  const huge = 1024 ** 4; // 1 TiB
  const plan = partPlan(huge);
  assert.ok(plan.partCount <= 10_000);
  assert.equal(plan.partSize % MIB, 0);
  assert.equal(plan.partSize, Math.ceil(Math.ceil(huge / 10_000) / MIB) * MIB);
  assert.throws(() => partPlan(-1));
  const p = { ...partPlan(50 * MIB), size: 50 * MIB };
  assert.equal(expectedPartSize(p, 1), 16 * MIB);
  assert.equal(expectedPartSize(p, 4), 2 * MIB);
  assert.equal(expectedPartSize(p, 5), -1);
  assert.equal(expectedPartSize(p, 0), -1);
});

/* ---------------- MIME ---------------- */

test('MIME sniffing: the extension comes from the bytes through one table', () => {
  const b = (...xs) => Uint8Array.from(xs);
  const ftyp = (brand) => Uint8Array.from([0, 0, 0, 0x18, ...Buffer.from('ftyp'), ...Buffer.from(brand), 0, 0, 0, 0, ...Buffer.from('isommp41')]);
  const rows = [
    [b(0xff, 0xd8, 0xff, 0xe0), 'x.bin', 'image/jpeg', 'jpg'],
    [b(0xff, 0xd8, 0xff, 0xe0), 'x.JPEG', 'image/jpeg', 'jpeg'],
    [b(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a), 'x.jpg', 'image/png', 'png'],
    [Buffer.from('GIF89a......'), 'x', 'image/gif', 'gif'],
    [Buffer.from('RIFF\0\0\0\0WEBPVP8 '), 'x', 'image/webp', 'webp'],
    [ftyp('qt  '), 'clip.mp4', 'video/quicktime', 'mov'],
    [ftyp('isom'), 'clip.mp4', 'video/mp4', 'mp4'],
    [ftyp('isom'), 'clip.MOV', 'video/quicktime', 'mov'],
    [ftyp('heic'), 'IMG.HEIC', 'image/heic', 'heic'],
    [ftyp('M4V '), 'a.m4v', 'video/x-m4v', 'm4v'],
    [b(0x1a, 0x45, 0xdf, 0xa3), 'a.mkv', 'video/x-matroska', 'mkv'],
    [b(0x30, 0x26, 0xb2, 0x75, 0x8e, 0x66, 0xcf, 0x11, 0xa6, 0xd9), 'clip.WMV', 'video/x-ms-wmv', 'wmv'],
    [b(0x30, 0x26, 0xb2, 0x75, 0x8e, 0x66, 0xcf, 0x11, 0xa6, 0xd9), 'clip.bin', 'video/x-ms-wmv', 'wmv'],
    [Buffer.from('%PDF-1.7'), 'doc.exe', 'application/pdf', 'pdf'],
    [b(0x50, 0x4b, 0x03, 0x04), 'report.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'docx'],
    [b(0x50, 0x4b, 0x03, 0x04), 'archive.bin', 'application/zip', 'zip'],
    [b(0x49, 0x49, 0x2a, 0x00, 8, 0, 0, 0), 'DSC.DNG', 'image/x-adobe-dng', 'dng'],
    [b(0x49, 0x49, 0x2a, 0x00, 8, 0, 0, 0), 'scan.tif', 'image/tiff', 'tif'],
    [Buffer.from('a,b\n1,2\n'), 'data.csv', 'text/csv', 'csv'],
    [Buffer.from('plain words'), 'x.exe', 'application/octet-stream', 'bin'],
    [b(0, 1, 2, 3), 'x.mp4', 'application/octet-stream', 'bin'],
    [b(), 'empty.txt', 'application/octet-stream', 'bin'],
  ];
  for (const [head, name, mime, ext] of rows) {
    assert.deepEqual(sniffType(head, name), { mime, ext }, `${name} ${Buffer.from(head).subarray(0, 12).toString('hex')}`);
  }
  assert.equal(sniffMime(b(0xff, 0xd8, 0xff)), 'image/jpeg');
  assert.equal(extensionFor('image/jpeg', 'a.png'), 'jpg');
  assert.equal(extensionFor('nope/nope'), 'bin');
  assert.equal(mimeFromName('clip.MOV'), 'video/quicktime');
  assert.equal(mimeFromName('noext'), 'application/octet-stream');
});

test('md5Hex accepts hex and base64 (Content-MD5) and refuses the rest', () => {
  const hex = '5d41402abc4b2a76b9719d911017c592';
  assert.equal(md5Hex(hex.toUpperCase()), hex);
  assert.equal(md5Hex(Buffer.from(hex, 'hex').toString('base64')), hex);
  assert.equal(md5Hex('nope'), null);
  assert.equal(md5Hex(null), null);
});

/* ---------------- source rules ---------------- */

function walk(rel) {
  const abs = path.join(ROOT, rel);
  return readdirSync(abs).flatMap((name) => {
    const p = path.join(rel, name);
    return statSync(path.join(ROOT, p)).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(name) ? [p.split(path.sep).join('/')] : [];
  });
}

const SOURCES = [...walk('src'), 'server.ts'];
const read = (f) => readFileSync(path.join(ROOT, f), 'utf8');

test('only the storage module touches the file system for media', () => {
  // config.ts reads package.json; nothing else outside the storage module may import fs.
  const allowed = new Set(['src/lib/config.ts']);
  const offenders = SOURCES.filter(
    (f) => !f.startsWith('src/modules/storage/') && !allowed.has(f) && /from ['"](node:)?fs(\/promises)?['"]|import\(['"](node:)?fs/.test(read(f)),
  );
  assert.deepEqual(offenders, []);
});

test('bytes are read from storage only in the storage and media modules', () => {
  const offenders = SOURCES.filter(
    (f) => !f.startsWith('src/modules/storage/') && !f.startsWith('src/modules/media/') && !f.startsWith('src/modules/pipeline/') && /\.getStream\(/.test(read(f)),
  );
  assert.deepEqual(offenders, []);
});

test('no storage paths, R2 or presigned leftovers outside the storage module', () => {
  const offenders = SOURCES.filter((f) => {
    if (f.startsWith('src/modules/storage/')) return false;
    const s = read(f);
    return /storagePath|thumbnailPath|storageRoot|STORAGE_PATHS|PhysicalPath|presigned|r2Key|uploadMode|uploadChunk|\/api\/upload\/chunk/i.test(s) ||
      (f !== 'src/lib/config.ts' && /STORAGE_LOCAL_ROOT/.test(s));
  });
  assert.deepEqual(offenders, []);
});
