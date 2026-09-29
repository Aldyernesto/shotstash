// Stories 6.1-6.3: runtime configuration, generated .env.example, public
// config, JSON logs and the sign-up toggle.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { Writable } from 'node:stream';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cfg = await import('../src/lib/config.ts');
const gen = await import('./gen-env-example.mjs');

// Spelled in two parts: CI fails on the literal prefix anywhere in the tree.
const PUBLIC_PREFIX = 'NEXT_' + 'PUBLIC_';

const GOOD = {
  DATABASE_URL: 'postgresql://u:p@127.0.0.1:5432/db',
  SESSION_SECRET: 's'.repeat(64),
};

/* ---------------- parsing ---------------- */

test('defaults: a minimal environment parses cleanly', () => {
  const { config, problems } = cfg.loadConfig(GOOD);
  assert.deepEqual(problems, []);
  assert.equal(config.PORT, 3005);
  assert.equal(config.TRUST_PROXY, false);
  assert.equal(config.LOG_LEVEL, 'info');
  assert.equal(config.STORAGE_LOCAL_ROOT, './data/media');
  assert.equal(config.DRAGONFLY_HOST, '127.0.0.1');
  assert.equal(config.DRAGONFLY_PORT, 6379);
  assert.equal(config.SHOTSTASH_TRASH_RETENTION_DAYS, 30);
  assert.equal(config.SHOTSTASH_DEFAULT_TIMEZONE, 'UTC');
  assert.equal(config.SHOTSTASH_FEATURE_SIGNUP, true);
  assert.equal(config.appUrl, 'http://localhost:3005');
  assert.equal(config.defaultLocale, 'en');
  assert.equal(config.version, JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version);
});

test('empty strings count as unset (an .env line with no value)', () => {
  const { config, problems } = cfg.loadConfig({ ...GOOD, PORT: '', TRUST_PROXY: '  ', APP_URL: '' });
  assert.deepEqual(problems, []);
  assert.equal(config.PORT, 3005);
  assert.equal(config.TRUST_PROXY, false);
});

test('values are typed: numbers, booleans, URLs, version from the image', () => {
  const { config, problems } = cfg.loadConfig({
    ...GOOD,
    PORT: '8080',
    TRUST_PROXY: 'TRUE',
    APP_URL: 'https://media.example.com/',
    SHOTSTASH_TRASH_RETENTION_DAYS: '7',
    SHOTSTASH_VERSION: '1.2.3',
  });
  assert.deepEqual(problems, []);
  assert.equal(config.PORT, 8080);
  assert.equal(config.TRUST_PROXY, true);
  assert.equal(config.appUrl, 'https://media.example.com');
  assert.equal(config.SHOTSTASH_TRASH_RETENTION_DAYS, 7);
  assert.equal(config.version, '1.2.3');
});

test('bad values: every problem is listed by variable name, nothing throws', () => {
  const { config, problems } = cfg.loadConfig({
    SESSION_SECRET: cfg.SECRET_PLACEHOLDER,
    SHOTSTASH_TRASH_RETENTION_DAYS: 'abc',
    PORT: '70000',
    TRUST_PROXY: 'maybe',
    APP_URL: 'not a url',
    SHOTSTASH_DEFAULT_TIMEZONE: 'Mars/Olympus',
  });
  const names = problems.map((p) => p.split(':')[0]).sort();
  assert.deepEqual(names, [
    'APP_URL',
    'DATABASE_URL',
    'PORT',
    'SESSION_SECRET',
    'SHOTSTASH_DEFAULT_TIMEZONE',
    'SHOTSTASH_TRASH_RETENTION_DAYS',
    'TRUST_PROXY',
  ]);
  assert.match(problems.find((p) => p.startsWith('DATABASE_URL')), /not set/);
  // Bad values fall back to their defaults until boot refuses to start.
  assert.equal(config.SHOTSTASH_TRASH_RETENTION_DAYS, 30);
});

test('placeholder or short secrets are rejected with the generate hint', () => {
  for (const name of ['SESSION_SECRET', 'MEDIA_SIGNING_SECRET']) {
    const placeholder = cfg.loadConfig({ ...GOOD, [name]: cfg.SECRET_PLACEHOLDER }).problems.find((p) => p.startsWith(`${name}:`));
    assert.match(placeholder, /placeholder/);
    assert.match(placeholder, /openssl rand -hex 32/);
    const short = cfg.loadConfig({ ...GOOD, [name]: 'x'.repeat(31) }).problems.find((p) => p.startsWith(`${name}:`));
    assert.match(short, /at least 32/);
  }
});

test('assertConfig throws one ConfigError listing every problem', () => {
  const saved = { ...process.env };
  try {
    for (const k of Object.keys(cfg.VARIABLES)) delete process.env[k];
    process.env.SHOTSTASH_TRASH_RETENTION_DAYS = 'abc';
    cfg.resetConfig();
    assert.throws(
      () => cfg.assertConfig(),
      (err) =>
        err instanceof cfg.ConfigError &&
        err.problems.some((p) => p.startsWith('SESSION_SECRET:')) &&
        err.problems.some((p) => p.startsWith('SHOTSTASH_TRASH_RETENTION_DAYS:')) &&
        /SESSION_SECRET/.test(err.message),
    );
  } finally {
    process.env = saved;
    cfg.resetConfig();
  }
});

test('config() refuses to run during next build', () => {
  const saved = process.env.NEXT_PHASE;
  process.env.NEXT_PHASE = 'phase-production-build';
  cfg.resetConfig();
  try {
    assert.throws(() => cfg.config(), /next build/);
  } finally {
    if (saved === undefined) delete process.env.NEXT_PHASE;
    else process.env.NEXT_PHASE = saved;
    cfg.resetConfig();
  }
});

/* ---------------- naming rule ---------------- */

test('naming rule: SHOTSTASH_* for product settings, plain names for infrastructure, no build-time public prefix', () => {
  const bad = [];
  for (const [name, def] of Object.entries(cfg.VARIABLES)) {
    if (!/^[A-Z][A-Z0-9]*(_[A-Z0-9]+)*$/.test(name)) bad.push(`${name}: not UPPER_SNAKE_CASE`);
    if (name.startsWith(PUBLIC_PREFIX)) bad.push(`${name}: build-time public variables are not allowed`);
    if (def.kind === 'product' && !name.startsWith('SHOTSTASH_')) bad.push(`${name}: product settings start with SHOTSTASH_`);
    if (def.kind === 'infra' && name.startsWith('SHOTSTASH_')) bad.push(`${name}: infrastructure keeps a plain name`);
    if (!cfg.GROUPS.includes(def.group)) bad.push(`${name}: unknown group ${def.group}`);
    if (!def.description) bad.push(`${name}: no description`);
    if (def.secret && def.example) bad.push(`${name}: a secret never has an example value`);
  }
  assert.deepEqual(bad, []);
  assert.ok(!('COOKIE_DOMAIN' in cfg.VARIABLES), 'COOKIE_DOMAIN is gone');
});

/* ---------------- features and public config ---------------- */

test('features are derived from the environment', () => {
  const off = cfg.loadConfig(GOOD).config.features;
  assert.deepEqual(off, { signup: true, google: false, search: false, passwordResetEmail: false });
  const on = cfg.loadConfig({
    ...GOOD,
    SHOTSTASH_FEATURE_SIGNUP: 'false',
    GOOGLE_CLIENT_ID: 'id.apps.googleusercontent.com',
    ELASTICSEARCH_NODE_URL: 'http://elasticsearch:9200',
    EMAIL_TRANSPORT: 'log',
  }).config.features;
  assert.deepEqual(on, { signup: false, google: true, search: true, passwordResetEmail: true });
  assert.equal(cfg.loadConfig({ ...GOOD, RESEND_API_KEY: 're_x' }).config.features.passwordResetEmail, true);
  assert.equal(cfg.loadConfig({ ...GOOD, EMAIL_TRANSPORT: 'resend' }).config.features.passwordResetEmail, false);
});

test('GET /api/v1/config shape: public settings only, never a secret', () => {
  const saved = { ...process.env };
  try {
    Object.assign(process.env, GOOD, { GOOGLE_CLIENT_ID: 'gid', SHOTSTASH_VERSION: '9.9.9', SETUP_TOKEN: 'top-secret' });
    cfg.resetConfig();
    const pub = cfg.publicConfig();
    assert.deepEqual(Object.keys(pub).sort(), ['appUrl', 'defaultLocale', 'features', 'googleClientId', 'version']);
    assert.equal(pub.googleClientId, 'gid');
    assert.equal(pub.version, '9.9.9');
    const text = JSON.stringify(pub);
    for (const secret of [GOOD.SESSION_SECRET, 'top-secret', GOOD.DATABASE_URL]) assert.ok(!text.includes(secret));
    delete process.env.GOOGLE_CLIENT_ID;
    cfg.resetConfig();
    assert.equal(cfg.publicConfig().googleClientId, null);
  } finally {
    process.env = saved;
    cfg.resetConfig();
  }
  const route = readFileSync(path.join(ROOT, 'src/app/api/v1/config/route.ts'), 'utf8');
  assert.match(route, /auth: 'public'/);
  assert.match(route, /allowBeforeSetup: true/);
  assert.match(route, /no-store/);
});

test('sign-up toggle: the shared guard refuses public sign-up only, with FEATURE_DISABLED', async () => {
  const { publicSignupRefusal } = await import('../src/lib/signupGuard.ts');
  const saved = { ...process.env };
  try {
    Object.assign(process.env, GOOD, { SHOTSTASH_FEATURE_SIGNUP: 'false' });
    cfg.resetConfig();
    const signup = cfg.config().features.signup;
    assert.equal(signup, false);
    // Stand-in for AuthService.registerUser: it must not run for a refused sign-up.
    let registered = 0;
    const register = (adminCreate) => {
      const refusal = publicSignupRefusal(adminCreate, signup);
      if (refusal) return refusal;
      registered++;
      return { success: true };
    };
    const refused = register(false);
    assert.equal(refused.success, false);
    assert.equal(refused.errorCode, 'FEATURE_DISABLED');
    assert.equal(registered, 0);
    // An admin creating an account still passes the guard.
    assert.deepEqual(register(true), { success: true });
    assert.equal(registered, 1);
    // Sign-up on: nobody is refused.
    assert.equal(publicSignupRefusal(false, true), null);
  } finally {
    process.env = saved;
    cfg.resetConfig();
  }
  const en = JSON.parse(readFileSync(path.join(ROOT, 'messages/en.json'), 'utf8'));
  assert.ok(en.errors.codes.FEATURE_DISABLED);
  assert.ok(en.authErrors.signupDisabled);
  // Both sign-up paths use the guard; the schema carries the toggles without changing shape.
  for (const f of ['src/graphql/resolvers.ts', 'src/services/google-auth.service.ts']) {
    assert.match(readFileSync(path.join(ROOT, f), 'utf8'), /publicSignupRefusal\(/, f);
  }
  assert.match(readFileSync(path.join(ROOT, 'src/graphql/schema.ts'), 'utf8'), /features: Features!/);
});

test('cross-field: EMAIL_TRANSPORT=resend needs RESEND_API_KEY', () => {
  const { problems } = cfg.loadConfig({ ...GOOD, EMAIL_TRANSPORT: 'resend' });
  assert.ok(problems.includes('RESEND_API_KEY: required when EMAIL_TRANSPORT=resend'), problems.join('; '));
  assert.deepEqual(cfg.loadConfig({ ...GOOD, EMAIL_TRANSPORT: 'resend', RESEND_API_KEY: 're_x' }).problems, []);
});

test('trash retention: 1 to 36500 days', () => {
  for (const bad of ['0', '-1', '36501', '1e9', '2.5']) {
    const { problems } = cfg.loadConfig({ ...GOOD, SHOTSTASH_TRASH_RETENTION_DAYS: bad });
    assert.ok(problems.some((p) => p.startsWith('SHOTSTASH_TRASH_RETENTION_DAYS:')), bad);
  }
  assert.equal(cfg.loadConfig({ ...GOOD, SHOTSTASH_TRASH_RETENTION_DAYS: '36500' }).config.SHOTSTASH_TRASH_RETENTION_DAYS, 36500);
});

test('secrets: the length counts without surrounding whitespace; all-whitespace is rejected', () => {
  for (const value of [`${' '.repeat(31)}x`, ' '.repeat(40), `\t${'y'.repeat(31)}\t`]) {
    const { problems } = cfg.loadConfig({ ...GOOD, SESSION_SECRET: value });
    assert.ok(problems.some((p) => p.startsWith('SESSION_SECRET:')), JSON.stringify(value));
  }
  assert.deepEqual(cfg.loadConfig({ ...GOOD, SESSION_SECRET: ` ${'z'.repeat(32)} ` }).problems, []);
});

test('APP_URL: http or https only, no query or fragment', () => {
  for (const bad of ['ftp://media.example.com', 'http://media.example.com/?a=1', 'https://media.example.com/#top', 'mailto:a@b.c']) {
    const { problems } = cfg.loadConfig({ ...GOOD, APP_URL: bad });
    assert.ok(problems.some((p) => p.startsWith('APP_URL:')), bad);
  }
  for (const good of ['http://192.168.1.20:3005', 'https://media.example.com', 'https://example.com/shotstash/']) {
    assert.deepEqual(cfg.loadConfig({ ...GOOD, APP_URL: good }).problems, [], good);
  }
});

test('setup token: read from the configuration, submitted value trimmed', async () => {
  const { setupTokenMatches, setupTokenRequired } = await import('../src/modules/setup/validate.ts');
  const saved = { ...process.env };
  try {
    process.env.SETUP_TOKEN = 'setup-token-0123456789';
    cfg.resetConfig();
    assert.equal(setupTokenRequired(), true);
    assert.equal(setupTokenMatches('setup-token-0123456789'), true);
    assert.equal(setupTokenMatches('  setup-token-0123456789\n'), true);
    assert.equal(setupTokenMatches('setup-token-wrong'), false);
    assert.equal(setupTokenMatches('   '), false);
    delete process.env.SETUP_TOKEN;
    cfg.resetConfig();
    assert.equal(setupTokenRequired(), false);
  } finally {
    process.env = saved;
    cfg.resetConfig();
  }
});

/* ---------------- generated files ---------------- */

test('.env.example and docs/configuration.md equal the generator output', () => {
  const read = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
  assert.equal(read(gen.ENV_EXAMPLE), gen.renderEnvExample());
  assert.equal(read(gen.CONFIG_DOC), gen.renderConfigDoc());
  const r = spawnSync(process.execPath, ['scripts/gen-env-example.mjs', '--check'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
});

test('.env.example: every variable once, secrets empty, image-managed ones commented out', () => {
  const text = gen.renderEnvExample();
  for (const [name, def] of Object.entries(cfg.VARIABLES)) {
    const lines = text.split('\n').filter((l) => l.replace(/^# /, '').startsWith(`${name}=`));
    assert.equal(lines.length, 1, name);
    if (def.secret) assert.equal(lines[0].replace(/^# /, ''), `${name}=`, name);
    if (def.managed) assert.ok(lines[0].startsWith('# '), `${name} commented out`);
  }
  assert.ok(!text.includes(PUBLIC_PREFIX) && !text.includes('COOKIE_DOMAIN'));
});

/* ---------------- logger ---------------- */

test('logger emits one JSON line per event with level, time, scope and message', async () => {
  const { setLogDestination, logger } = await import('../src/lib/logger.ts');
  const lines = [];
  const sink = new Writable({
    write(chunk, _enc, cb) {
      lines.push(...chunk.toString().split('\n').filter(Boolean));
      cb();
    },
  });
  setLogDestination(sink, 'info');
  try {
    const log = logger('test');
    log.info('hello', { files: 3 });
    log.debug('hidden below the level');
    log.error('failed', { err: new Error('boom') });
  } finally {
    setLogDestination(null);
  }
  assert.equal(lines.length, 2);
  const first = JSON.parse(lines[0]);
  assert.equal(first.level, 'info');
  assert.equal(first.scope, 'test');
  assert.equal(first.msg, 'hello');
  assert.equal(first.files, 3);
  assert.ok(!Number.isNaN(Date.parse(first.time)));
  const second = JSON.parse(lines[1]);
  assert.equal(second.level, 'error');
  assert.equal(second.err.message, 'boom');
});
