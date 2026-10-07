// Story 8.1: every image the README shows exists in the repository, and the
// heavy ones stay small enough for the GitHub page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readme = readFileSync(path.join(ROOT, 'README.md'), 'utf8');

/** Local image paths of the README (HTML img src and Markdown images), without comments. */
function localImages(md) {
  const text = md.replace(/<!--[\s\S]*?-->/g, '');
  const out = [];
  for (const m of text.matchAll(/<img[^>]*\ssrc="([^"]+)"/g)) out.push(m[1]);
  for (const m of text.matchAll(/!\[[^\]]*\]\(([^)\s]+)/g)) out.push(m[1]);
  return out.filter((src) => !/^[a-z]+:/i.test(src));
}

test('every local README image exists', () => {
  const images = localImages(readme);
  assert.ok(images.includes('.github/assets/banner.png'), 'banner');
  assert.ok(images.includes('.github/assets/demo.gif'), 'GIF');
  assert.ok(images.includes('promo/out/thumbnail-1280x720.jpg'), 'trailer thumbnail');
  assert.ok(images.some((src) => src.startsWith('docs/public/screenshots/')), 'screenshots');
  const missing = images.filter((src) => !existsSync(path.join(ROOT, src)));
  assert.deepEqual(missing, []);
});

test('README assets stay light: demo.gif under 5 MB, banner.png under 300 KB, trailer thumbnail under 400 KB', () => {
  assert.ok(statSync(path.join(ROOT, '.github/assets/demo.gif')).size < 5 * 1024 * 1024);
  assert.ok(statSync(path.join(ROOT, '.github/assets/banner.png')).size < 300 * 1024);
  assert.ok(statSync(path.join(ROOT, 'promo/out/thumbnail-1280x720.jpg')).size < 400 * 1024);
});

test('the trailer thumbnail links to the docs trailer page', () => {
  assert.match(readme, /<a href="https:\/\/[^"]+\/docs\/trailer\/"><img src="promo\/out\/thumbnail-1280x720\.jpg" alt="Watch the 30-second Shotstash trailer"/);
});
