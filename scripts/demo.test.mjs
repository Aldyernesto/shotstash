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

test('nightly reset: once per local date, in the 03:00 hour of the instance time zone', () => {
  // 20:15 UTC is 03:15 in Asia/Jakarta (UTC+7).
  const at = new Date('2026-10-07T20:15:00Z');
  assert.equal(schedule.demoResetDue(at, 'Asia/Jakarta', null), '2026-10-08');
  assert.equal(schedule.demoResetDue(at, 'Asia/Jakarta', '2026-10-08'), null, 'already done for that date');
  assert.equal(schedule.demoResetDue(at, 'UTC', null), null, '20:15 in UTC is not due');
  assert.equal(schedule.demoResetDue(new Date('2026-10-07T03:59:00Z'), 'UTC', '2026-10-06'), '2026-10-07');
  assert.equal(schedule.demoResetDue(new Date('2026-10-07T04:00:00Z'), 'UTC', '2026-10-06'), null, 'a missed hour is skipped');
  assert.deepEqual(schedule.localClock(new Date('2026-10-07T00:30:00Z'), 'UTC'), { date: '2026-10-07', hour: 0 });
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
  assert.match(server, /nightlyDemoReset/);
});

test('short sessions never slide (the try-it token stays 60 minutes)', () => {
  const store = read('src/lib/sessionStore.ts');
  assert.match(store, /const slides = expiresAt\.getTime\(\) - session\.createdAt\.getTime\(\) >= SESSION_TTL_MS \/ 2;/);
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
