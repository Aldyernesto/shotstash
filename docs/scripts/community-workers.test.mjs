import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateWorkers } from './community-workers.mjs';

const good = {
  name: 'Whisper transcripts',
  description: 'Speech to WebVTT subtitles.',
  repository: 'https://github.com/acme/shotstash-whisper',
  kinds: ['acme/whisper-transcript'],
  contract: 1,
  license: 'MIT',
  maintainer: '@acme',
};

test('the committed community worker list is valid', () => {
  const list = JSON.parse(readFileSync(new URL('../data/community-workers.json', import.meta.url), 'utf8'));
  assert.deepEqual(validateWorkers(list), []);
});

test('a complete entry passes', () => {
  assert.deepEqual(validateWorkers([good]), []);
});

test('bad entries name the field', () => {
  assert.deepEqual(validateWorkers({}), ['the file must hold a JSON array']);
  const bad = validateWorkers([{ ...good, repository: 'http://example.com', kinds: ['Bad Kind'], extra: 1 }]);
  assert.ok(bad.some((p) => p.includes('unknown field "extra"')));
  assert.ok(bad.some((p) => p.includes('repository must be an https:// URL')));
  assert.ok(bad.some((p) => p.includes('kinds must be')));
  assert.ok(validateWorkers([{ ...good, kinds: ['shotstash/x'] }])[0].includes('own namespace'));
  assert.ok(validateWorkers([good, good])[0].includes('listed twice'));
  assert.ok(validateWorkers([{ ...good, maintainer: 'acme' }])[0].includes('GitHub handle'));
});
