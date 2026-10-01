// Story 6.4: the repository's own lint rules, run through the real
// eslint.config.mjs with lintText (no files are written): the module import
// direction and local/no-process-env (deferred from Story 6.3).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ESLint } from 'eslint';
import { ROOT } from './route-matrix-lib.mjs';

const eslint = new ESLint({ cwd: ROOT });

async function ruleIds(code, filePath) {
  const [result] = await eslint.lintText(code, { filePath });
  return result.messages.map((m) => m.ruleId);
}

const MODULE_FILE = 'src/modules/example/service.ts';

test('a module may not import app, components, graphql or services', async () => {
  for (const spec of [
    '@/components/Thing',
    '@/app/api/health/route',
    '@/graphql/schema',
    '@/services/share.service',
    '../../services/share.service',
    '../../../src/components/Thing',
    '../../graphql',
    './services/x',
  ]) {
    const ids = await ruleIds(`import { x } from '${spec}';\nexport const y = x;\n`, MODULE_FILE);
    assert.ok(ids.includes('no-restricted-imports'), `${spec} must be refused, got ${JSON.stringify(ids)}`);
  }
});

test('a module may import lib, other modules through their index, and packages', async () => {
  for (const spec of ['@/lib/prisma', '@/modules/auth', './dedup', '@react-email/components', 'next/server']) {
    const ids = await ruleIds(`import { x } from '${spec}';\nexport const y = x;\n`, MODULE_FILE);
    assert.ok(!ids.includes('no-restricted-imports'), `${spec} must be allowed, got ${JSON.stringify(ids)}`);
  }
});

test('dynamic import() of a layer is refused too, of lib allowed', async () => {
  for (const spec of ['@/services/share.service', '../../graphql/schema', './components/Thing']) {
    const ids = await ruleIds(`export const m = () => import('${spec}');\n`, MODULE_FILE);
    assert.ok(ids.includes('no-restricted-syntax'), `import('${spec}') must be refused, got ${JSON.stringify(ids)}`);
  }
  const ok = await ruleIds(`export const m = () => import('@/lib/prisma');\n`, MODULE_FILE);
  assert.ok(!ok.includes('no-restricted-syntax'), JSON.stringify(ok));
});

test('a module subfolder named like a layer is refused by name, and the message says so', async () => {
  // src/modules/example/services/x.ts is inside the module, but relative paths
  // are matched by folder name: the documented limitation is to rename it.
  for (const [spec, file] of [['./services/helpers', MODULE_FILE], ['../services/helpers', 'src/modules/example/sub/a.ts']]) {
    const [result] = await eslint.lintText(`import { x } from '${spec}';\nexport const y = x;\n`, { filePath: file });
    const hit = result.messages.find((m) => m.ruleId === 'no-restricted-imports');
    assert.ok(hit, `${spec} from ${file}`);
    assert.match(hit.message, /do not name a module subfolder/);
  }
  // A subfolder with any other name is fine.
  assert.ok(!(await ruleIds(`import { x } from './helpers/services';\nexport const y = x;\n`, MODULE_FILE)).includes('no-restricted-imports'));
});

test('the i18n attribute rule still applies inside modules', async () => {
  const ids = await ruleIds(`export const t = <div title="Hello there" />;\n`, 'src/modules/example/view.tsx');
  assert.ok(ids.includes('no-restricted-syntax'));
});

test('cross-module imports still go through the module index', async () => {
  const ids = await ruleIds(`import { x } from '@/modules/auth/permissions';\nexport const y = x;\n`, MODULE_FILE);
  assert.ok(ids.includes('no-restricted-imports'));
});

test('code outside src/modules is not affected by the module rule', async () => {
  const ids = await ruleIds(`import { x } from '@/services/share.service';\nexport const y = x;\n`, 'src/services/other.service.ts');
  assert.ok(!ids.includes('no-restricted-imports'));
});

test('local/no-process-env: only src/lib/config.ts reads the environment', async () => {
  const read = 'export const v = process.env.SHOTSTASH_SOMETHING;\n';
  assert.ok((await ruleIds(read, 'src/lib/example.ts')).includes('local/no-process-env'));
  assert.ok((await ruleIds(read, 'src/modules/example/service.ts')).includes('local/no-process-env'));
  assert.ok((await ruleIds(read, 'server.ts')).includes('local/no-process-env'));
  assert.ok((await ruleIds('export const e = process.env;\n', 'src/lib/example.ts')).includes('local/no-process-env'));
  assert.ok(!(await ruleIds('export const p = process.env.NODE_ENV;\n', 'src/lib/example.ts')).includes('local/no-process-env'));
  assert.ok(!(await ruleIds(read, 'src/lib/config.ts')).includes('local/no-process-env'));
});
