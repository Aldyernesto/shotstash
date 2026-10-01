// Story 2.1: shared extraction for the route matrix generator and the
// declaration-coverage test. Reads every `src/app/**/route.ts` with the
// TypeScript parser and the GraphQL auth map, never by running the app.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

export const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const HTTP_METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];
export const MATRIX_PATH = join(ROOT, 'docs', 'security', 'route-matrix.md');

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name === 'route.ts' || name === 'route.js') out.push(p);
  }
  return out;
}

export function routeFiles() {
  return walk(join(ROOT, 'src', 'app')).sort();
}

export function routePathOf(file) {
  const rel = relative(join(ROOT, 'src', 'app'), file).split(sep).join('/');
  const dir = rel.replace(/\/?route\.(ts|js)$/, '');
  return '/' + dir.split('/').filter((seg) => !/^\(.*\)$/.test(seg)).join('/');
}

function stringProp(obj, name) {
  for (const p of obj.properties) {
    if (ts.isPropertyAssignment(p) && p.name && p.name.getText() === name) {
      if (ts.isStringLiteral(p.initializer) || ts.isNoSubstitutionTemplateLiteral(p.initializer)) {
        return p.initializer.text;
      }
      return null;
    }
  }
  return undefined;
}

function defineRouteCall(expr) {
  if (!expr || !ts.isCallExpression(expr)) return null;
  if (expr.expression.getText() !== 'defineRoute') return null;
  const arg = expr.arguments[0];
  if (!arg || !ts.isObjectLiteralExpression(arg)) return null;
  return { auth: stringProp(arg, 'auth'), action: stringProp(arg, 'action') ?? null };
}

/**
 * For one route file: every exported HTTP method and its declaration.
 * `declared` is null when the method is not a `defineRoute(...)` handler.
 */
export function analyzeRoute(file) {
  const src = readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const locals = new Map();
  const methods = [];

  for (const st of sf.statements) {
    if (ts.isVariableStatement(st)) {
      const exported = st.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
      for (const d of st.declarationList.declarations) {
        const name = d.name.getText();
        const call = defineRouteCall(d.initializer);
        if (call) locals.set(name, call);
        if (exported && HTTP_METHODS.includes(name)) {
          let declared = call;
          if (!declared && d.initializer && ts.isIdentifier(d.initializer)) {
            declared = locals.get(d.initializer.text) ?? null;
          }
          methods.push({ method: name, declared });
        }
      }
    } else if (ts.isFunctionDeclaration(st) && st.name && HTTP_METHODS.includes(st.name.text)) {
      const exported = st.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
      if (exported) methods.push({ method: st.name.text, declared: null });
    } else if (ts.isExportDeclaration(st) && st.exportClause && ts.isNamedExports(st.exportClause)) {
      for (const el of st.exportClause.elements) {
        const name = el.name.text;
        if (!HTTP_METHODS.includes(name)) continue;
        const local = (el.propertyName ?? el.name).text;
        methods.push({ method: name, declared: st.moduleSpecifier ? null : locals.get(local) ?? null });
      }
    }
  }
  return { file, path: routePathOf(file), methods };
}

/** Keys of `rawResolvers.{Query,Mutation,Subscription}` in resolvers.ts. */
export function resolverFields() {
  const file = join(ROOT, 'src', 'graphql', 'resolvers.ts');
  const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const out = { Query: [], Mutation: [], Subscription: [] };
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText() === 'rawResolvers' && node.initializer && ts.isObjectLiteralExpression(node.initializer)) {
      for (const p of node.initializer.properties) {
        const type = p.name?.getText();
        if (!(type in out) || !ts.isPropertyAssignment(p) || !ts.isObjectLiteralExpression(p.initializer)) continue;
        for (const f of p.initializer.properties) if (f.name) out[type].push(f.name.getText());
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

export async function loadAuthMap() {
  const mod = await import(new URL('../src/graphql/auth-map.ts', import.meta.url).href);
  return mod.AUTH_MAP;
}

export async function schemaFields() {
  const { typeDefs } = await import(new URL('../src/graphql/schema.ts', import.meta.url).href);
  const { buildSchema } = await import('graphql');
  const schema = buildSchema(typeDefs.replace(/^#graphql\s*/, ''));
  const out = {};
  for (const [type, t] of [['Query', schema.getQueryType()], ['Mutation', schema.getMutationType()], ['Subscription', schema.getSubscriptionType()]]) {
    out[type] = t ? Object.keys(t.getFields()) : [];
  }
  return out;
}

const esc = (s) => String(s ?? '').replace(/\|/g, '\\|');

export async function renderMatrix() {
  const routes = routeFiles().map(analyzeRoute).sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const authMap = await loadAuthMap();
  const lines = [
    '# Route and resolver auth matrix',
    '',
    'Generated by `npm run security:matrix`. Do not edit by hand; CI runs `npm run security:matrix -- --check`.',
    '',
    'Auth modes: `public` (no credential), `session` (Bearer token), `cookie` (`shotstash_session`, `/media` only),',
    '`signed` (HMAC-signed URL re-checked against the share link), `share` (PUBLIC link or `shotstash_share_<slug>` cookie),',
    '`worker` (`X-Worker-Token` of a registered worker; worker registration takes the shared `X-Worker-Bootstrap-Token`).',
    'Actions are the `can()` actions of `src/modules/auth/permissions.ts` (`self` = a write on the caller\'s own account);',
    'on `worker` routes they name the credential (`bootstrap token`, `registered worker`, `claim holder` = `X-Claim-Token` of the job).',
    '',
    '## HTTP routes',
    '',
    '| Route | Method | Auth | Action |',
    '| --- | --- | --- | --- |',
  ];
  for (const r of routes) {
    for (const m of r.methods) {
      lines.push(`| \`${esc(r.path)}\` | ${m.method} | ${m.declared ? esc(m.declared.auth) : '**undeclared**'} | ${esc(m.declared?.action ?? '')} |`);
    }
  }
  lines.push('', '## GraphQL fields', '', '| Field | Auth | Action |', '| --- | --- | --- |');
  for (const type of ['Query', 'Mutation', 'Subscription']) {
    for (const field of Object.keys(authMap[type]).sort()) {
      const e = authMap[type][field];
      lines.push(`| \`${type}.${field}\` | ${esc(e.auth)} | ${esc(e.action ?? '')} |`);
    }
  }
  lines.push('');
  return lines.join('\n');
}
