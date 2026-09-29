// Stories 2.5-2.8: sliding-window limiter, proxy trust, setup input rules,
// password rule, trash cascade planning and chat mention parsing.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const rl = await import('../src/lib/rateLimit.ts');
const { resetConfig } = await import('../src/lib/config.ts');
const req = await import('../src/lib/request.ts');
const { validateSetupInput } = await import('../src/modules/setup/validate.ts');
const { MIN_PASSWORD_LENGTH, MAX_PASSWORD_BYTES, passwordProblem } = await import('../src/lib/passwordRule.ts');
const plan = await import('../src/modules/trash/plan.ts');
const { mentionHandles, handleMatchesUser } = await import('../src/lib/mentions.ts');

rl.setRateLimitStore(null); // memory path only

/* ---------------- rate limiter ---------------- */

test('sliding window: allows up to the limit, then blocks with retryAfter', async () => {
  rl.resetMemoryLimits();
  const t0 = 1_000_000;
  for (let i = 0; i < 3; i++) {
    const r = await rl.rateLimit('k', 3, 60_000, t0 + i * 1000);
    assert.equal(r.ok, true, `attempt ${i + 1}`);
    assert.equal(r.remaining, 2 - i);
  }
  const blocked = await rl.rateLimit('k', 3, 60_000, t0 + 5_000);
  assert.equal(blocked.ok, false);
  // The first hit (t0) leaves the window at t0 + 60 s: 55 s from now.
  assert.equal(blocked.retryAfter, 55);
});

test('sliding window: slides (no fixed-window reset burst) and refused attempts are not counted', async () => {
  rl.resetMemoryLimits();
  const t0 = 2_000_000;
  await rl.rateLimit('s', 2, 10_000, t0);
  await rl.rateLimit('s', 2, 10_000, t0 + 9_000);
  // Hammering while blocked does not extend the block.
  for (let i = 0; i < 5; i++) assert.equal((await rl.rateLimit('s', 2, 10_000, t0 + 9_500)).ok, false);
  // t0 left the window: exactly one slot is free again.
  assert.equal((await rl.rateLimit('s', 2, 10_000, t0 + 10_001)).ok, true);
  assert.equal((await rl.rateLimit('s', 2, 10_000, t0 + 10_002)).ok, false);
  // Keys are independent.
  assert.equal((await rl.rateLimit('other', 2, 10_000, t0 + 10_002)).ok, true);
});

test('named limits match the spine', () => {
  assert.deepEqual(rl.LIMITS.login, { limit: 10, windowMs: 15 * 60 * 1000 });
  assert.deepEqual(rl.LIMITS.passwordReset, { limit: 5, windowMs: 60 * 60 * 1000 });
  assert.deepEqual(rl.LIMITS.shareUnlock, { limit: 5, windowMs: 15 * 60 * 1000 });
  assert.deepEqual(rl.LIMITS.shareUnlockPerSlug, { limit: 20, windowMs: 60 * 60 * 1000 });
  assert.deepEqual(rl.LIMITS.shareCreate, { limit: 60, windowMs: 60 * 60 * 1000 });
  assert.deepEqual(rl.LIMITS.worker, { limit: 600, windowMs: 60 * 1000 });
});

test('login limit: 11th attempt per IP is refused; per email counts across IPs', async () => {
  rl.resetMemoryLimits();
  for (let i = 0; i < 10; i++) assert.equal(await rl.loginLimit('1.1.1.1'), null);
  assert.ok((await rl.loginLimit('1.1.1.1')) > 0);
  rl.resetMemoryLimits();
  for (let i = 0; i < 10; i++) assert.equal(await rl.loginLimit(`10.0.0.${i}`, 'A@Example.com'), null);
  assert.ok((await rl.loginLimit('10.0.0.99', 'a@example.com ')) > 0);
});

test('password reset limit: 6th request per email or per IP is refused', async () => {
  rl.resetMemoryLimits();
  for (let i = 0; i < 5; i++) assert.equal(await rl.passwordResetLimit(`ip${i}`, 'x@example.com'), null);
  assert.ok((await rl.passwordResetLimit('ip9', 'x@example.com')) > 0);
  rl.resetMemoryLimits();
  for (let i = 0; i < 5; i++) assert.equal(await rl.passwordResetLimit('9.9.9.9', `u${i}@example.com`), null);
  assert.ok((await rl.passwordResetLimit('9.9.9.9', 'new@example.com')) > 0);
});

test('429 response carries code, retryAfter and Retry-After', async () => {
  const res = rl.rateLimitedResponse(42);
  assert.equal(res.status, 429);
  assert.equal(res.headers.get('retry-after'), '42');
  const body = await res.json();
  assert.equal(body.code, 'RATE_LIMITED');
  assert.equal(body.retryAfter, 42);
});

/* ---------------- request facts ---------------- */

const headers = (h) => ({ get: (n) => h[n.toLowerCase()] ?? null });

test('clientIp and requestScheme ignore forwarded headers unless TRUST_PROXY=true', () => {
  const h = headers({
    'x-shotstash-client-ip': '10.1.1.1',
    'x-forwarded-for': '6.6.6.6, 7.7.7.7',
    'cf-connecting-ip': '5.5.5.5',
    'x-forwarded-proto': 'https',
  });
  const prev = process.env.TRUST_PROXY;
  try {
    delete process.env.TRUST_PROXY;
    resetConfig();
    assert.equal(req.clientIp(h), '10.1.1.1');
    assert.equal(req.requestScheme({ url: 'http://localhost/x', headers: h }), 'http');
    process.env.TRUST_PROXY = 'true';
    resetConfig();
    assert.equal(req.clientIp(h), '5.5.5.5');
    assert.equal(req.clientIp(headers({ 'x-forwarded-for': '6.6.6.6, 7.7.7.7' })), '6.6.6.6');
    assert.equal(req.requestScheme({ url: 'http://localhost/x', headers: h }), 'https');
  } finally {
    if (prev === undefined) delete process.env.TRUST_PROXY;
    else process.env.TRUST_PROXY = prev;
    resetConfig();
  }
});

test('configuredScheme reads APP_URL', () => {
  assert.equal(req.configuredScheme({ APP_URL: 'https://a.example' }), 'https');
  assert.equal(req.configuredScheme({ APP_URL: 'http://b.example' }), 'http');
  assert.equal(req.configuredScheme({}), null);
  assert.equal(req.configuredScheme({ APP_URL: 'not a url' }), null);
});

/* ---------------- password rule and setup input ---------------- */

test('password rule: 10 characters minimum, 72 UTF-8 bytes / 256 characters maximum', () => {
  assert.equal(MIN_PASSWORD_LENGTH, 10);
  assert.equal(MAX_PASSWORD_BYTES, 72);
  assert.equal(passwordProblem('123456789'), 'PASSWORD_TOO_SHORT');
  assert.equal(passwordProblem('1234567890'), null);
  assert.equal(passwordProblem(undefined), 'PASSWORD_TOO_SHORT');
  assert.equal(passwordProblem('a'.repeat(72)), null);
  assert.equal(passwordProblem('a'.repeat(73)), 'PASSWORD_TOO_LONG');
  // 25 three-byte characters = 75 bytes although only 25 characters.
  assert.equal(passwordProblem('€'.repeat(25)), 'PASSWORD_TOO_LONG');
  assert.equal(passwordProblem('€'.repeat(24)), null);
});

test('setup input validation', () => {
  const good = { name: ' Owner ', email: ' Owner@Example.com ', password: 'long-enough-pw', confirm: 'long-enough-pw' };
  const ok = validateSetupInput(good);
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.value, { name: 'Owner', email: 'owner@example.com', password: 'long-enough-pw' });
  assert.equal(validateSetupInput({ ...good, name: '  ' }).field, 'name');
  assert.equal(validateSetupInput({ ...good, email: 'nope' }).field, 'email');
  const short = validateSetupInput({ ...good, password: '123456789', confirm: '123456789' });
  assert.equal(short.code, 'PASSWORD_TOO_SHORT');
  assert.equal(validateSetupInput({ ...good, password: 'x'.repeat(80), confirm: 'x'.repeat(80) }).code, 'PASSWORD_TOO_LONG');
  assert.equal(validateSetupInput({ ...good, confirm: 'other-password' }).code, 'PASSWORD_MISMATCH');
  assert.equal(validateSetupInput(null).ok, false);
  const noConfirm = { ...good };
  delete noConfirm.confirm;
  assert.equal(validateSetupInput(noConfirm).ok, true);
});

/* ---------------- trash cascade planning ---------------- */

const T = new Date('2026-01-01T00:00:00Z');
const folders = [
  { id: 'root', parentId: null, trashedAt: null },
  { id: 'a', parentId: 'root', trashedAt: null },
  { id: 'a1', parentId: 'a', trashedAt: null },
  { id: 'b', parentId: 'root', trashedAt: T }, // trashed on its own earlier
  { id: 'b1', parentId: 'b', trashedAt: T },
  { id: 'other', parentId: null, trashedAt: null },
];
const files = [
  { id: 'f-root', folderId: 'root', trashedAt: null },
  { id: 'f-a1', folderId: 'a1', trashedAt: null },
  { id: 'f-a-trashed', folderId: 'a', trashedAt: T },
  { id: 'f-b', folderId: 'b', trashedAt: T },
  { id: 'f-other', folderId: 'other', trashedAt: null },
];

test('subtreeFolderIds covers the whole subtree, trashed or not, and survives cycles', () => {
  assert.deepEqual(plan.subtreeFolderIds('root', folders).sort(), ['a', 'a1', 'b', 'b1', 'root']);
  const cyc = [
    { id: 'x', parentId: 'y', trashedAt: null },
    { id: 'y', parentId: 'x', trashedAt: null },
  ];
  assert.deepEqual(plan.subtreeFolderIds('x', cyc).sort(), ['x', 'y']);
});

test('planFolderTrash cascades to live descendants only', () => {
  const p = plan.planFolderTrash('root', folders, files);
  assert.deepEqual(p.folderIds.sort(), ['a', 'a1']);
  assert.deepEqual(p.fileIds.sort(), ['f-a1', 'f-root']);
});

test('retention helpers', () => {
  const now = Date.parse('2026-02-01T00:00:00Z');
  assert.equal(plan.retentionCutoff(30, now).toISOString(), '2026-01-02T00:00:00.000Z');
});

/* ---------------- chat mentions ---------------- */

test('mention handles: plain @Name only, not entity tags or email addresses', () => {
  assert.deepEqual(mentionHandles('hi @Viewer, see @[file:1:2:clip.mp4] and mail a@b.com'), ['viewer']);
  assert.deepEqual(mentionHandles('@FieldCrew @editor.'), ['fieldcrew', 'editor']);
  assert.deepEqual(mentionHandles('no mentions here'), []);
  assert.equal(handleMatchesUser('fieldcrew', { name: 'Field Crew', email: 'crew@example.com' }), true);
  assert.equal(handleMatchesUser('crew', { name: 'Field Crew', email: 'crew@example.com' }), true);
  assert.equal(handleMatchesUser('viewer', { name: 'Editor', email: 'editor@example.com' }), false);
});
