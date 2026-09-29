// Story 3.1: locale resolution, ICU plurals, locale-aware formatting and the
// Indonesian leftover check.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const cfg = await import('../src/i18n/config.ts');
const { makeTranslator } = await import('../src/modules/i18n/translator.ts');
const fmt = await import('../src/lib/format.ts');
const { contentSummaryParts } = await import('../src/lib/contentSummary.ts');
const perm = await import('../src/lib/permissions.ts');
const check = await import('./i18n-check.mjs');
const { hashPhrase, normalizePhrase } = await import('./privacy-tokenize.mjs');

const en = JSON.parse(readFileSync(new URL('../messages/en.json', import.meta.url), 'utf8'));
const t = makeTranslator({ en }, 'en');

/* ---------------- locale resolution ---------------- */

test('resolveLocale: first supported candidate wins, unknown falls back to en', () => {
  assert.equal(cfg.resolveLocale('en'), 'en');
  assert.equal(cfg.resolveLocale('fr'), 'en');
  assert.equal(cfg.resolveLocale('xx', undefined, null, ''), 'en');
  assert.equal(cfg.resolveLocale(null, 'EN'), 'en');
  assert.equal(cfg.resolveLocale(), 'en');
  assert.equal(cfg.isSupportedLocale('fr'), false);
  assert.equal(cfg.isSupportedLocale('en'), true);
});

test('resolveServerTimeZone: valid IANA zone kept, anything else is UTC', () => {
  assert.equal(cfg.resolveServerTimeZone('Asia/Jakarta'), 'Asia/Jakarta');
  assert.equal(cfg.resolveServerTimeZone('Not/AZone'), 'UTC');
  assert.equal(cfg.resolveServerTimeZone(undefined), 'UTC');
});

test('makeTranslator: unknown locale uses the English messages', () => {
  const fr = makeTranslator({ en }, 'fr');
  assert.equal(fr('common.cancel'), 'Cancel');
});

/* ---------------- ICU plurals ---------------- */

test('count plurals: No files / 1 file / 2 files / grouped thousands', () => {
  assert.equal(t('count.files', { count: 0 }), 'No files');
  assert.equal(t('count.files', { count: 1 }), '1 file');
  assert.equal(t('count.files', { count: 2 }), '2 files');
  assert.equal(t('count.files', { count: 2600 }), '2,600 files');
  assert.equal(t('count.sections', { count: 1 }), '1 section');
});

test('content summary: "3 photos, 1 video" from bucket parts, empty buckets dropped', () => {
  const parts = contentSummaryParts({ photos: 3, videos: 1, documents: 0 }).map((p) =>
    t(`content.${p.kind}`, { count: p.count }),
  );
  assert.equal(parts.join(', '), '3 photos, 1 video');
  const largest = contentSummaryParts({ photos: 2, videos: 9 }, true).map((p) => p.kind);
  assert.deepEqual(largest, ['videos', 'photos']);
  assert.deepEqual(contentSummaryParts(null), []);
});

/* ---------------- formatting ---------------- */

const at = new Date('2026-09-28T10:00:00Z');

test('dates: English month, day first, in the given zone', () => {
  assert.equal(fmt.formatDate(at, { timeZone: 'Asia/Jakarta' }), '28 Sep 2026');
  assert.equal(fmt.formatDate(new Date('2026-09-28T20:00:00Z'), { timeZone: 'Asia/Jakarta' }), '29 Sep 2026');
  assert.equal(fmt.formatDate('not a date'), '');
});

test('times carry a zone label and use the viewer zone', () => {
  assert.equal(fmt.formatTime(at, { timeZone: 'Asia/Jakarta' }), '17:00 GMT+7');
  assert.equal(fmt.formatTime(at, { timeZone: 'UTC' }), '10:00 UTC');
  assert.equal(fmt.formatDateTime(at, { timeZone: 'Asia/Jakarta' }), '28 Sep 2026 · 17:00 GMT+7');
});

test('relative time: just now, 5 min ago, 3 h ago, then the date', () => {
  const now = new Date(at.getTime());
  const labels = {
    justNow: t('format.justNow'),
    minutesAgo: (count) => t('format.minutesAgo', { count }),
    hoursAgo: (count) => t('format.hoursAgo', { count }),
  };
  const ago = (s) => new Date(now.getTime() - s * 1000);
  assert.equal(fmt.formatRelative(ago(30), { now, labels }), 'just now');
  assert.equal(fmt.formatRelative(ago(5 * 60), { now, labels }), '5 min ago');
  assert.equal(fmt.formatRelative(ago(3 * 3600), { now, labels }), '3 h ago');
  assert.equal(fmt.formatRelative(ago(3 * 86400), { now, labels, timeZone: 'UTC' }), '25 Sep 2026');
});

test('sizes and numbers: English decimal point and grouping', () => {
  assert.equal(fmt.formatFileSize(1536), '1.5 KB');
  assert.equal(fmt.formatFileSize(2.5 * 1024 ** 3), '2.5 GB');
  assert.equal(fmt.formatFileSize(512), '512 B');
  assert.equal(fmt.formatFileSize(-1), '0 B');
  assert.equal(fmt.formatNumber(7354), '7,354');
  assert.equal(fmt.formatNumber(3.5), '3.5');
});

test('dimensions: orientation codes; English words come from messages', () => {
  assert.equal(fmt.describeAspect(2160, 3840).orientation, 'portrait');
  const label = (o) => t(`format.orientation.${o}`);
  assert.equal(fmt.formatDimensions(2160, 3840, label), '2160 × 3840 px · Portrait (9:16)');
  assert.equal(fmt.formatDimensions(1080, 1080, label), '1080 × 1080 px · Square (1:1)');
  assert.equal(fmt.formatExifCameraTime('2026:09:28 10:00:00', t('format.cameraTime')), '2026:09:28 10:00:00 (camera time)');
});

test('built-in English relative words equal the messages', () => {
  const now = new Date(at.getTime());
  const ago = (s) => new Date(now.getTime() - s * 1000);
  assert.equal(fmt.formatRelative(ago(10), { now }), t('format.justNow'));
  assert.equal(fmt.formatRelative(ago(7 * 60), { now }), t('format.minutesAgo', { count: 7 }));
  assert.equal(fmt.formatRelative(ago(2 * 3600), { now }), t('format.hoursAgo', { count: 2 }));
});

test('server dates use SHOTSTASH_DEFAULT_TIMEZONE (UTC when unset), not the machine zone', () => {
  const nearMidnightUtc = new Date('2026-09-28T23:30:00Z');
  assert.equal(fmt.formatServerDate(nearMidnightUtc, undefined), '28 Sep 2026');
  assert.equal(fmt.formatServerDate(nearMidnightUtc, 'UTC'), '28 Sep 2026');
  assert.equal(fmt.formatServerDate(nearMidnightUtc, 'Asia/Jakarta'), '29 Sep 2026');
  assert.equal(fmt.formatServerDate(nearMidnightUtc, 'Not/AZone'), '28 Sep 2026');
  assert.equal(fmt.formatServerDate(new Date('2026-09-28T00:30:00Z'), 'America/New_York'), '27 Sep 2026');
});

test('roleKey: five roles map to message keys, unknown or missing is null', () => {
  assert.deepEqual(
    ['SUPER_ADMIN', 'ADMIN', 'FIELD_CREW', 'EDITOR', 'VIEWER'].map((r) => perm.roleKey(r)),
    ['superAdmin', 'admin', 'crew', 'editor', 'viewer'],
  );
  assert.equal(perm.roleKey({ role: 'ADMIN' }), 'admin');
  assert.equal(perm.roleKey('AGENT'), null);
  assert.equal(perm.roleKey(null), null);
  assert.equal(perm.roleKey({ role: null }), null);
  for (const key of ['superAdmin', 'admin', 'crew', 'editor', 'viewer', 'unknown']) assert.ok(t(`roles.${key}`));
});

/* ---------------- leftover check ---------------- */

const words = check.loadLeftovers();

test('leftover check flags Indonesian text in literals and JSX, not comments or identifiers', () => {
  const src = [
    '// komentar yang boleh',
    'const ke = 1;',
    'export function A() {',
    '  const x = "Simpan perubahan";',
    '  return <div title={`ok ${ke}`}>Tutup dialog</div>;',
    '}',
  ].join('\n');
  const found = check.checkSource(src, words, 'fixture.tsx');
  assert.deepEqual(found, [
    { line: 4, word: 'simpan' },
    { line: 5, word: 'tutup' },
  ]);
  assert.deepEqual(check.checkSource('const a = "Save changes";', words, 'ok.ts'), []);
});

test('leftover check reads locale JSON values, not keys', () => {
  const json = '{\n  "dari": "From",\n  "b": "Dari sini"\n}\n';
  assert.deepEqual(check.checkMessages(json, words), [{ line: 3, word: 'dari' }]);
});

test('leftover check: compact JSON, ambiguous short words, gql and i18n-ignore', () => {
  assert.deepEqual(check.checkMessages('{"a":{"b":"Simpan ini"}}', words), [
    { line: 1, word: 'simpan' },
    { line: 1, word: 'ini' },
  ]);
  assert.deepEqual(check.checkSource('const a = "Ask Dan or Di";', words, 'a.ts'), []);
  assert.deepEqual(check.checkSource('const a = "foto dan video";', words, 'a.ts'), [
    { line: 1, word: 'foto' },
    { line: 1, word: 'dan' },
  ]);
  assert.deepEqual(check.checkSource('const a = "Dokumen";', words, 'a.ts'), [{ line: 1, word: 'dokumen' }]);
  assert.deepEqual(check.checkSource('const q = gql`query { simpan }`;', words, 'a.ts'), []);
  assert.deepEqual(check.checkSource('const a = "Tutup"; // i18n-ignore', words, 'a.ts'), []);
  assert.ok(check.resolveFileArgs(['no/such/file.ts']).error);
  assert.deepEqual(check.resolveFileArgs(['src/lib/format.ts']).files, ['src/lib/format.ts']);
});

test('messages/en.json is free of leftovers', () => {
  const text = readFileSync(new URL('../messages/en.json', import.meta.url), 'utf8');
  assert.deepEqual(check.checkMessages(text, words), []);
});

test('leftover words are disjoint from the privacy denylist', () => {
  const deny = new Set(
    readFileSync(new URL('./privacy-denylist.sha256', import.meta.url), 'utf8').split(/\r?\n/).filter(Boolean),
  );
  for (const w of words) assert.equal(deny.has(hashPhrase(normalizePhrase(w))), false, `denylisted: ${w}`);
});

test('no em dash in the English messages', () => {
  const text = readFileSync(new URL('../messages/en.json', import.meta.url), 'utf8');
  assert.equal(text.includes(String.fromCharCode(0x2014)), false);
});

/* ---------------- lint ---------------- */

test('lint: a new literal string in a translated file is reported', async () => {
  const { ESLint } = await import('eslint');
  const eslint = new ESLint({ cwd: fileURLToPath(new URL('..', import.meta.url)) });
  const code = 'export function A() {\n  return <p aria-label="Close panel">Hello there</p>;\n}\n';
  const [inScope] = await eslint.lintText(code, { filePath: 'src/app/page.tsx' });
  const rules = inScope.messages.map((m) => m.ruleId);
  assert.ok(rules.includes('i18next/no-literal-string'), `got ${rules.join(', ')}`);
  assert.ok(rules.includes('no-restricted-syntax'), `got ${rules.join(', ')}`);
  const [translated] = await eslint.lintText(
    'import { useTranslations } from "next-intl";\nexport function A() {\n  const t = useTranslations("common");\n  return <p aria-label={t("close")}>{t("cancel")} · 2</p>;\n}\n',
    { filePath: 'src/app/page.tsx' },
  );
  assert.deepEqual(
    translated.messages.filter((m) => /i18next|no-restricted-syntax/.test(m.ruleId ?? '')),
    [],
  );
});
