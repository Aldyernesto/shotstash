// Story 3.5: upload failures are classified by structure (server code, HTTP
// status, error class), never by message text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { classifyUploadError, UPLOAD_REASONS, isRetryablePartError, retryDelayMs, matchesResume, summarize, PART_RETRIES } = await import('../src/components/upload/uploadTypes.ts');
const en = JSON.parse(readFileSync(new URL('../messages/en.json', import.meta.url), 'utf8'));

const httpError = (status, code) => Object.assign(new Error(code ?? `HTTP ${status}`), { status, ...(code ? { code } : {}) });

test('classifyUploadError table', () => {
  const rows = [
    [{ graphQLErrors: [{ message: 'x', extensions: { code: 'UNAUTHENTICATED' } }] }, { reason: 'session', code: 'UNAUTHENTICATED' }],
    [{ message: 'Forbidden', graphQLErrors: [{ message: 'y', extensions: { code: 'FORBIDDEN' } }] }, { reason: 'forbidden', code: 'FORBIDDEN' }],
    [httpError(401), { reason: 'session' }],
    [new TypeError('Failed to fetch'), { reason: 'offline', code: undefined }],
    [httpError(403), { reason: 'forbidden' }],
    [httpError(413), { reason: 'tooLarge' }],
    [httpError(507), { reason: 'quota' }],
    [httpError(413, 'TOO_LARGE'), { reason: 'tooLarge', code: 'TOO_LARGE' }],
    [httpError(503, 'STORAGE_UNAVAILABLE'), { reason: 'storage', code: 'STORAGE_UNAVAILABLE' }],
    [{ graphQLErrors: [{ extensions: { code: 'FILE_TYPE_NOT_ALLOWED', ext: 'exe' } }] }, { reason: 'unsupportedType', code: 'FILE_TYPE_NOT_ALLOWED' }],
    [httpError(409, 'CHECKSUM_MISMATCH'), { reason: 'checksum', code: 'CHECKSUM_MISMATCH' }],
    [httpError(400, 'PART_CHECKSUM_MISMATCH'), { reason: 'checksum', code: 'PART_CHECKSUM_MISMATCH' }],
    [httpError(410, 'UPLOAD_SESSION_EXPIRED'), { reason: 'expired', code: 'UPLOAD_SESSION_EXPIRED' }],
    [{ graphQLErrors: [{ extensions: { code: 'DUPLICATE_FILE', existingFileId: 'x' } }] }, { reason: 'duplicate', code: 'DUPLICATE_FILE' }],
    [httpError(429, 'RATE_LIMITED'), { reason: 'rateLimited', code: 'RATE_LIMITED' }],
    [httpError(410), { reason: 'expired' }],
    [httpError(500, 'INTERNAL'), { reason: 'generic', code: 'INTERNAL' }],
    [httpError(500, 'ENOSPC'), { reason: 'generic', code: undefined }],
    [new Error('Unauthorized forbidden 403 quota'), { reason: 'generic', code: undefined }],
  ];
  for (const [err, want] of rows) {
    assert.deepEqual(classifyUploadError(err), want, JSON.stringify(err) || String(err));
  }
});

test('every upload reason has a panel sentence and a short row phrase', () => {
  for (const reason of UPLOAD_REASONS) {
    assert.ok(en.upload.reject[reason], `upload.reject.${reason}`);
    assert.ok(en.upload.rowReason[reason], `upload.rowReason.${reason}`);
    assert.ok(!en.upload.rowReason[reason].includes('. '), `upload.rowReason.${reason} is one short phrase`);
  }
});

test('Story 4.3: part retries: network, 5xx, 429 and a damaged part retry; the rest is final', () => {
  assert.equal(PART_RETRIES, 5); // one try plus five retries
  assert.equal(isRetryablePartError(new TypeError('Network error')), true);
  assert.equal(isRetryablePartError(httpError(502)), true);
  assert.equal(isRetryablePartError(httpError(503, 'STORAGE_UNAVAILABLE')), true);
  assert.equal(isRetryablePartError(httpError(429, 'RATE_LIMITED')), true);
  assert.equal(isRetryablePartError(httpError(400, 'PART_CHECKSUM_MISMATCH')), true);
  assert.equal(isRetryablePartError(httpError(401, 'UNAUTHENTICATED')), false);
  assert.equal(isRetryablePartError(httpError(403, 'FORBIDDEN')), false);
  assert.equal(isRetryablePartError(httpError(410, 'UPLOAD_SESSION_EXPIRED')), false);
  assert.equal(isRetryablePartError(httpError(409, 'UPLOAD_SESSION_CLOSED')), false);
  assert.equal(isRetryablePartError(httpError(400)), false);
});

test('Story 4.3: part MD5 headers round-trip (hexToBase64 then md5Hex)', async () => {
  const { hexToBase64 } = await import('../src/components/upload/transfer.ts');
  const { md5Hex } = await import('../src/modules/storage/meter.ts');
  for (const h of ['5d41402abc4b2a76b9719d911017c592', 'd41d8cd98f00b204e9800998ecf8427e', '00000000000000000000000000000000']) {
    assert.equal(md5Hex(hexToBase64(h)), h);
  }
});

test('Story 4.3: backoff grows exponentially with jitter and is capped', () => {
  for (let a = 0; a < 5; a++) {
    const base = Math.min(30_000, 1000 * 2 ** a);
    assert.equal(retryDelayMs(a, () => 0), base / 2);
    assert.equal(retryDelayMs(a, () => 0.999999), Math.round(base * 1.499999));
  }
  assert.ok(retryDelayMs(20, () => 1) <= 45_000);
});

test('Story 4.3: a resumed upload only accepts the same file', () => {
  const entry = { name: 'clip.mp4', size: 100, lastModified: 42 };
  const file = (name, size, lastModified) => ({ name, size, lastModified });
  assert.equal(matchesResume(file('clip.mp4', 100, 42), entry), true);
  assert.equal(matchesResume(file('clip.mp4', 101, 42), entry), false);
  assert.equal(matchesResume(file('clip.mp4', 100, 43), entry), false);
  assert.equal(matchesResume(file('other.mp4', 100, 42), entry), false);
});

test('Story 4.3: summary counts skipped as finished and leaves paused rows out of the batch', () => {
  const s = summarize([
    { status: 'success' },
    { status: 'skipped' },
    { status: 'checking' },
    { status: 'pending' },
    { status: 'error' },
    { status: 'paused' },
  ]);
  assert.deepEqual(s, { total: 5, done: 2, uploaded: 1, skipped: 1, running: 1, waiting: 1, failed: 1, paused: 1 });
});

test('Story 4.1: cover URLs carry a cache buster and stay renderable', async () => {
  const { coverUrl, coverIdFromUrl } = await import('../src/modules/media/coverUrl.ts');
  const { isRenderableImageUrl } = await import('../src/lib/mediaUrls.ts');
  const id = '0192a4f1-0000-7000-8000-00000000c0de';
  const url = coverUrl('project', id, 42);
  assert.equal(url, `/media/c/project/${id}?v=42`);
  assert.equal(isRenderableImageUrl(url), true);
  assert.equal(isRenderableImageUrl(coverUrl('user', id)), true);
  assert.equal(isRenderableImageUrl('https://example.com/pixel.png'), false);
  assert.equal(isRenderableImageUrl(`/media/c/project/${id}?v=x`), false);
  assert.deepEqual(coverIdFromUrl(url), { kind: 'project', id });
  assert.deepEqual(coverIdFromUrl(`/media/c/user/${id}`), { kind: 'user', id });
  assert.equal(coverIdFromUrl('https://example.com/a.jpg'), null);
});
