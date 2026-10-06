import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { checkExport } from './check-export.mjs';

function out(files) {
  const dir = mkdtempSync(path.join(tmpdir(), 'docs-out-'));
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    writeFileSync(path.join(dir, name), text);
  }
  return dir;
}

test('a clean export passes', () => {
  assert.deepEqual(checkExport(out({ 'index.html': '<a href="https://github.com/a/b">', 'api/search': '{"type":"advanced"}' })), []);
});

test('leftover placeholders and a missing or empty index fail', () => {
  const bad = checkExport(out({ 'docs/x/index.html': 'clone https://github.com/%REPO%.git', 'y.txt': '%PAGES_URL%' }));
  assert.ok(bad.includes('docs/x/index.html: contains %REPO%'));
  assert.ok(bad.includes('y.txt: contains %PAGES_URL%'));
  assert.ok(bad.includes('api/search: the search index is missing'));
  assert.ok(checkExport(out({ 'api/search': '' })).includes('api/search: the search index is empty'));
  assert.ok(checkExport(out({ 'api/search': '{}' })).includes('api/search: the search index is empty'));
});
