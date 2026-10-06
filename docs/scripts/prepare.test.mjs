import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { IMPORTS, rewriteHref, rewriteLinks, toPage } from './prepare.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const repo = 'someone/shotstash';

test('every imported guide exists in the repository', () => {
  for (const entry of IMPORTS) assert.ok(existsSync(path.join(ROOT, entry.from)), entry.from);
});

test('links to imported guides become site pages, others GitHub URLs', () => {
  assert.equal(rewriteHref('configuration.md', 'docs/storage.md', repo), '/docs/configuration/');
  assert.equal(rewriteHref('docs/i18n.md#adding-a-locale', 'CONTRIBUTING.md', repo), '/docs/contributing/i18n/#adding-a-locale');
  assert.equal(rewriteHref('SECURITY.md', 'CONTRIBUTING.md', repo), '/docs/contributing/security/');
  assert.equal(rewriteHref('README.md', 'CONTRIBUTING.md', repo), 'https://github.com/someone/shotstash/blob/main/README.md');
  assert.equal(rewriteHref('worker/', 'README.md', repo), 'https://github.com/someone/shotstash/tree/main/worker');
  assert.equal(rewriteHref('../../security/advisories/new', 'SECURITY.md', repo), 'https://github.com/someone/shotstash/security/advisories/new');
  assert.equal(rewriteHref('https://example.com/x', 'README.md', repo), 'https://example.com/x');
  assert.equal(rewriteHref('#top', 'README.md', repo), '#top');
});

test('code blocks are left alone', () => {
  const md = 'See [x](storage.md).\n\n```md\n[x](storage.md)\n```\n';
  const out = rewriteLinks(md, 'docs/byo-ai.md', repo);
  assert.match(out, /See \[x\]\(\/docs\/storage\/\)/);
  assert.match(out, /```md\n\[x\]\(storage\.md\)\n```/);
});

test('a page gets frontmatter, loses its first heading and names its source', () => {
  const page = toPage('# Storage\r\n\r\nBody [c](configuration.md).\r\n', IMPORTS.find((i) => i.from === 'docs/storage.md'), repo);
  assert.match(page, /^---\ntitle: "Storage backends"\n/);
  assert.doesNotMatch(page, /# Storage/);
  assert.match(page, /Body \[c\]\(\/docs\/configuration\/\)/);
  assert.match(page, /generated from \[`docs\/storage\.md`\]\(https:\/\/github\.com\/someone\/shotstash\/blob\/main\/docs\/storage\.md\)/);
});
