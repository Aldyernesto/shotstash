// Story 4.5: the search query shape shared by the database and Elasticsearch
// paths (wildcards taken literally, same limit), plus the processed-version
// helpers and pipeline kinds of Story 4.4. The parity of both paths runs in
// the e2e job (scripts/e2e-search-parity.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';

const q = await import('../src/modules/library/searchQuery.ts');
const processed = await import('../src/modules/media/processed.ts');
const kinds = await import('../src/modules/pipeline/kinds.ts');

const BS = '\\';

test('search: queries are trimmed, capped and empty ones refused', () => {
  assert.equal(q.normalizeQuery('  IMG  '), 'IMG');
  assert.equal(q.normalizeQuery('   '), null);
  assert.equal(q.normalizeQuery(42), null);
  assert.equal(q.normalizeQuery('x'.repeat(500)).length, q.SEARCH_MAX_QUERY);
  assert.equal(q.SEARCH_LIMIT, 50);
});

test('search: LIKE wildcards are escaped for the database path', () => {
  assert.equal(q.escapeLike(`50%_off${BS}x`), `50${BS}%${BS}_off${BS}${BS}x`);
  assert.equal(q.escapeLike('plain name.jpg'), 'plain name.jpg');
});

test('search: Elasticsearch wildcard is escaped and unanchored (PostgreSQL lowers the query)', () => {
  assert.equal(q.wildcardPattern('img_0'), '*img_0*');
  assert.equal(q.likePattern('50%'), `%50${BS}%%`);
  assert.equal(q.mappingIsCurrent({ mappings: { properties: { name_lower: { type: 'keyword' } } } }), true);
  assert.equal(q.mappingIsCurrent({ mappings: { properties: { name_lower: { type: 'text' } } } }), false);
  assert.equal(q.mappingIsCurrent({}), false);
  assert.equal(q.wildcardPattern('x*y?'), `*x${BS}*y${BS}?*`);
  assert.equal(q.wildcardPattern(`a${BS}b`), `*a${BS}${BS}b*`);
  assert.deepEqual(q.searchDocument({ nameLower: 'clip a.mov', projectId: 'p', folderId: 'f' }), {
    name_lower: 'clip a.mov',
    projectId: 'p',
    folderId: 'f',
  });
  assert.equal(q.SEARCH_MAPPINGS.properties.name_lower.type, 'keyword');
});

test('processed versions: download name and preview pick', () => {
  assert.equal(processed.processedFileName('IMG_0001.HEIC', 'preview', 'image/jpeg'), 'IMG_0001.preview.jpg');
  assert.equal(processed.processedFileName('clip', 'proxy', 'video/mp4'), 'clip.proxy.mp4');
  const versions = [
    { id: '1', kind: 'proxy', mimeType: 'video/mp4' },
    { id: '2', kind: 'preview', mimeType: 'image/jpeg' },
  ];
  assert.equal(processed.previewOf(versions)?.id, '2');
  assert.equal(processed.previewOf([]), null);
});

test('pipeline: heic-to-jpeg is a registered kind (worker in Epic 5)', () => {
  assert.ok(kinds.isPipelineKind('heic-to-jpeg'));
  assert.equal(kinds.isPipelineKind('preview'), false);
});
