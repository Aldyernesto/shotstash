// Tests for the privacy scanner and its tokenizer. Run with `npm test`.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { CANARY, hashPhrase, phrases, tokenize } from './privacy-tokenize.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCAN = path.join(ROOT, 'scripts', 'privacy-scan.mjs');
const HASH = path.join(ROOT, 'scripts', 'privacy-hash.mjs');
const FIXTURE = path.join(ROOT, 'scripts', '__fixtures__', 'privacy-canary.txt');
const tmp = mkdtempSync(path.join(tmpdir(), 'privacy-scan-test-'));
after(() => rmSync(tmp, { recursive: true, force: true }));

function run(script, args, env = {}) {
  const r = spawnSync(process.execPath, [script, ...args], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, ...env } });
  return { code: r.status, out: `${r.stdout}\n${r.stderr}` };
}

const scan = (...args) => run(SCAN, [...args, '--denylist-only']);

function tempFile(name, text) {
  const p = path.join(tmp, name);
  writeFileSync(p, text);
  return p;
}

describe('tokenizer', () => {
  test('lowercases and splits on non-alphanumerics', () => {
    assert.deepEqual(tokenize('Foo-Bar_baz.Qux 42!'), ['foo', 'bar', 'baz', 'qux', '42']);
  });

  test('splits camelCase boundaries', () => {
    assert.deepEqual(tokenize('fooBar'), ['foo', 'bar']);
    assert.deepEqual(tokenize('parseHTTPRequest'), ['parse', 'httprequest']);
    assert.deepEqual(tokenize('FOO bar'), ['foo', 'bar']);
  });

  test('applies NFKC and keeps combining marks inside a token', () => {
    assert.deepEqual(tokenize('\uFF26\uFF4F\uFF4F'), ['foo']); // fullwidth letters
    assert.deepEqual(tokenize('\uFB01le'), ['file']); // fi ligature
    assert.deepEqual(tokenize('cafe\u0301 x'), ['caf\u00e9', 'x']); // composed by NFKC
    assert.deepEqual(tokenize('a\u20DDb'), ['a\u20DDb']); // enclosing mark has no composed form
  });

  test('keeps letters beyond ASCII and drops empty tokens', () => {
    assert.deepEqual(tokenize('  --Café//naïve--  '), ['café', 'naïve']);
    assert.deepEqual(tokenize('...'), []);
  });

  test('phrases are every run of 1 to 4 tokens', () => {
    assert.deepEqual(phrases(['a', 'b', 'c']), ['a', 'a b', 'a b c', 'b', 'b c', 'c']);
    assert.equal(phrases(['a', 'b', 'c', 'd', 'e']).includes('a b c d e'), false);
    assert.equal(phrases(['a', 'b', 'c', 'd', 'e']).includes('b c d e'), true);
  });

  test('hashPhrase is a stable salted SHA-256 hex digest', () => {
    const h = hashPhrase('a b');
    assert.match(h, /^[0-9a-f]{64}$/);
    assert.equal(h, hashPhrase('a b'));
    assert.notEqual(h, hashPhrase('a  b'));
  });
});

describe('denylist file', () => {
  test('holds only hex digests, including the canary', () => {
    const lines = readFileSync(path.join(ROOT, 'scripts', 'privacy-denylist.sha256'), 'utf8').trim().split('\n');
    for (const l of lines) assert.match(l, /^[0-9a-f]{64}$/);
    assert.ok(lines.includes(hashPhrase(tokenize(CANARY).join(' '))));
  });
});

describe('privacy-scan.mjs', () => {
  test('canary fixture is a hit (exit 1) and the phrase is never printed', () => {
    const r = scan('--files', FIXTURE);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /privacy-canary\.txt:2 {2}denylisted phrase/);
    assert.equal(r.out.toLowerCase().includes(CANARY), false);
  });

  test('clean text passes (exit 0)', () => {
    const f = tempFile('clean.txt', 'A self-hosted media cloud.\nNothing private here.\n');
    const r = scan('--files', f);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /privacy scan: clean/);
  });

  test('case and punctuation variants still hit', () => {
    const [a, b, c] = tokenize(CANARY);
    const variants = [
      `${a.toUpperCase()}_${b}.${c.toUpperCase()}`,
      `x = "${a}-${b}/${c}";`,
      `// ${a[0].toUpperCase()}${a.slice(1)}  ${b}, ${c}!`,
    ];
    variants.forEach((v, i) => {
      const f = tempFile(`variant-${i}.ts`, `const ok = 1;\n${v}\n`);
      const r = scan('--files', f);
      assert.equal(r.code, 1, `variant ${i}: ${r.out}`);
      assert.match(r.out, new RegExp(`variant-${i}\\.ts:2 {2}denylisted phrase`));
      assert.equal(r.out.toLowerCase().includes(CANARY), false);
    });
  });

  test('tokens split across lines do not hit', () => {
    const [a, b, c] = tokenize(CANARY);
    const f = tempFile('split.txt', `${a}\n${b}\n${c}\n`);
    assert.equal(scan('--files', f).code, 0);
  });

  test('--all skips the canary fixture and the tree is clean', () => {
    const r = scan('--all');
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /privacy scan: clean/);
    assert.equal(r.out.includes('privacy-canary.txt'), false, r.out);
  });

  test('usage errors: missing --files path, --base followed by a flag', () => {
    assert.equal(scan('--files', path.join(tmp, 'does-not-exist.txt')).code, 2);
    assert.equal(run(SCAN, ['--base', '--all']).code, 2);
  });

  test('round trip: privacy:hash --out, then scan --denylist hits a variant', () => {
    const plain = tempFile('plain.txt', '# comment\nAcme Secret Project\n');
    const out = path.join(tmp, 'deny.sha256');
    const h = run(HASH, [plain, '--out', out]);
    assert.equal(h.code, 0, h.out);
    for (const l of readFileSync(out, 'utf8').trim().split('\n')) assert.match(l, /^[0-9a-f]{64}$/);
    const hit = tempFile('roundtrip.ts', 'const x = 1;\nconst name = "ACME-secret_project";\n');
    const r = scan('--files', hit, '--denylist', out);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /roundtrip\.ts:2 {2}denylisted phrase/);
    assert.equal(r.out.toLowerCase().includes('acme'), false);
    const camel = tempFile('camel.ts', 'const acmeSecretProject = 1;\n');
    assert.equal(scan('--files', camel, '--denylist', out).code, 1);
  });
});

describe('gitleaks layer', () => {
  test('a stub gitleaks finding is reported as <path>:<line> and exits 1', () => {
    const stub = tempFile('gitleaks-stub.mjs', `
import { writeFileSync } from 'node:fs';
import path from 'node:path';
const a = process.argv.slice(2);
if (a[0] === 'version') { console.log('8.30.1'); process.exit(0); }
const tree = a[1];
const report = a[a.indexOf('--report-path') + 1];
writeFileSync(report, JSON.stringify([{ File: path.join(tree, 'README.md'), StartLine: 3, RuleID: 'stub-rule' }]));
process.exit(1);
`);
    const r = run(SCAN, ['--files', path.join(ROOT, 'README.md')], { GITLEAKS_BIN: stub });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /README\.md:3 {2}secret \(stub-rule\)/);
  });

  test('CI=true without gitleaks exits 1', () => {
    const r = run(SCAN, ['--files', path.join(ROOT, 'README.md')], { CI: 'true', GITLEAKS_BIN: path.join(tmp, 'no-such-gitleaks') });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /gitleaks is required in CI/);
  });
});
