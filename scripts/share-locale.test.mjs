// Story 3.4: the anonymous share page's locale and its locale-aware sort.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const share = await import('../src/lib/shareSort.ts');

test('shareLocale: a supported cookie wins', () => {
  assert.equal(share.shareLocale('en', 'xx'), 'en');
});

test('shareLocale: an unknown cookie falls back to DEFAULT_LOCALE', () => {
  // Only English ships, so the instance default is the next candidate.
  assert.equal(share.shareLocale('fr', 'en'), 'en');
  assert.equal(share.shareLocale('', 'EN'), 'en');
});

test('shareLocale: neither cookie nor DEFAULT_LOCALE resolves to English', () => {
  assert.equal(share.shareLocale(undefined, undefined), 'en');
  assert.equal(share.shareLocale(null, 'xx'), 'en');
  assert.equal(share.shareLocale('fr', null), 'en');
});

test('shareLocale: reads DEFAULT_LOCALE from the environment by default', () => {
  const before = process.env.DEFAULT_LOCALE;
  process.env.DEFAULT_LOCALE = 'zz';
  try {
    assert.equal(share.shareLocale(undefined), 'en');
  } finally {
    if (before === undefined) delete process.env.DEFAULT_LOCALE;
    else process.env.DEFAULT_LOCALE = before;
  }
});

const file = (originalName, mimeType = 'image/jpeg', size = 1, day = 1) => ({
  originalName,
  mimeType,
  size,
  createdAt: new Date(Date.UTC(2026, 8, day)),
});

test('sortFiles: names compare in the given locale (collation, not code points)', () => {
  const rows = [file('beta.jpg'), file('Alpha.jpg'), file('alpha.jpg'), file('Émile.jpg')];
  const names = share.sortFiles(rows, 'name', 'en').map((r) => r.originalName);
  // Code-point order would put "Alpha" and "Émile" apart from their letters.
  assert.deepEqual(names, ['alpha.jpg', 'Alpha.jpg', 'beta.jpg', 'Émile.jpg']);
  assert.equal(share.compareNames('sv')('ö', 'z') > 0, true); // Swedish: ö after z
  assert.equal(share.compareNames('de')('ö', 'z') < 0, true); // German: ö before z
});

test('sortFiles: date (newest first), size and type orders', () => {
  const rows = [
    file('a.pdf', 'application/pdf', 5, 1),
    file('b.mp4', 'video/mp4', 50, 3),
    file('c.jpg', 'image/jpeg', 20, 2),
  ];
  assert.deepEqual(share.sortFiles(rows, 'date', 'en').map((r) => r.originalName), ['b.mp4', 'c.jpg', 'a.pdf']);
  assert.deepEqual(share.sortFiles(rows, 'size', 'en').map((r) => r.originalName), ['b.mp4', 'c.jpg', 'a.pdf']);
  assert.deepEqual(share.sortFiles(rows, 'type', 'en').map((r) => r.originalName), ['b.mp4', 'c.jpg', 'a.pdf']);
});

test('sortSections: number ascending with unnumbered last, then name and count', () => {
  const rows = [
    { number: null, title: 'Extras', fileCount: 9 },
    { number: '10', title: 'Ten', fileCount: 1 },
    { number: '2', title: 'Two', fileCount: 4 },
  ];
  assert.deepEqual(share.sortSections(rows, 'number', 'en').map((r) => r.title), ['Two', 'Ten', 'Extras']);
  assert.deepEqual(share.sortSections(rows, 'name', 'en').map((r) => r.title), ['Extras', 'Ten', 'Two']);
  assert.deepEqual(share.sortSections(rows, 'count', 'en').map((r) => r.title), ['Extras', 'Two', 'Ten']);
});

test('share sort ids: English ids pass, old ids are aliases, anything else is null', async () => {
  const { normalizeShareSort } = await import('../src/lib/shareTypes.ts');
  for (const id of ['date', 'name', 'size', 'type', 'number', 'count']) assert.equal(normalizeShareSort(id), id);
  assert.equal(normalizeShareSort('tanggal'), 'date');
  assert.equal(normalizeShareSort('nama'), 'name');
  assert.equal(normalizeShareSort('ukuran'), 'size');
  assert.equal(normalizeShareSort('tipe'), 'type');
  assert.equal(normalizeShareSort('nomor'), 'number');
  assert.equal(normalizeShareSort('jumlah'), 'count');
  assert.equal(normalizeShareSort('toString'), null);
  assert.equal(normalizeShareSort(''), null);
  assert.equal(normalizeShareSort(null), null);
});
