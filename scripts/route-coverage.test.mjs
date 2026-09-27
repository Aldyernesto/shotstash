// Story 2.1: every route handler and every GraphQL root field declares its auth mode.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeRoute,
  loadAuthMap,
  resolverFields,
  routeFiles,
  schemaFields,
} from './route-matrix-lib.mjs';

const MODES = new Set(['public', 'session', 'cookie', 'signed', 'share']);

test('every exported route handler is a defineRoute() with a known auth mode', () => {
  const problems = [];
  const files = routeFiles();
  assert.ok(files.length > 5, 'route files found');
  for (const file of files) {
    const r = analyzeRoute(file);
    if (!r.methods.length) problems.push(`${r.path}: exports no HTTP method`);
    for (const m of r.methods) {
      if (!m.declared) problems.push(`${m.method} ${r.path}: not wrapped in defineRoute()`);
      else if (!MODES.has(m.declared.auth)) problems.push(`${m.method} ${r.path}: unknown auth "${m.declared.auth}"`);
    }
  }
  assert.deepEqual(problems, []);
});

test('cookie auth is only used under /media', () => {
  for (const file of routeFiles()) {
    const r = analyzeRoute(file);
    for (const m of r.methods) {
      if (m.declared?.auth === 'cookie') assert.ok(r.path.startsWith('/media/'), `${m.method} ${r.path}`);
    }
  }
});

test('no session token rides in a URL anywhere in src', async () => {
  const { readdirSync, readFileSync, statSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { ROOT } = await import('./route-matrix-lib.mjs');
  const hits = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(name) && /[?&]token=/.test(readFileSync(p, 'utf8'))) hits.push(p);
    }
  };
  walk(join(ROOT, 'src'));
  assert.deepEqual(hits, []);
});

test('every GraphQL root field has an auth-map entry and nothing extra', async () => {
  const map = await loadAuthMap();
  const schema = await schemaFields();
  for (const type of ['Query', 'Mutation', 'Subscription']) {
    const missing = schema[type].filter((f) => !map[type][f]).map((f) => `${type}.${f}`);
    const extra = Object.keys(map[type]).filter((f) => !schema[type].includes(f)).map((f) => `${type}.${f}`);
    assert.deepEqual(missing, [], 'schema fields without an auth entry');
    assert.deepEqual(extra, [], 'auth entries without a schema field');
    for (const [f, e] of Object.entries(map[type])) {
      assert.ok(e.auth === 'public' || e.auth === 'session', `${type}.${f} auth ${e.auth}`);
    }
  }
});

test('every resolver has an auth-map entry', async () => {
  const map = await loadAuthMap();
  const fields = resolverFields();
  assert.ok(fields.Query.length > 5 && fields.Mutation.length > 5, 'resolvers parsed');
  const missing = [];
  for (const type of ['Query', 'Mutation', 'Subscription']) {
    for (const f of fields[type]) if (!map[type][f]) missing.push(`${type}.${f}`);
  }
  assert.deepEqual(missing, []);
});

test('only the documented fields are public', async () => {
  const map = await loadAuthMap();
  const pub = [];
  for (const type of ['Query', 'Mutation', 'Subscription']) {
    for (const [f, e] of Object.entries(map[type])) if (e.auth === 'public') pub.push(`${type}.${f}`);
  }
  assert.deepEqual(pub.sort(), [
    'Mutation.completePasswordReset',
    'Mutation.googleAuth',
    'Mutation.login',
    'Mutation.logout',
    'Mutation.register',
    'Mutation.requestPasswordReset',
    'Mutation.verifyPasswordResetCode',
    'Query.me',
    'Query.passwordResetAvailable',
  ]);
});
