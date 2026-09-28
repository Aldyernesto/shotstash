// Stories 2.5-2.8 review fixes: atomic Dragonfly limiter (fake store),
// memory sweep, lock, setup gate allowlist, storage root containment,
// Google email decision, sweeper selection, setup token.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

const rl = await import('../src/lib/rateLimit.ts');
const { withLockOn, RELEASE_LOCK_LUA } = await import('../src/lib/lock.ts');
const { allowedBeforeSetup, isApiPath } = await import('../src/lib/setupGate.ts');
const { isInsideStorageRoot } = await import('../src/lib/storageRoot.ts');
const { googleEmailDecision } = await import('../src/lib/googleEmail.ts');
const plan = await import('../src/modules/trash/plan.ts');

/* ---------------- limiter with a fake Dragonfly ---------------- */

/** Emulates SLIDING_WINDOW_LUA on in-memory sorted sets. */
function fakeStore() {
  const sets = new Map();
  const store = {
    status: 'ready',
    calls: 0,
    fail: false,
    async eval(script, numKeys, key, now, windowMs, limit, member) {
      store.calls++;
      if (store.fail) throw new Error('down');
      assert.equal(script, rl.SLIDING_WINDOW_LUA);
      assert.equal(numKeys, 1);
      const z = (sets.get(key) ?? []).filter((e) => e.score > now - windowMs);
      sets.set(key, z);
      if (z.length < limit) {
        z.push({ score: now, member });
        z.sort((a, b) => a.score - b.score);
        return [1, z.length, 0];
      }
      const idx = z.length - limit;
      return [0, z.length, z[idx].score];
    },
    size: (key) => (sets.get(`rl:${key}`) ?? []).length,
  };
  return store;
}

test('Dragonfly path: limit+1 refused, retryAfter from the oldest hit, refusals not counted', async () => {
  const store = fakeStore();
  rl.setRateLimitStore(async () => store);
  rl.resetMemoryLimits();
  try {
    const t0 = 5_000_000;
    for (let i = 0; i < 3; i++) assert.equal((await rl.rateLimit('d', 3, 60_000, t0 + i * 1000)).ok, true);
    const refused = await rl.rateLimit('d', 3, 60_000, t0 + 10_000);
    assert.equal(refused.ok, false);
    assert.equal(refused.retryAfter, 50);
    for (let i = 0; i < 4; i++) await rl.rateLimit('d', 3, 60_000, t0 + 11_000);
    assert.equal(store.size('d'), 3, 'refused attempts are not stored');
    assert.equal((await rl.rateLimit('d', 3, 60_000, t0 + 60_001)).ok, true, 'slot frees when the oldest hit leaves');
    assert.equal(rl.memoryKeyCount(), 0, 'nothing counted in memory while the store answers');
  } finally {
    rl.setRateLimitStore(null);
  }
});

test('Dragonfly errors or malformed replies fall back to memory without counting twice', async () => {
  const store = fakeStore();
  store.fail = true;
  rl.setRateLimitStore(async () => store);
  rl.resetMemoryLimits();
  try {
    const t0 = 6_000_000;
    assert.equal((await rl.rateLimit('e', 1, 60_000, t0)).ok, true);
    assert.equal((await rl.rateLimit('e', 1, 60_000, t0 + 1)).ok, false, 'memory counted the first attempt');
    const bad = { status: 'ready', eval: async () => [null, 'x'] };
    rl.setRateLimitStore(async () => bad);
    assert.equal((await rl.rateLimit('e', 1, 60_000, t0 + 2)).ok, false, 'a malformed reply never fails open');
    rl.setRateLimitStore(async () => ({ status: 'connecting', eval: async () => [1, 1, 0] }));
    assert.equal((await rl.rateLimit('e', 1, 60_000, t0 + 3)).ok, false, 'a store that is not ready is skipped');
  } finally {
    rl.setRateLimitStore(null);
  }
});

test('memory sweep drops keys whose newest hit is older than their own window, at most once a minute', async () => {
  rl.setRateLimitStore(null);
  rl.resetMemoryLimits();
  const t0 = 10_000_000;
  rl.memoryHit('short', 5, 1_000, t0);
  rl.memoryHit('long', 5, 3_600_000, t0);
  assert.equal(rl.memoryKeyCount(), 2);
  rl.memoryHit('other', 5, 1_000, t0 + 30_000); // under a minute since the last sweep: no sweep
  assert.equal(rl.memoryKeyCount(), 3);
  rl.memoryHit('other2', 5, 1_000, t0 + 61_000);
  // 'short' and 'other' expired; 'long' is still inside its hour.
  assert.equal(rl.memoryKeyCount(), 2);
});

test('setup has its own limit', () => {
  assert.deepEqual(rl.LIMITS.setup, { limit: 10, windowMs: 15 * 60 * 1000 });
});

/* ---------------- lock ---------------- */

function fakeLockClient({ held = false } = {}) {
  const store = new Map();
  if (held) store.set('k', 'someone-else');
  return {
    status: 'ready',
    store,
    async set(key, value, px, ttl, nx) {
      assert.equal(px, 'PX');
      assert.equal(nx, 'NX');
      if (store.has(key)) return null;
      store.set(key, value);
      return 'OK';
    },
    async eval(script, n, key, token) {
      assert.equal(script, RELEASE_LOCK_LUA);
      if (store.get(key) === token) {
        store.delete(key);
        return 1;
      }
      return 0;
    },
  };
}

test('withLock: runs and releases its own lock', async () => {
  const c = fakeLockClient();
  const res = await withLockOn(c, 'k', 1000, async () => {
    assert.ok(c.store.has('k'));
    return 42;
  });
  assert.deepEqual(res, { ran: true, value: 42 });
  assert.equal(c.store.has('k'), false);
});

test('withLock: SET NX failure means { ran: false, reason: held } and the other token stays', async () => {
  const c = fakeLockClient({ held: true });
  let ran = false;
  const res = await withLockOn(c, 'k', 1000, async () => {
    ran = true;
  });
  assert.deepEqual(res, { ran: false, reason: 'held' });
  assert.equal(ran, false);
  assert.equal(c.store.get('k'), 'someone-else');
});

test('withLock: never releases a token it does not own (lock taken over after expiry)', async () => {
  const c = fakeLockClient();
  await withLockOn(c, 'k', 1000, async () => {
    c.store.set('k', 'new-owner'); // our lock expired and another instance took it
  });
  assert.equal(c.store.get('k'), 'new-owner');
});

test('withLock: no ready client means { ran: false, reason: unavailable }', async () => {
  assert.deepEqual(await withLockOn(null, 'k', 1000, async () => 1), { ran: false, reason: 'unavailable' });
  assert.deepEqual(await withLockOn({ status: 'end' }, 'k', 1000, async () => 1), { ran: false, reason: 'unavailable' });
});

/* ---------------- setup gate ---------------- */

test('setup gate: only the explicit allowlist passes before setup', () => {
  for (const p of ['/setup', '/api/v1/setup', '/api/health', '/_next/static/chunks/a.js', '/brand/logo.svg', '/fonts/x.woff2', '/favicon.ico', '/icon.svg', '/apple-icon.png', '/manifest.webmanifest', '/folder-v2-shell.glb']) {
    assert.equal(allowedBeforeSetup(p), true, p);
  }
  for (const p of ['/', '/dashboard', '/s/abc.json', '/dashboard/x.txt', '/setup/x', '/api/graphql', '/api/health/x', '/media/t/x', '/x.png', '/icon.svg/x', '/_nextx']) {
    assert.equal(allowedBeforeSetup(p), false, p);
  }
  assert.equal(isApiPath('/api/graphql'), true);
  assert.equal(isApiPath('/media/t/x'), true);
  assert.equal(isApiPath('/apiary'), false);
  assert.equal(isApiPath('/dashboard'), false);
});

/* ---------------- storage root ---------------- */

test('isInsideStorageRoot: children only, no sibling prefix, no traversal, no other root', () => {
  const root = path.resolve('/srv/media');
  assert.equal(isInsideStorageRoot(path.join(root, 'projects', 'a.mp4'), root), true);
  assert.equal(isInsideStorageRoot(root, root), true);
  assert.equal(isInsideStorageRoot(path.resolve('/srv/media-other/a.mp4'), root), false);
  assert.equal(isInsideStorageRoot(path.join(root, '..', 'etc', 'passwd'), root), false);
  assert.equal(isInsideStorageRoot(path.resolve('/other/media/a'), root), false);
  if (process.platform === 'win32') {
    assert.equal(isInsideStorageRoot(path.join(root.toUpperCase(), 'Projects', 'a.mp4'), root), true);
    assert.equal(isInsideStorageRoot('D:\\srv\\media\\a', 'C:\\srv\\media'), false);
  }
});

/* ---------------- Google ---------------- */

test('Google: only an explicitly verified email links', () => {
  assert.deepEqual(googleEmailDecision({ email: 'a@example.com', email_verified: true }), { ok: true, email: 'a@example.com' });
  assert.deepEqual(googleEmailDecision({ email: 'a@example.com', email_verified: false }), { ok: false, code: 'EMAIL_NOT_VERIFIED' });
  assert.deepEqual(googleEmailDecision({ email: 'a@example.com' }), { ok: false, code: 'EMAIL_NOT_VERIFIED' });
  assert.deepEqual(googleEmailDecision({ email_verified: true }), { ok: false, code: 'INVALID_TOKEN' });
  assert.deepEqual(googleEmailDecision(null), { ok: false, code: 'INVALID_TOKEN' });
});

/* ---------------- sweeper selection ---------------- */

test('sweeper selects only trash roots older than the cutoff', () => {
  const cutoff = new Date('2026-01-31T00:00:00Z');
  const old = new Date('2026-01-01T00:00:00Z');
  const fresh = new Date('2026-02-01T00:00:00Z');
  assert.equal(plan.isExpiredRoot({ trashedAt: old, trashRootId: null }, cutoff), true);
  assert.equal(plan.isExpiredRoot({ trashedAt: old, trashRootId: 'root' }, cutoff), false, 'cascaded rows go with their root');
  assert.equal(plan.isExpiredRoot({ trashedAt: fresh, trashRootId: null }, cutoff), false);
  assert.equal(plan.isExpiredRoot({ trashedAt: cutoff, trashRootId: null }, cutoff), false, 'strictly older');
  assert.equal(plan.isExpiredRoot({ trashedAt: null, trashRootId: null }, cutoff), false);
  assert.deepEqual(plan.expiredRootWhere(cutoff), { trashedAt: { lt: cutoff }, trashRootId: null });
  assert.deepEqual(plan.batches([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
});

/* ---------------- setup token ---------------- */

test('setup token: required only when configured, compared exactly', async () => {
  const { setupTokenMatches, setupTokenRequired } = await import('../src/modules/setup/validate.ts');
  assert.equal(setupTokenRequired({}), false);
  assert.equal(setupTokenMatches(undefined, {}), true);
  const env = { SETUP_TOKEN: 's3cret-token' };
  assert.equal(setupTokenRequired(env), true);
  assert.equal(setupTokenMatches('s3cret-token', env), true);
  assert.equal(setupTokenMatches('s3cret-tokeN', env), false);
  assert.equal(setupTokenMatches('', env), false);
  assert.equal(setupTokenMatches(undefined, env), false);
});
