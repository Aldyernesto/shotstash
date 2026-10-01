// Story 2.1: every route handler and every GraphQL root field declares its auth mode.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { AUTH_SECURITY, UNGATED_PATHS as AUTH_GATE_UNGATED, leakProblems, referenceProblems } from './gen-openapi.mjs';
import {
  ROOT,
  analyzeRoute,
  hasDynamicSegment,
  loadAuthMap,
  openApiPathOf,
  resolverFields,
  routeFiles,
  schemaFields,
} from './route-matrix-lib.mjs';

/** The JSDoc block directly above `export const <method>` (or `export async function <method>`), or null. */
function jsdocBefore(file, method) {
  const src = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const at = src.search(new RegExp(`^export (const|async function|function) ${method}\\b`, 'm'));
  if (at < 0) return null;
  const before = src.slice(0, at).trimEnd();
  if (!before.endsWith('*/')) return null;
  return before.slice(before.lastIndexOf('/**'));
}

const MODES = new Set(['public', 'session', 'cookie', 'signed', 'share', 'worker']);

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

test('worker auth is used exactly by the pipeline contract routes, and nothing else uses them', () => {
  const pipeline = [];
  for (const file of routeFiles()) {
    const r = analyzeRoute(file);
    for (const m of r.methods) {
      const isPipeline = r.path.startsWith('/api/v1/pipeline/');
      if (isPipeline) pipeline.push(`${m.method} ${r.path}`);
      assert.equal(m.declared?.auth === 'worker', isPipeline, `${m.method} ${r.path}: ${m.declared?.auth}`);
    }
  }
  assert.deepEqual(pipeline.sort(), [
    'GET /api/v1/pipeline/jobs/[id]/input',
    'POST /api/v1/pipeline/jobs/[id]/complete',
    'POST /api/v1/pipeline/jobs/[id]/fail',
    'POST /api/v1/pipeline/jobs/[id]/progress',
    'POST /api/v1/pipeline/jobs/[id]/release',
    'POST /api/v1/pipeline/jobs/next',
    'POST /api/v1/pipeline/workers/heartbeat',
    'POST /api/v1/pipeline/workers/register',
    'PUT /api/v1/pipeline/jobs/[id]/output',
  ]);
});

// Story 7.3: POST routes that read no body (the Bearer token is the whole request).
const NO_BODY = new Set(['POST /api/v1/auth/cookie', 'POST /api/v1/auth/logout']);

test('every route under src/app/api, src/app/media and src/app/s carries its OpenAPI annotations', () => {
  const problems = [];
  const files = routeFiles();
  for (const file of files) {
    const r = analyzeRoute(file);
    const rel = relative(ROOT, file).split(sep).join('/');
    if (!/^src\/app\/(api|media|s)\//.test(rel)) {
      problems.push(`${rel}: route outside api, media and s (document it and extend the OpenAPI scope)`);
      continue;
    }
    for (const m of r.methods) {
      const where = `${rel} ${m.method}`;
      const doc = jsdocBefore(file, m.method);
      if (!doc) {
        problems.push(`${where}: no JSDoc on the export`);
        continue;
      }
      if (!/^\s*\*\s+[A-Z][^@\n]+$/m.test(doc)) problems.push(`${where}: no summary line`);
      for (const tag of ['@openapi', '@description', '@tag', '@response']) if (!doc.includes(tag)) problems.push(`${where}: missing ${tag}`);
      const auth = doc.match(/@auth (\w+)/)?.[1];
      // `bootstrap: true` is read from this method's own defineRoute() call.
      const expected = m.declared?.bootstrap ? 'bootstrap' : m.declared?.auth;
      if (auth !== expected) problems.push(`${where}: @auth ${auth ?? '(missing)'} but defineRoute auth is ${expected}`);
      const needsBody = ['POST', 'PUT', 'PATCH'].includes(m.method) && !NO_BODY.has(`${m.method} ${r.path}`);
      if (needsBody && !/@body \w+/.test(doc)) problems.push(`${where}: missing @body`);
      if (hasDynamicSegment(r.path) && !/@pathParams \w+/.test(doc)) problems.push(`${where}: missing @pathParams`);
    }
  }
  assert.deepEqual(problems, []);
});

test('openapi.json has one operation per exported route method and nothing else', () => {
  const doc = JSON.parse(readFileSync(join(ROOT, 'openapi.json'), 'utf8'));
  assert.equal(doc.openapi, '3.1.0');
  const expected = [];
  for (const file of routeFiles()) {
    const r = analyzeRoute(file);
    const path = openApiPathOf(r.path);
    for (const m of r.methods) expected.push(`${m.method} ${path}`);
  }
  const actual = [];
  for (const [path, item] of Object.entries(doc.paths)) {
    for (const method of Object.keys(item)) actual.push(`${method.toUpperCase()} ${path}`);
  }
  assert.deepEqual(actual.sort(), expected.sort(), 'run `npm run openapi` after changing a route');
});

test('openapi.json maps every auth mode to its security and embeds no host or token', () => {
  const text = readFileSync(join(ROOT, 'openapi.json'), 'utf8');
  const doc = JSON.parse(text);
  assert.deepEqual(doc.servers.map((s) => s.url), ['/']);
  for (const [path, item] of Object.entries(doc.paths)) {
    for (const [method, op] of Object.entries(item)) {
      const mode = op['x-shotstash-auth'];
      assert.ok(mode in AUTH_SECURITY, `${method} ${path}: ${mode}`);
      assert.deepEqual(op.security, AUTH_SECURITY[mode], `${method} ${path}`);
    }
  }
  assert.deepEqual(leakProblems(text), []);
  assert.doesNotMatch(text, /demo/i, 'no demo host or token until the demo instance exists');
  assert.deepEqual(referenceProblems(doc), []);
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

test('only health, config and setup are served before first-run setup (Stories 2.6, 6.3)', async () => {
  const { readFileSync } = await import('node:fs');
  const { routePathOf } = await import('./route-matrix-lib.mjs');
  const early = routeFiles()
    .filter((f) => /allowBeforeSetup\s*:\s*true/.test(readFileSync(f, 'utf8')))
    .map((f) => routePathOf(f))
    .sort();
  assert.deepEqual(early, ['/api/health', '/api/v1/config', '/api/v1/setup']);
  assert.deepEqual([...AUTH_GATE_UNGATED].sort(), early, 'gen-openapi UNGATED_PATHS must list the same routes');
  // Nothing else may opt in by any other spelling.
  for (const f of routeFiles()) {
    const src = readFileSync(f, 'utf8');
    if (/allowBeforeSetup/.test(src)) assert.ok(early.includes(routePathOf(f)), routePathOf(f));
  }
});

test('path conversion handles dynamic, catch-all and optional catch-all segments', () => {
  assert.equal(openApiPathOf('/media/d/[fileId]'), '/media/d/{fileId}');
  assert.equal(openApiPathOf('/docs/[...slug]'), '/docs/{slug}');
  assert.equal(openApiPathOf('/docs/[[...slug]]'), '/docs/{slug}');
  assert.equal(openApiPathOf('/a/[x]/b/[...rest]'), '/a/{x}/b/{rest}');
  for (const p of ['/x/[id]', '/x/[...all]', '/x/[[...all]]']) assert.ok(hasDynamicSegment(p), p);
  assert.ok(!hasDynamicSegment('/api/health'));
});

test('bootstrap is read per method from its own defineRoute() call', async () => {
  const { writeFileSync, mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const dir = mkdtempSync(join(tmpdir(), 'route-'));
  const file = join(dir, 'route.ts');
  writeFileSync(file, [
    "export const POST = defineRoute({ auth: 'worker', bootstrap: true, handler: async () => null });",
    "export const GET = defineRoute({ auth: 'worker', handler: async () => null });",
  ].join('\n'));
  try {
    const byMethod = Object.fromEntries(analyzeRoute(file).methods.map((m) => [m.method, m.declared.bootstrap]));
    assert.deepEqual(byMethod, { POST: true, GET: false });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
