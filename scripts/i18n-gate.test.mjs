// Story 3.5: the i18n gate covers the whole src/ tree, with an explicit
// list of technical exceptions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const check = await import('./i18n-check.mjs');
const scope = JSON.parse(readFileSync(new URL('./i18n-scope.json', import.meta.url), 'utf8'));
const words = check.loadLeftovers();
const ROOT = fileURLToPath(new URL('..', import.meta.url));

test('scope is the whole src tree', () => {
  assert.deepEqual(scope.files, ['src/**']);
  const files = check.expandScope(scope.files);
  assert.ok(files.length > 150, `expected the whole tree, got ${files.length} files`);
  assert.ok(files.includes('src/app/(app)/dashboard/admin/page.tsx'));
  assert.ok(files.includes('src/graphql/resolvers.ts'));
  assert.ok(files.includes('src/emails/PasswordResetEmail.tsx'));
});

test('every exception names a file, a reason and a compiling pattern', () => {
  const byFile = check.loadExceptions(scope.exceptions);
  assert.ok(byFile.size >= 1);
  assert.throws(() => check.loadExceptions([{ file: 'src/nope.ts', pattern: 'x', reason: 'r' }]), /missing file/);
  assert.throws(() => check.loadExceptions([{ file: 'src/graphql/schema.ts', pattern: 'x', reason: ' ' }]), /reason/);
  // Without a string pattern an exception would skip the whole file: refuse it.
  assert.throws(() => check.loadExceptions([{ file: 'src/graphql/schema.ts', reason: 'r' }]), /string pattern/);
  assert.throws(() => check.loadExceptions([{ file: 'src/graphql/schema.ts', pattern: /x/, reason: 'r' }]), /string pattern/);
});

test('exception paths are normalized (./ and backslashes)', () => {
  const a = check.loadExceptions([{ file: './src/graphql/schema.ts', pattern: 'x', reason: 'r' }]);
  const b = check.loadExceptions([{ file: 'src\\graphql\\schema.ts', pattern: 'x', reason: 'r' }]);
  assert.deepEqual([...a.keys()], ['src/graphql/schema.ts']);
  assert.deepEqual([...b.keys()], ['src/graphql/schema.ts']);
});

test('every pattern matching a literal counts as used', () => {
  const used = new Set();
  check.checkSource("const a = '#graphql yang';\n", words, 'x.ts', [/^#graphql/, /yang/], used);
  assert.deepEqual([...used].sort(), [0, 1]);
});

test('a stale exception makes the check exit 1', () => {
  const stale = {
    files: ['src/lib/errorCodes.ts'],
    exceptions: [{ file: 'src/lib/errorCodes.ts', pattern: '^never matches this$', reason: 'test' }],
  };
  const log = console.error;
  console.error = () => {};
  try {
    assert.equal(check.main([], stale), 1);
  } finally {
    console.error = log;
  }
});

test('an exception skips only the literals matching its pattern', () => {
  const src = "const a = `#graphql\n # yang ini\n`;\nconst b = 'yang lain';\n";
  const used = new Set();
  const found = check.checkSource(src, words, 'x.ts', [/^#graphql/], used);
  assert.deepEqual(found, [{ line: 4, word: 'yang' }]);
  assert.deepEqual([...used], [0]);
  const unused = new Set();
  check.checkSource("const c = 'hello';\n", words, 'x.ts', [/^#graphql/], unused);
  assert.equal(unused.size, 0);
});

test('whole-tree leftover check passes (npm run i18n:check)', () => {
  const r = spawnSync(process.execPath, ['scripts/i18n-check.mjs'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
});
