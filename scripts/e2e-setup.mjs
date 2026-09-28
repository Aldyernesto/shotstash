// Local end-to-end check of Story 2.6 (first-run setup) on an EMPTY
// database. NOT part of CI.
//
//   npm run dev:db:reset; npm run dev:db        # fresh PGlite
//   npx prisma migrate deploy                   # no seed
//   npm run dev
//   npm run e2e:setup                           # E2E_BASE_URL defaults to http://localhost:3005
//
// Refuses to run unless the base URL and DATABASE_URL both point at
// localhost / 127.0.0.1, and unless the instance is not set up yet.
import 'dotenv/config';

const LOCAL = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
const B = process.env.E2E_BASE_URL || 'http://localhost:3005';
const hostOf = (url) => {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
};
if (!LOCAL.has(hostOf(B))) {
  console.error(`e2e:setup refuses to run: base URL ${B} is not localhost.`);
  process.exit(2);
}
if (!LOCAL.has(hostOf(process.env.DATABASE_URL || ''))) {
  console.error('e2e:setup refuses to run: DATABASE_URL does not point at localhost.');
  process.exit(2);
}

let fails = 0;
const ok = (cond, label, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${label} ${extra}`);
  if (!cond) fails++;
};

let r = await fetch(`${B}/api/health`);
let health = await r.json();
if (health.setupRequired !== true) {
  console.error('e2e:setup needs an empty instance (setupRequired is false). Reset the dev DB first.');
  process.exit(2);
}
ok('db' in health && 'cache' in health && 'storage' in health && 'version' in health && 'schemeMismatch' in health, 'health body fields', JSON.stringify(health));
ok(health.setupRequired === true && (r.status === 200) === health.ok && (health.ok || r.status === 503), 'health before setup (200 when all up, 503 names the dependency)', `${r.status} ${JSON.stringify(health)}`);

// ---- gate
for (const page of ['/', '/dashboard', '/s/abc']) {
  r = await fetch(`${B}${page}`, { redirect: 'manual' });
  ok(r.status === 302 && r.headers.get('location') === '/setup', `page ${page} redirects to /setup`, `${r.status} ${r.headers.get('location')}`);
}
r = await fetch(`${B}/api/graphql`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: '{ me { id } }' }) });
ok(r.status === 503 && (await r.json()).code === 'SETUP_REQUIRED', 'GraphQL 503 SETUP_REQUIRED', r.status);
r = await fetch(`${B}/media/t/x`);
ok(r.status === 503 && (await r.json()).code === 'SETUP_REQUIRED', 'media 503 SETUP_REQUIRED', r.status);
r = await fetch(`${B}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
ok(r.status === 503, 'REST login 503 before setup', r.status);
r = await fetch(`${B}/setup`);
const html = await r.text();
ok(r.status === 200 && html.includes('Create owner account') && /Storage check passed/.test(html), 'setup page renders with storage probe', r.status);
ok(r.headers.get('x-frame-options') === 'DENY' && r.headers.get('x-content-type-options') === 'nosniff', 'security headers on the setup page');

// ---- validation
// Set E2E_SETUP_TOKEN to the server's SETUP_TOKEN to exercise the token path.
const SETUP_TOKEN = process.env.E2E_SETUP_TOKEN || '';
const post = (body, withToken = true) =>
  fetch(`${B}/api/v1/setup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(withToken && SETUP_TOKEN ? { ...body, setupToken: SETUP_TOKEN } : body),
  });
if (SETUP_TOKEN) {
  r = await post({ name: 'Owner', email: 'owner@example.com', password: 'owner-password-1', confirm: 'owner-password-1' }, false);
  ok(r.status === 403 && (await r.json()).code === 'SETUP_TOKEN_INVALID', 'setup without the token 403', r.status);
  r = await post({ name: 'Owner', email: 'owner@example.com', password: 'owner-password-1', confirm: 'owner-password-1', setupToken: 'wrong' }, false);
  ok(r.status === 403, 'setup with a wrong token 403', r.status);
} else {
  console.log('SKIP setup token rows (set SETUP_TOKEN on the server and E2E_SETUP_TOKEN here)');
}
r = await post({ name: 'Owner', email: 'owner@example.com', password: 'short', confirm: 'short' });
ok(r.status === 400 && (await r.json()).code === 'PASSWORD_TOO_SHORT', 'short password 400', r.status);
r = await post({ name: 'Owner', email: 'owner@example.com', password: 'owner-password-1', confirm: 'nope-nope-nope' });
ok(r.status === 400 && (await r.json()).code === 'PASSWORD_MISMATCH', 'confirm mismatch 400', r.status);

// ---- concurrent submissions: exactly one 201, the other 409
const password = 'owner-password-1';
const [a, b] = await Promise.all([
  post({ name: 'Owner', email: 'owner@example.com', password, confirm: password }),
  post({ name: 'Other', email: 'other@example.com', password, confirm: password }),
]);
const statuses = [a.status, b.status].sort();
const loser = a.status === 409 ? a : b;
ok(statuses[0] === 201 && statuses[1] === 409, 'concurrent setup: one 201, one 409', statuses.join(','));
ok((await loser.json()).code === 'SETUP_ALREADY_DONE', 'loser gets SETUP_ALREADY_DONE');
const winnerEmail = a.status === 201 ? 'owner@example.com' : 'other@example.com';

// ---- after setup
r = await post({ name: 'Late', email: 'late@example.com', password, confirm: password });
ok(r.status === 409, 'POST after setup 409', r.status);
r = await fetch(`${B}/setup`, { redirect: 'manual' });
ok(r.status >= 300 && r.status < 400 && (r.headers.get('location') || '').replace(B, '') === '/', 'GET /setup after setup redirects to /', `${r.status} ${r.headers.get('location')}`);
r = await fetch(`${B}/`, { redirect: 'manual' });
ok(r.status === 200, 'login page served after setup', r.status);
r = await fetch(`${B}/api/health`);
health = await r.json();
ok(health.setupRequired === false, 'health setupRequired false after setup');

r = await fetch(`${B}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: winnerEmail, password }) });
const login = await r.json();
ok(r.status === 200 && login.user?.role === 'SUPER_ADMIN' && login.user?.accountStatus === 'ACTIVE', 'new super admin can log in', `${r.status} ${login.user?.role}`);
const users = await (await fetch(`${B}/api/graphql`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${login.token}` }, body: JSON.stringify({ query: '{ users { email role } }' }) })).json();
ok(users.data?.users?.length === 1, 'exactly one account exists', JSON.stringify(users.data?.users ?? users.errors));

console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
