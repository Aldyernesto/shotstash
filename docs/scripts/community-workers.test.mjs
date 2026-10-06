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

test('duplicates are found whatever the case or a trailing slash', () => {
  const twin = { ...good, repository: 'https://GitHub.com/Acme/Shotstash-Whisper/' };
  assert.ok(validateWorkers([good, twin]).some((p) => p.includes('listed twice')));
});

test('over-length fields, bad SPDX, contract 2 and bad handles fail', () => {
  assert.ok(validateWorkers([{ ...good, name: 'x'.repeat(61) }])[0].includes('name must be'));
  assert.ok(validateWorkers([{ ...good, description: 'x'.repeat(161) }])[0].includes('description must be'));
  assert.ok(validateWorkers([{ ...good, license: 'MIT license!' }])[0].includes('SPDX'));
  assert.ok(validateWorkers([{ ...good, contract: 2 }])[0].includes('contract must be 1'));
  assert.ok(validateWorkers([{ ...good, contract: '1' }])[0].includes('contract must be 1'));
  for (const bad of ['@-acme', '@acme-', '@ac--me', `@${'a'.repeat(40)}`]) {
    assert.ok(validateWorkers([{ ...good, maintainer: bad }])[0]?.includes('GitHub handle'), bad);
  }
  assert.deepEqual(validateWorkers([{ ...good, maintainer: `@${'a'.repeat(39)}` }]), []);
});
