// Stories 2.2 / 2.3: signed share URLs, share access cookies, access codes, Range parsing.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.MEDIA_SIGNING_SECRET = 'test-only-signing-secret-0123456789abcdef';

const { signShareToken, signShareUrl, verifyShareToken, SIGNED_FILE_TTL_SECONDS, SIGNED_ZIP_TTL_SECONDS } =
  await import('../src/modules/media/signing.ts');
const { parseRange } = await import('../src/modules/media/range.ts');
const access = await import('../src/modules/share/access.ts');
const { signingSecret, SECRET_PLACEHOLDER } = await import('../src/lib/signingSecret.ts');

test('the signing secret fails closed: missing, placeholder or short', () => {
  assert.throws(() => signingSecret({}), /not set/);
  assert.throws(() => signingSecret({ SESSION_SECRET: SECRET_PLACEHOLDER }), /placeholder/);
  assert.throws(() => signingSecret({ MEDIA_SIGNING_SECRET: 'short' }), /at least 32/);
  assert.throws(() => signingSecret({ MEDIA_SIGNING_SECRET: '', SESSION_SECRET: 'x'.repeat(31) }), /at least 32/);
  assert.equal(signingSecret({ MEDIA_SIGNING_SECRET: 'm'.repeat(32), SESSION_SECRET: 's'.repeat(40) }), 'm'.repeat(32));
  assert.equal(signingSecret({ SESSION_SECRET: 's'.repeat(40) }), 's'.repeat(40));
});

test('signing refuses to run with a placeholder secret', () => {
  const saved = process.env.MEDIA_SIGNING_SECRET;
  process.env.MEDIA_SIGNING_SECRET = SECRET_PLACEHOLDER;
  try {
    assert.throws(() => signShareToken('s', 'f', 60), /placeholder/);
  } finally {
    process.env.MEDIA_SIGNING_SECRET = saved;
  }
});

const NOW = Date.UTC(2026, 8, 27, 12, 0, 0);

test('a valid token verifies and carries share, target and expiry', () => {
  const t = signShareToken('share-1', 'file-1', 60, NOW);
  const v = verifyShareToken(t, { nowMs: NOW + 1000 });
  assert.deepEqual(v, { shareId: 'share-1', target: 'file-1', exp: Math.floor(NOW / 1000) + 60 });
  assert.match(signShareUrl('share-1', 'file-1'), /^\/media\/s\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
});

test('file tokens are capped at 5 minutes, ZIP tokens at 24 hours', () => {
  const f = verifyShareToken(signShareToken('s', 'f', 999999, NOW), { nowMs: NOW });
  assert.equal(f.exp - Math.floor(NOW / 1000), SIGNED_FILE_TTL_SECONDS);
  const z = verifyShareToken(signShareToken('s', 'zip', 999999, NOW), { nowMs: NOW });
  assert.equal(z.exp - Math.floor(NOW / 1000), SIGNED_ZIP_TTL_SECONDS);
  const zs = verifyShareToken(signShareToken('s', 'zip:section-9', undefined, NOW), { nowMs: NOW });
  assert.equal(zs.target, 'zip:section-9');
});

test('an expired token is rejected', () => {
  const t = signShareToken('share-1', 'file-1', 60, NOW);
  assert.equal(verifyShareToken(t, { nowMs: NOW + 61_000 }), null);
  assert.equal(verifyShareToken(t, { nowMs: NOW + 60_000 }), null);
});

test('a tampered payload or signature is rejected', () => {
  const t = signShareToken('share-1', 'file-1', 60, NOW);
  const [payload, sig] = t.split('.');
  const forged = Buffer.from(`share-1|file-2|${Math.floor(NOW / 1000) + 60}`).toString('base64url');
  assert.equal(verifyShareToken(`${forged}.${sig}`, { nowMs: NOW }), null);
  const flipped = sig.slice(0, -1) + (sig.endsWith('A') ? 'B' : 'A');
  assert.equal(verifyShareToken(`${payload}.${flipped}`, { nowMs: NOW }), null);
  for (const bad of ['', 'x', 'a.b.c', `${payload}.`, `.${sig}`, `${payload}.${sig}!`]) {
    assert.equal(verifyShareToken(bad, { nowMs: NOW }), null, bad);
  }
});

test('a token minted for another share is rejected when a share is expected', () => {
  const t = signShareToken('share-A', 'file-1', 60, NOW);
  assert.equal(verifyShareToken(t, { nowMs: NOW, expectShareId: 'share-B' }), null);
  assert.ok(verifyShareToken(t, { nowMs: NOW, expectShareId: 'share-A' }));
});

test('a token signed with another secret is rejected', () => {
  const t = signShareToken('share-1', 'file-1', 60, NOW);
  process.env.MEDIA_SIGNING_SECRET = 'another-secret-another-secret-0123456789';
  try {
    assert.equal(verifyShareToken(t, { nowMs: NOW }), null);
  } finally {
    process.env.MEDIA_SIGNING_SECRET = 'test-only-signing-secret-0123456789abcdef';
  }
});

test('Range parsing: satisfiable, open-ended, suffix, none and 416 cases', () => {
  assert.deepEqual(parseRange(null, 1000), { kind: 'none' });
  assert.deepEqual(parseRange('bytes=0-99', 1000), { kind: 'ok', start: 0, end: 99 });
  assert.deepEqual(parseRange('bytes=900-', 1000), { kind: 'ok', start: 900, end: 999 });
  assert.deepEqual(parseRange('bytes=990-5000', 1000), { kind: 'ok', start: 990, end: 999 });
  assert.deepEqual(parseRange('bytes=-100', 1000), { kind: 'ok', start: 900, end: 999 });
  assert.deepEqual(parseRange('bytes=-5000', 1000), { kind: 'ok', start: 0, end: 999 });
  assert.deepEqual(parseRange('bytes=999999999-', 1000), { kind: 'unsatisfiable' });
  assert.deepEqual(parseRange('bytes=1000-', 1000), { kind: 'unsatisfiable' });
  assert.deepEqual(parseRange('bytes=50-10', 1000), { kind: 'unsatisfiable' });
  assert.deepEqual(parseRange('bytes=-0', 1000), { kind: 'unsatisfiable' });
  assert.deepEqual(parseRange('bytes=0-1,5-6', 1000), { kind: 'none' });
  assert.deepEqual(parseRange('items=0-1', 1000), { kind: 'none' });
});

test('access codes: 6 readable characters, hash-only storage, forgiving input', () => {
  const code = access.generateAccessCode();
  assert.match(code, /^[A-HJ-NP-Z2-9]{6}$/);
  const hash = access.hashAccessCode(code);
  assert.notEqual(hash, code);
  assert.ok(access.verifyAccessCode(code, hash));
  assert.ok(access.verifyAccessCode(` ${code.slice(0, 3).toLowerCase()}-${code.slice(3)} `, hash));
  assert.equal(access.verifyAccessCode('ZZZZZZ' === code ? 'YYYYYY' : 'ZZZZZZ', hash), false);
  assert.equal(access.verifyAccessCode(code, null), false);
  assert.equal(access.verifyAccessCode('', hash), false);
});

test('share access cookies are bound to one share and expire', () => {
  const { value } = access.mintShareAccess('share-1', NOW);
  assert.ok(access.verifyShareAccess(value, 'share-1', NOW + 1000));
  assert.equal(access.verifyShareAccess(value, 'share-2', NOW + 1000), false);
  assert.equal(access.verifyShareAccess(value, 'share-1', NOW + (access.SHARE_ACCESS_TTL_SECONDS + 1) * 1000), false);
  assert.equal(access.verifyShareAccess(`${value}x`, 'share-1', NOW), false);
  assert.equal(access.verifyShareAccess(null, 'share-1', NOW), false);
  assert.equal(access.shareCookieName('abc'), 'shotstash_share_abc');
});
