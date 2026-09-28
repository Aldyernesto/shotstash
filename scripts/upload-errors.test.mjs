// Story 3.5: upload failures are classified by structure (server code, HTTP
// status, error class), never by message text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { classifyUploadError, UPLOAD_REASONS } = await import('../src/components/upload/uploadTypes.ts');
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
