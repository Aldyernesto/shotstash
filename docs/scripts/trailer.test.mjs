// The trailer page's text alternative lists exactly the lines the film shows
// (promo/src/timeline.js), in order.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DOCS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = path.resolve(DOCS, '..');

/** The on-screen lines of the film, in order, from the timeline. */
export async function filmLines() {
  const { S } = await import(pathToFileURL(path.join(ROOT, 'promo', 'src', 'timeline.js')).href);
  const join = (parts) => parts.map((p) => p[0]).join('');
  return [
    join(S.intro.text),
    '+ New Project',
    join(S.upload.line),
    join(S.projects.headline),
    join(S.projects.viewerLine),
    join(S.share.line),
    ...S.pills.words.map((w) => w[0]),
    join(S.ring.rect),
    join(S.ring.line1),
    join(S.ring.line2),
    S.ring.cycle.join(' · '),
    join(S.lock.line),
    S.lock.url,
  ].map((l) => l.replace(/’/g, "'"));
}

test('the docs trailer page lists the on-screen lines of the film', async () => {
  const mdx = readFileSync(path.join(DOCS, 'content', 'docs', 'trailer.mdx'), 'utf8');
  const block = mdx.split('{/* trailer-lines:start */}')[1].split('{/* trailer-lines:end */}')[0];
  const listed = block
    .split('\n')
    .filter((l) => l.startsWith('- '))
    .map((l) => l.slice(2).trim());
  assert.deepEqual(listed, await filmLines());
});

test('the film shows the real, working demo share link', async () => {
  const { S } = await import(pathToFileURL(path.join(ROOT, 'promo', 'src', 'timeline.js')).href);
  assert.equal(S.share.link, 'demostash.aldyernesto.my.id/s/demo-coastline-stills');
});
