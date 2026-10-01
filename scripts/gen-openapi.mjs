// Story 7.3: writes openapi.json at the repository root from the route
// annotations (next-openapi-gen with openapi-gen.config.ts), then validates it
// as OpenAPI 3.1.
//
//   npm run openapi          regenerate openapi.json
//   npm run openapi:check    regenerate in a temporary folder; fail when the
//                            committed file differs as parsed JSON (formatting
//                            and key order do not count) or does not validate
//
// The generator runs with its output and work folders in the OS temp
// directory, so nothing but openapi.json is written to the repository. The
// result is post-processed deterministically:
//   - `@auth <mode>` (the defineRoute auth modes) becomes the matching
//     security requirement, and `x-shotstash-auth` keeps the mode;
//   - byte answers (MediaBytes, JpegImage, ZipArchive, BinaryBody, NoBody)
//     get their real media types instead of JSON;
//   - placeholder path parameter examples and brace-y operation ids are
//     replaced; paths, components and tags are sorted.

import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(ROOT, 'openapi.json');
const CHECK = process.argv.includes('--check');

/** Security requirements per `@auth` mode (src/lib/defineRoute.ts). */
export const AUTH_SECURITY = {
  public: [],
  session: [{ SessionToken: [] }],
  cookie: [{ SessionCookie: [] }],
  // The token is the path itself (HMAC-signed, checked again against the share link).
  signed: [],
  // PUBLIC links need nothing, PRIVATE links the unlock cookie.
  share: [{ ShareCookie: [] }, {}],
  worker: [{ WorkerToken: [] }],
  bootstrap: [{ WorkerBootstrapToken: [] }],
};

/** Byte answers and bodies: schema name, media type and an inline schema. */
const BINARY = {
  MediaBytes: { type: 'application/octet-stream', description: 'Raw file bytes; Content-Type is the media type of the file.' },
  JpegImage: { type: 'image/jpeg', description: 'A JPEG image.' },
  ZipArchive: { type: 'application/zip', description: 'A ZIP archive (STORE, ZIP64 when needed).' },
  BinaryBody: { type: 'application/octet-stream', description: 'Raw bytes, streamed.' },
  NoBody: null,
};

const METHOD_ORDER = ['get', 'head', 'post', 'put', 'patch', 'delete', 'options'];

/**
 * Routes served before first-run setup (`allowBeforeSetup: true`); every
 * other route answers 503 SETUP_REQUIRED until setup is done. The route
 * coverage test keeps this list equal to the route files.
 */
export const UNGATED_PATHS = ['/api/health', '/api/v1/config', '/api/v1/setup'];

const SETUP_REQUIRED_REF = '#/components/responses/SetupRequired';
const SETUP_REQUIRED_RESPONSE = {
  description:
    'SETUP_REQUIRED: first-run setup is not done yet. Every route except health, config and setup answers this until the first super admin exists.',
  content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorBody' } } },
};

/**
 * OpenAPI 3.0 `nullable: true` as a 3.1 type: `type: x` becomes
 * `type: [x, 'null']`, a `$ref` or a composition gains a `null` branch.
 * `nullable` is always removed.
 */
export function nullableToType(node) {
  if (node.nullable !== true) {
    delete node.nullable;
    return node;
  }
  delete node.nullable;
  if (typeof node.type === 'string') node.type = node.type === 'null' ? 'null' : [node.type, 'null'];
  else if (Array.isArray(node.type)) {
    if (!node.type.includes('null')) node.type.push('null');
  } else if (Array.isArray(node.anyOf) || Array.isArray(node.oneOf)) {
    const list = node.anyOf ?? node.oneOf;
    if (!list.some((s) => s?.type === 'null')) list.push({ type: 'null' });
  } else if (typeof node.$ref === 'string') {
    const ref = node.$ref;
    delete node.$ref;
    node.anyOf = [{ $ref: ref }, { type: 'null' }];
  }
  return node;
}

const sortKeys = (obj) => Object.fromEntries(Object.entries(obj).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));

function operationIdOf(method, path) {
  const words = path
    .split('/')
    .filter(Boolean)
    .map((seg) => (seg.startsWith('{') ? `by-${seg.slice(1, -1)}` : seg));
  const camel = [method, ...words]
    .join('-')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w, i) => (i === 0 ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1)))
    .join('');
  return camel;
}

function binaryContent(content) {
  if (!content) return content;
  for (const media of Object.values(content)) {
    const name = media?.schema?.$ref?.replace('#/components/schemas/', '');
    if (name && name in BINARY) return { name, spec: BINARY[name] };
  }
  return null;
}

/** Applies the deterministic Shotstash rules to a generated document. */
export function postProcess(doc) {
  const problems = [];
  const paths = {};
  for (const [path, item] of Object.entries(doc.paths ?? {})) {
    const out = {};
    const methods = Object.keys(item).sort((a, b) => METHOD_ORDER.indexOf(a) - METHOD_ORDER.indexOf(b));
    for (const method of methods) {
      const op = item[method];
      if (!METHOD_ORDER.includes(method)) {
        out[method] = op;
        continue;
      }
      // Security from the @auth mode.
      const modes = (op.security ?? []).flatMap((req) => Object.keys(req));
      const mode = modes[0];
      if (modes.length !== 1 || !(mode in AUTH_SECURITY)) {
        problems.push(`${method.toUpperCase()} ${path}: @auth must be one of ${Object.keys(AUTH_SECURITY).join(', ')} (got ${modes.join(', ') || 'nothing'})`);
      }
      op.security = structuredClone(AUTH_SECURITY[mode] ?? []);
      op['x-shotstash-auth'] = mode;
      op.operationId = operationIdOf(method, path);
      for (const p of op.parameters ?? []) {
        // The generator adds placeholder examples (`123`, `example`) to every parameter.
        delete p.example;
        // TypeScript header types spell `-` as `_` (the generator drops quoted keys).
        if (p.in === 'header') p.name = p.name.replace(/_/g, '-');
      }
      // Byte request bodies.
      const req = binaryContent(op.requestBody?.content);
      if (req) {
        op.requestBody.content = { [req.spec.type]: { schema: { type: 'string', contentMediaType: req.spec.type, description: req.spec.description } } };
        op.requestBody.required = true;
      }
      // A `file` field of a multipart body is bytes.
      const form = op.requestBody?.content?.['multipart/form-data']?.schema?.$ref?.replace('#/components/schemas/', '');
      const fileProp = form && doc.components?.schemas?.[form]?.properties?.file;
      if (fileProp?.type === 'string') fileProp.contentMediaType = 'application/octet-stream';
      // Byte answers and answers without a body.
      for (const [code, res] of Object.entries(op.responses ?? {})) {
        const bin = binaryContent(res.content);
        if (!bin) continue;
        if (!bin.spec || method === 'head') delete res.content;
        else res.content = { [bin.spec.type]: { schema: { type: 'string', contentMediaType: bin.spec.type, description: bin.spec.description } } };
        op.responses[code] = res;
      }
      // HEAD answers carry headers only.
      if (method === 'head') for (const res of Object.values(op.responses ?? {})) delete res.content;
      // The setup gate: one shared 503 response on every gated route.
      if (!UNGATED_PATHS.includes(path)) {
        op.responses ??= {};
        const own = op.responses['503'];
        if (!own) op.responses['503'] = { $ref: SETUP_REQUIRED_REF };
        else if (own.description && !own.description.includes('SETUP_REQUIRED')) own.description += ' or SETUP_REQUIRED (first-run setup not done)';
        op.responses = Object.fromEntries(Object.entries(op.responses).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
      }
      out[method] = op;
    }
    paths[path] = out;
  }
  doc.paths = sortKeys(paths);

  const schemas = { ...(doc.components?.schemas ?? {}) };
  for (const name of Object.keys(BINARY)) delete schemas[name];
  // Parameter types (path, query, header) are expanded into parameters and
  // some nested types are inlined: keep only the schemas something references.
  const used = new Set();
  const collect = (node) => {
    if (Array.isArray(node)) return node.forEach(collect);
    if (!node || typeof node !== 'object') return;
    if (typeof node.$ref === 'string' && node.$ref.startsWith('#/components/schemas/')) {
      const name = node.$ref.slice('#/components/schemas/'.length);
      if (!used.has(name)) {
        used.add(name);
        collect(schemas[name]);
      }
    }
    for (const v of Object.values(node)) collect(v);
  };
  const responses = { ...(doc.components?.responses ?? {}), SetupRequired: structuredClone(SETUP_REQUIRED_RESPONSE) };
  collect(paths);
  collect(responses);
  for (const name of Object.keys(schemas)) if (!used.has(name)) delete schemas[name];
  // OpenAPI 3.0 leftovers of the generator: `nullable` (3.1 uses a `null`
  // type) and a nullable enum without `null` among its values.
  const tidy = (node) => {
    if (Array.isArray(node)) return node.forEach(tidy);
    if (!node || typeof node !== 'object') return;
    nullableToType(node);
    if (Array.isArray(node.enum) && Array.isArray(node.type) && node.type.includes('null') && !node.enum.includes(null)) node.enum.push(null);
    Object.values(node).forEach(tidy);
  };
  tidy(paths);
  tidy(schemas);
  doc.components = sortKeys({ ...(doc.components ?? {}), responses: sortKeys(responses), schemas: sortKeys(schemas) });
  if (doc.components.securitySchemes) doc.components.securitySchemes = sortKeys(doc.components.securitySchemes);
  if (Array.isArray(doc.tags)) doc.tags = [...doc.tags].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  // Top-level order as in the specification.
  const order = ['openapi', 'info', 'jsonSchemaDialect', 'servers', 'tags', 'paths', 'webhooks', 'components', 'security', 'externalDocs'];
  const sorted = {};
  for (const k of order) if (k in doc) sorted[k] = doc[k];
  for (const k of Object.keys(doc)) if (!(k in sorted)) sorted[k] = doc[k];
  return { doc: sorted, problems };
}

/** Every `$ref` points at an existing component; every security requirement names a scheme. */
export function referenceProblems(doc) {
  const problems = [];
  const visit = (node, where) => {
    if (Array.isArray(node)) return node.forEach((n, i) => visit(n, `${where}[${i}]`));
    if (!node || typeof node !== 'object') return;
    if (typeof node.$ref === 'string') {
      const parts = node.$ref.replace(/^#\//, '').split('/');
      let target = doc;
      for (const p of parts) target = target?.[p];
      if (target === undefined) problems.push(`${where}: unresolved ${node.$ref}`);
    }
    for (const [k, v] of Object.entries(node)) visit(v, `${where}.${k}`);
  };
  visit(doc, '#');
  const schemes = doc.components?.securitySchemes ?? {};
  for (const [path, item] of Object.entries(doc.paths ?? {})) {
    for (const [method, op] of Object.entries(item)) {
      for (const req of op.security ?? []) {
        for (const name of Object.keys(req)) if (!schemes[name]) problems.push(`${method.toUpperCase()} ${path}: unknown security scheme ${name}`);
      }
    }
  }
  return problems;
}

/** Strings that must never appear in the published document. */
export function leakProblems(text) {
  const problems = [];
  const checks = [
    [/localhost|127\.0\.0\.1|\[::1\]/i, 'a local host'],
    [/https?:\/\/(?!spec\.openapis\.org\/|json-schema\.org\/)[^"\s]+/i, 'an absolute URL (servers must stay "/")'],
    [/[A-Za-z]:\\\\|\/Users\/|\/home\//, 'a machine path'],
    [/\b[0-9a-f]{32,}\b/i, 'a token-looking hex string'],
    [/eyJ[A-Za-z0-9_-]{10,}/, 'a token-looking JWT'],
  ];
  for (const [re, what] of checks) {
    const m = text.match(re);
    if (m) problems.push(`openapi.json contains ${what}: ${m[0]}`);
  }
  return problems;
}

async function generate() {
  const work = mkdtempSync(join(tmpdir(), 'shotstash-openapi-'));
  try {
    const { default: base } = await import(pathToFileURL(join(ROOT, 'openapi-gen.config.ts')).href);
    const cfg = {
      ...structuredClone(base),
      apiDir: resolve(ROOT, base.apiDir),
      schemaDir: base.schemaDir.map((d) => resolve(ROOT, d)),
      outputDir: work,
      outputFile: 'openapi.json',
      generatedDir: join(work, '.openapi-gen'),
      cache: false,
    };
    const cfgPath = join(work, 'openapi-gen.config.json');
    writeFileSync(cfgPath, JSON.stringify(cfg));
    const { generateProject } = await import('next-openapi-gen');
    // The generator logs progress on stdout; keep the output of this script short.
    const log = console.log;
    console.log = () => {};
    let result;
    try {
      result = await generateProject({ cwd: ROOT, configPath: cfgPath });
    } finally {
      console.log = log;
    }
    const diagnostics = (result.diagnostics ?? []).filter((d) => d.severity === 'error' || d.severity === 'warning');
    const raw = JSON.parse(readFileSync(join(work, 'openapi.json'), 'utf8'));
    return { raw, diagnostics };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/**
 * True when the committed text parses to the same document: indentation,
 * line endings and key order (release-please's version bump) do not count.
 */
export function sameDocument(committedText, doc) {
  if (committedText === null) return false;
  try {
    return isDeepStrictEqual(JSON.parse(committedText), doc);
  } catch {
    return false;
  }
}

async function validate(doc) {
  const { Validator } = await import('@seriousme/openapi-schema-validator');
  const validator = new Validator();
  const res = await validator.validate(structuredClone(doc));
  const problems = [];
  if (!res.valid) problems.push(`openapi.json is not valid OpenAPI: ${JSON.stringify(res.errors, null, 2)}`);
  else if (validator.version !== '3.1') problems.push(`openapi.json validated as OpenAPI ${validator.version}, expected 3.1`);
  return problems;
}

async function main() {
  const { raw, diagnostics } = await generate();
  const { doc, problems } = postProcess(raw);
  const text = `${JSON.stringify(doc, null, 2)}\n`;
  for (const d of diagnostics) problems.push(`generator ${d.severity} ${d.code}: ${d.message}${d.filePath ? ` (${d.filePath.replace(ROOT, '')})` : ''}`);
  problems.push(...referenceProblems(doc), ...leakProblems(text), ...(await validate(doc)));
  if (problems.length) {
    console.error(problems.map((p) => `- ${p}`).join('\n'));
    process.exit(1);
  }
  const ops = Object.values(doc.paths).reduce((n, item) => n + Object.keys(item).length, 0);
  if (CHECK) {
    // Semantic comparison: release-please rewrites info.version with its own
    // JSON serialisation, which must not count as drift.
    if (!sameDocument(existsSync(OUT) ? readFileSync(OUT, 'utf8') : null, doc)) {
      console.error('openapi.json is out of date: run `npm run openapi` and commit the result.');
      process.exit(1);
    }
    console.log(`openapi.json is up to date and valid OpenAPI 3.1 (${ops} operations).`);
    return;
  }
  writeFileSync(OUT, text);
  console.log(`Wrote openapi.json (${ops} operations, valid OpenAPI 3.1).`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
