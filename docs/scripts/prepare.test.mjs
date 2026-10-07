import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { IMPORTS, changelogPage, rewriteHref, rewriteLinks, stripFirstH1, toPage } from './prepare.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const repo = 'someone/shotstash';

/** A throwaway repository tree for existence checks. */
function fakeRoot() {
  const root = mkdtempSync(path.join(tmpdir(), 'docs-prepare-'));
  for (const f of ['README.md', 'LICENSE', 'docs/a b.md', 'public/brand/logo.png', 'worker/src/main.mjs']) {
    mkdirSync(path.dirname(path.join(root, f)), { recursive: true });
    writeFileSync(path.join(root, f), 'x');
  }
  return root;
}
const root = fakeRoot();
const href = (h, from = 'README.md', image = false) => rewriteHref(h, from, repo, { root, image });

test('every imported guide exists in the repository', () => {
  for (const entry of IMPORTS) assert.ok(existsSync(path.join(ROOT, entry.from)), entry.from);
});

test('links to imported guides become site pages', () => {
  assert.equal(href('docs/storage.md'), '/docs/storage/');
  assert.equal(href('configuration.md', 'docs/storage.md'), '/docs/configuration/');
  assert.equal(href('docs/i18n.md#adding-a-locale', 'CONTRIBUTING.md'), '/docs/contributing/i18n/#adding-a-locale');
  assert.equal(href('SECURITY.md', 'CONTRIBUTING.md'), '/docs/contributing/security/');
});

test('root-relative links resolve from the repository root', () => {
  assert.equal(href('/docs/storage.md', 'docs/byo-ai.md'), '/docs/storage/');
  assert.equal(href('/README.md', 'docs/byo-ai.md'), 'https://github.com/someone/shotstash/blob/main/README.md');
});

test('other repository files become GitHub URLs of the right kind', () => {
  assert.equal(href('README.md', 'CONTRIBUTING.md'), 'https://github.com/someone/shotstash/blob/main/README.md');
  assert.equal(href('LICENSE'), 'https://github.com/someone/shotstash/blob/main/LICENSE');
  assert.equal(href('worker/'), 'https://github.com/someone/shotstash/tree/main/worker');
  assert.equal(href('worker'), 'https://github.com/someone/shotstash/tree/main/worker');
  assert.equal(href('docs/a%20b.md'), 'https://github.com/someone/shotstash/blob/main/docs/a%20b.md');
  assert.equal(href('public/brand/logo.png', 'README.md', true), 'https://raw.githubusercontent.com/someone/shotstash/main/public/brand/logo.png');
});

test('external links, anchors and the GitHub ../../ convention stay usable', () => {
  assert.equal(href('https://example.com/x'), 'https://example.com/x');
  assert.equal(href('mailto:a@example.com'), 'mailto:a@example.com');
  assert.equal(href('#top'), '#top');
  assert.equal(href('../../security/advisories/new', 'SECURITY.md'), 'https://github.com/someone/shotstash/security/advisories/new');
});

test('a missing target or a path out of the repository fails', () => {
  assert.throws(() => href('docs/nope.md'), /does not exist/);
  assert.throws(() => href('../outside.md'), /leaves the repository/);
  assert.throws(() => href('../../../x'), /leaves the repository/);
});

test('inline links, images, angle targets and reference definitions are rewritten', () => {
  const md = [
    'See [s](docs/storage.md "Storage") and ![logo](public/brand/logo.png).',
    'Spaces: [ab](<docs/a b.md>).',
    '[ref]: docs/storage.md "title"',
    '  [w]: <worker/>',
  ].join('\n');
  const out = rewriteLinks(md, 'README.md', repo, { root }).split('\n');
  assert.equal(out[0], 'See [s](/docs/storage/ "Storage") and ![logo](https://raw.githubusercontent.com/someone/shotstash/main/public/brand/logo.png).');
  assert.equal(out[1], 'Spaces: [ab](<https://github.com/someone/shotstash/blob/main/docs/a%20b.md>).');
  assert.equal(out[2], '[ref]: /docs/storage/ "title"');
  assert.equal(out[3], '  [w]: <https://github.com/someone/shotstash/tree/main/worker>');
});

test('fences close only with the same character and at least the same length', () => {
  const md = [
    '````md',
    '```',
    '[x](missing.md)',
    '```',
    '````',
    '~~~',
    '```',
    '[y](missing.md)',
    '~~~',
    '[z](docs/storage.md)',
  ].join('\n');
  const out = rewriteLinks(md, 'README.md', repo, { root }).split('\n');
  assert.equal(out[2], '[x](missing.md)');
  assert.equal(out[7], '[y](missing.md)');
  assert.equal(out[9], '[z](/docs/storage/)');
});

test('only the first H1 outside fences is dropped', () => {
  const md = '```sh\n# a shell comment\n```\n\n# Title\n\nBody\n\n# Second\n';
  const out = stripFirstH1(md);
  assert.match(out, /# a shell comment/);
  assert.doesNotMatch(out, /# Title/);
  assert.match(out, /# Second/);
});

test('a page gets frontmatter, loses its first heading and names its source', () => {
  const page = toPage('# Storage\r\n\r\nBody [c](configuration.md).\r\n', IMPORTS.find((i) => i.from === 'docs/storage.md'), repo, { root });
  assert.match(page, /^---\ntitle: "Storage backends"\n/);
  assert.doesNotMatch(page, /# Storage/);
  assert.match(page, /Body \[c\]\(\/docs\/configuration\/\)/);
  assert.match(page, /generated from \[`docs\/storage\.md`\]\(https:\/\/github\.com\/someone\/shotstash\/blob\/main\/docs\/storage\.md\)/);
});

test('the changelog page names its source when CHANGELOG.md exists', () => {
  assert.match(changelogPage(repo, root), /No release has been published yet/);
  const withLog = fakeRoot();
  writeFileSync(path.join(withLog, 'CHANGELOG.md'), '# Changelog\n\n## 0.2.0\n\n- [notes](README.md)\n');
  const page = changelogPage(repo, withLog);
  assert.doesNotMatch(page, /# Changelog/);
  assert.match(page, /generated from \[`CHANGELOG\.md`\]/);
});

test('the trailer copy publishes the film, its licences and no licensed audio', async () => {
  const { copyTrailer, trailerFiles } = await import('./prepare.mjs');
  const dest = mkdtempSync(path.join(tmpdir(), 'trailer-'));
  const files = copyTrailer(dest);
  for (const f of [
    'shotstash-trailer-30s.mp4',
    'poster.jpg',
    'NOTICE.md',
    'live/index.html',
    'live/src/main.js',
    'live/vendor/three/three.module.js',
    'live/vendor/three/LICENSE',
    'live/assets/fonts/OFL-inter.txt',
    'live/assets/fonts/OFL-inter-tight.txt',
    'live/assets/fonts/OFL-jetbrains-mono.txt',
  ]) {
    assert.ok(existsSync(path.join(dest, f)), `${f} arrives`);
  }
  const audio = files.filter((f) => /\.(mp3|wav|ogg|flac|m4a|aac)$/i.test(f));
  assert.ok(audio.every((f) => f.endsWith('-cc0.wav')), `only CC0 audio: ${audio.join(', ')}`);
  assert.ok(!existsSync(path.join(dest, 'live', 'assets', 'audio', 'bgm-main.mp3')));
  // licensed audio is refused even if git were to list it
  const fake = ['promo/index.html', 'promo/assets/audio/bgm-main.mp3', 'promo/assets/audio/x.ogg', 'promo/assets/audio/sfx-cc0.wav'];
  assert.deepEqual(trailerFiles(fake), ['assets/audio/sfx-cc0.wav', 'index.html']);
});
