// Story 8.2: demo mode pieces that need no server. The CORS matcher, the
// nightly reset schedule, the demo config (features, public config,
// cross-field rule), the synthetic document, and the rules the demo routes
// and module must keep.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cors = await import('../src/lib/cors.ts');
const schedule = await import('../src/modules/demo/schedule.ts');
const cfg = await import('../src/lib/config.ts');
const accounts = await import('../src/lib/demoAccounts.ts');

const GOOD = { DATABASE_URL: 'postgresql://u:p@127.0.0.1:5432/db', SESSION_SECRET: 's'.repeat(64) };
const read = (f) => readFileSync(path.join(ROOT, f), 'utf8');

/* ---------------- CORS ---------------- */

test('CORS origins: exact origins only, normalised, never a wildcard', () => {
  assert.deepEqual(cors.parseCorsOrigins('https://docs.example.com, http://localhost:3100/ ,https://DOCS.example.com'), {
    origins: ['https://docs.example.com', 'http://localhost:3100'],
    problems: [],
  });
  for (const bad of ['*', 'https://*.example.com', 'https://docs.example.com/shotstash', 'docs.example.com', 'ftp://x.example', 'https://u:p@x.example', 'https://x.example?a=1']) {
    const r = cors.parseCorsOrigins(bad);
    assert.deepEqual(r.origins, [], bad);
    assert.equal(r.problems.length, 1, bad);
  }
  assert.deepEqual(cors.parseCorsOrigins(' , '), { origins: [], problems: [] });
  // An explicit default port is the same origin.
  assert.deepEqual(cors.parseCorsOrigins('https://docs.example.com:443, http://localhost:80/').origins, ['https://docs.example.com', 'http://localhost']);
  assert.equal(cors.originAllowed('https://docs.example.com:443', ['https://docs.example.com']), true);
});

test('CORS decisions: echo an allowed origin, nothing for others, nothing without a list', () => {
  const list = ['https://docs.example.com'];
  const allowed = cors.corsDecision({ method: 'GET', origin: 'https://docs.example.com', requestMethod: null }, list);
  assert.equal(allowed.kind, 'allow');
  assert.equal(allowed.headers['Access-Control-Allow-Origin'], 'https://docs.example.com');
  assert.equal(allowed.headers['Access-Control-Allow-Credentials'], undefined);
  assert.equal(allowed.headers.Vary, 'Origin');

  const pre = cors.corsDecision({ method: 'OPTIONS', origin: 'https://docs.example.com', requestMethod: 'POST' }, list);
  assert.equal(pre.kind, 'preflight');
  assert.equal(pre.headers['Access-Control-Allow-Origin'], 'https://docs.example.com');
  assert.match(pre.headers['Access-Control-Allow-Headers'], /Authorization/);
  assert.match(pre.headers['Access-Control-Allow-Methods'], /POST/);
  assert.equal(pre.headers['Access-Control-Allow-Credentials'], undefined);

  for (const origin of ['https://evil.example.com', 'https://docs.example.com.evil.test', 'null', 'https://docs.example.com:444']) {
    const r = cors.corsDecision({ method: 'OPTIONS', origin, requestMethod: 'POST' }, list);
    assert.equal(r.kind, 'preflight', origin);
    assert.equal(r.headers['Access-Control-Allow-Origin'], undefined, origin);
    const g = cors.corsDecision({ method: 'GET', origin, requestMethod: null }, list);
    assert.equal(g.headers['Access-Control-Allow-Origin'], undefined, origin);
  }
  // A plain OPTIONS (no Access-Control-Request-Method) is not a preflight.
  assert.equal(cors.corsDecision({ method: 'OPTIONS', origin: 'https://docs.example.com', requestMethod: null }, list).kind, 'allow');
  // No list: the server behaves as before, for every request.
  assert.deepEqual(cors.corsDecision({ method: 'OPTIONS', origin: 'https://docs.example.com', requestMethod: 'POST' }, []), { kind: 'none' });
  assert.deepEqual(cors.corsDecision({ method: 'GET', origin: 'https://docs.example.com', requestMethod: null }, []), { kind: 'none' });
});

test('SHOTSTASH_CORS_ORIGINS is parsed by the config and a wildcard stops the boot', () => {
  assert.deepEqual(cfg.loadConfig({ ...GOOD, SHOTSTASH_CORS_ORIGINS: 'https://docs.example.com' }).config.SHOTSTASH_CORS_ORIGINS, ['https://docs.example.com']);
  assert.equal(cfg.loadConfig(GOOD).config.SHOTSTASH_CORS_ORIGINS, undefined);
  const bad = cfg.loadConfig({ ...GOOD, SHOTSTASH_CORS_ORIGINS: '*' });
  assert.ok(bad.problems.some((p) => p.startsWith('SHOTSTASH_CORS_ORIGINS:') && /wildcard/.test(p)), bad.problems.join('; '));
});

/* ---------------- schedule ---------------- */

const { withLockOn } = await import('../src/lib/lock.ts');

/** In-memory stand-in for Dragonfly: SET NX PX/EX, GET, compare-and-delete. */
function fakeStore({ status = 'ready' } = {}) {
  const data = new Map();
  return {
    data,
    status,
    async get(key) {
      return data.has(key) ? data.get(key) : null;
    },
    async set(key, value, _mode, _ttl, nx) {
      if (nx === 'NX' && data.has(key)) return null;
      data.set(key, value);
      return 'OK';
    },
    async eval(_script, _n, key, token) {
      if (data.get(key) === token) {
        data.delete(key);
        return 1;
      }
      return 0;
    },
  };
}

function tick(store, reset, now = new Date('2026-10-07T03:05:00Z')) {
  return schedule.nightlyDemoTick({
    now,
    timeZone: 'UTC',
    store,
    runLocked: (fn) => withLockOn(store, schedule.DEMO_LOCK, schedule.DEMO_LOCK_TTL_MS, fn),
    reset,
  });
}

test('nightly reset: due in the 03:00 hour of the instance time zone only', () => {
  // 20:15 UTC is 03:15 in Asia/Jakarta (UTC+7).
  assert.equal(schedule.demoResetDate(new Date('2026-10-07T20:15:00Z'), 'Asia/Jakarta'), '2026-10-08');
  assert.equal(schedule.demoResetDate(new Date('2026-10-07T20:15:00Z'), 'UTC'), null);
  assert.equal(schedule.demoResetDate(new Date('2026-10-07T03:59:00Z'), 'UTC'), '2026-10-07');
  assert.equal(schedule.demoResetDate(new Date('2026-10-07T04:00:00Z'), 'UTC'), null, 'a missed hour is skipped');
  assert.deepEqual(schedule.localClock(new Date('2026-10-07T00:30:00Z'), 'UTC'), { date: '2026-10-07', hour: 0 });
});

test('nightly reset: runs under the lock and records the date marker', async () => {
  const store = fakeStore();
  let resets = 0;
  const r = await tick(store, async () => resets++);
  assert.equal(r.outcome, 'ran');
  assert.equal(resets, 1);
  assert.equal(store.data.get(schedule.demoMarkerKey('2026-10-07')), '1');
  assert.equal(store.data.has(schedule.DEMO_LOCK), false, 'lock released');
  assert.equal((await tick(store, async () => resets++, new Date('2026-10-07T10:00:00Z'))).outcome, 'not-due');
});

test('nightly reset: a second tick on the same date does nothing', async () => {
  const store = fakeStore();
  let resets = 0;
  await tick(store, async () => resets++);
  const again = await tick(store, async () => resets++, new Date('2026-10-07T03:06:00Z'));
  assert.equal(again.outcome, 'done');
  assert.equal(resets, 1);
});

test('nightly reset: skipped while another holder has the lock', async () => {
  const store = fakeStore();
  store.data.set(schedule.DEMO_LOCK, 'someone-else');
  let resets = 0;
  const r = await tick(store, async () => resets++);
  assert.equal(r.outcome, 'held');
  assert.equal(resets, 0);
  assert.equal(store.data.has(schedule.demoMarkerKey('2026-10-07')), false);
});

test('nightly reset: skipped with no ready lock store (never everywhere at once)', async () => {
  let resets = 0;
  assert.equal((await tick(fakeStore({ status: 'reconnecting' }), async () => resets++)).outcome, 'unavailable');
  assert.equal((await tick(null, async () => resets++)).outcome, 'unavailable');
  assert.equal(resets, 0);
});

test('nightly reset: a failed run writes no marker and retries on the next tick', async () => {
  const store = fakeStore();
  let calls = 0;
  const reset = async () => {
    calls++;
    if (calls === 1) throw new Error('disk full');
  };
  const first = await tick(store, reset);
  assert.equal(first.outcome, 'failed');
  assert.match(String(first.error), /disk full/);
  assert.equal(store.data.has(schedule.demoMarkerKey('2026-10-07')), false);
  assert.equal(store.data.has(schedule.DEMO_LOCK), false, 'lock released after a failure');
  const second = await tick(store, reset, new Date('2026-10-07T03:06:00Z'));
  assert.equal(second.outcome, 'ran');
  assert.equal(calls, 2);
});

/* ---------------- login limit ---------------- */

test('published demo accounts have no per-account login budget; the per-IP limit stays', async () => {
  const rl = await import('../src/lib/rateLimit.ts');
  const saved = { ...process.env };
  try {
    Object.assign(process.env, GOOD, { SHOTSTASH_DEMO_MODE: 'true', DEMO_ADMIN_PASSWORD: 'demo-password-1' });
    cfg.resetConfig();
    rl.setRateLimitStore(null);
    rl.resetMemoryLimits();
    // Many addresses hammering one demo account never lock it.
    for (let i = 0; i < 30; i++) assert.equal(await rl.loginLimit(`10.0.0.${i}`, 'Demo-Viewer@example.com'), null, `attempt ${i}`);
    // A real account still gets its per-account limit.
    let limited = null;
    for (let i = 0; i < 12 && limited === null; i++) limited = await rl.loginLimit(`10.1.0.${i}`, 'owner@example.com');
    assert.ok(limited > 0);
    // One address is still limited, demo account or not.
    let byIp = null;
    for (let i = 0; i < 12 && byIp === null; i++) byIp = await rl.loginLimit('10.2.0.1', 'demo-admin@example.com');
    assert.ok(byIp > 0);
    // Outside demo mode the demo addresses are ordinary addresses.
    process.env.SHOTSTASH_DEMO_MODE = 'false';
    cfg.resetConfig();
    assert.equal(rl.isPublishedDemoAccount('demo-admin@example.com'), false);
  } finally {
    process.env = saved;
    cfg.resetConfig();
    rl.resetMemoryLimits();
  }
});

/* ---------------- demo privacy ---------------- */

test('a read-only demo viewer never sees a real account', () => {
  const viewer = { id: 'v', readOnly: true };
  const owner = { id: 'o', email: 'owner@example.com' };
  const demo = { id: 'd', email: 'demo-editor@example.com' };
  assert.equal(accounts.hiddenFromDemoViewer(true, viewer, owner), true);
  assert.equal(accounts.hiddenFromDemoViewer(true, viewer, demo), false);
  assert.equal(accounts.hiddenFromDemoViewer(true, viewer, { id: 'v', email: 'x@example.com' }), false, 'itself');
  assert.equal(accounts.hiddenFromDemoViewer(true, { id: 'a', readOnly: false }, owner), false, 'the owner sees everyone');
  assert.equal(accounts.hiddenFromDemoViewer(false, viewer, owner), false, 'only in demo mode');
  const resolvers = read('src/graphql/resolvers.ts');
  for (const field of ['name', 'email', 'avatarUrl', 'signupAnswers']) {
    assert.match(resolvers, new RegExp(`\\n    ${field}: \\(parent: UserParent, _: unknown, context: GraphQLContext\\) =>\\n      hiddenFromDemoViewer\\(`), field);
  }
});

/* ---------------- config ---------------- */

test('demo mode: features, forced sign-up off, public accounts and password, required password', () => {
  const on = cfg.loadConfig({ ...GOOD, SHOTSTASH_DEMO_MODE: 'true', DEMO_ADMIN_PASSWORD: 'demo-password-1', SHOTSTASH_FEATURE_SIGNUP: 'true' });
  assert.deepEqual(on.problems, []);
  assert.equal(on.config.features.demo, true);
  assert.equal(on.config.features.signup, false, 'a demo never takes sign-ups');
  const off = cfg.loadConfig(GOOD).config.features;
  assert.equal(off.demo, false);
  assert.equal(off.signup, true);
  const missing = cfg.loadConfig({ ...GOOD, SHOTSTASH_DEMO_MODE: 'true' });
  assert.ok(missing.problems.includes('DEMO_ADMIN_PASSWORD: required when SHOTSTASH_DEMO_MODE=true'), missing.problems.join('; '));

  const saved = { ...process.env };
  try {
    Object.assign(process.env, GOOD, { SHOTSTASH_DEMO_MODE: 'true', DEMO_ADMIN_PASSWORD: 'demo-password-1', SETUP_TOKEN: 'top-secret-setup' });
    cfg.resetConfig();
    const pub = cfg.publicConfig();
    assert.deepEqual(pub.demo, {
      accounts: accounts.DEMO_ACCOUNTS.map(({ email, role }) => ({ email, role })),
      password: 'demo-password-1',
    });
    const text = JSON.stringify(pub);
    for (const secret of [GOOD.SESSION_SECRET, 'top-secret-setup', GOOD.DATABASE_URL]) assert.ok(!text.includes(secret));
    process.env.SHOTSTASH_DEMO_MODE = 'false';
    cfg.resetConfig();
    assert.equal(cfg.publicConfig().demo, null, 'never published outside demo mode');
  } finally {
    process.env = saved;
    cfg.resetConfig();
  }
});

/* ---------------- module and routes ---------------- */

test('demo accounts are fixed example.com addresses; the try-it account is the viewer', () => {
  assert.deepEqual(accounts.DEMO_EMAILS, ['demo-admin@example.com', 'demo-editor@example.com', 'demo-viewer@example.com']);
  assert.equal(accounts.DEMO_ACCOUNTS.find((a) => a.email === accounts.DEMO_VIEWER_EMAIL)?.role, 'VIEWER');
  assert.ok(accounts.DEMO_ACCOUNTS.every((a) => a.role !== 'SUPER_ADMIN'));
  assert.equal(accounts.DEMO_SESSION_MINUTES, 60);
});

test('seed and reset never touch instance_settings, and every demo account is read-only', () => {
  const service = read('src/modules/demo/service.ts');
  assert.doesNotMatch(service, /instanceSetting\.(create|update|upsert|delete)/);
  assert.match(service, /readOnly: true/);
  // Accounts are found by demo address and read-only flag; a super admin is never a demo account.
  assert.match(service, /role: \{ not: 'SUPER_ADMIN' \}/);
  assert.match(service, /existing\.role === 'SUPER_ADMIN' \|\| !existing\.readOnly/);
});

test('the try-it route exists only in demo mode, is rate limited, origin-checked and documented', () => {
  const route = read('src/app/api/v1/demo/session/route.ts');
  assert.match(route, /if \(!c\.features\.demo\) return jsonError\(404/);
  assert.match(route, /limitBy\('demoSession'/);
  assert.match(route, /originAllowed\(/);
  assert.match(route, /@openapi/);
  const server = read('server.ts');
  assert.match(server, /applyCors\(req, res/);
  assert.match(server, /nightlyDemoTick\(/);
  // The viewer is looked up before a rate-limit slot is spent.
  assert.ok(route.indexOf('findDemoViewer()') < route.indexOf("limitBy('demoSession'"));
});

test('only sessions with a fixed expiry skip sliding (the try-it token stays 60 minutes)', () => {
  const store = read('src/lib/sessionStore.ts');
  assert.match(store, /if \(!session\.fixedExpiry && expiresAt\.getTime\(\) - now < SESSION_TTL_MS \/ 2\)/);
  assert.match(read('prisma/schema.prisma'), /fixedExpiry Boolean @default\(false\) @map\("fixed_expiry"\)/);
  assert.match(read('src/modules/demo/service.ts'), /createSessionRow\(viewerId, meta, \{ ttlMs: DEMO_SESSION_MINUTES \* 60_000 \}\)/);
});

test('the synthetic document is a valid one-page PDF', async () => {
  const media = await import('../src/modules/demo/media.ts');
  const pdf = media.textPdf('Title (draft)', ['line one', 'a \\ backslash']).toString('latin1');
  assert.match(pdf, /^%PDF-1\.4\n/);
  assert.match(pdf, /%%EOF\n$/);
  const xref = Number(/startxref\n(\d+)\n/.exec(pdf)[1]);
  assert.equal(pdf.slice(xref, xref + 4), 'xref');
  // Every object offset in the table points at its "n 0 obj" line.
  const offsets = [...pdf.slice(xref).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
  offsets.forEach((off, i) => assert.equal(pdf.slice(off, off + `${i + 1} 0 obj`.length), `${i + 1} 0 obj`));
  assert.match(pdf, /\(Title \\\(draft\\\)\) Tj/);
  // Landscapes are vector art: no embedded image or text.
  const svg = media.landscapeSvg(320, 200, 'dusk', 1);
  assert.match(svg, /^<svg /);
  assert.doesNotMatch(svg, /<image|<text/);
});
