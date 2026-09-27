// Checks that src/lib/brand.ts points at real files and matches the assets.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { brand } from '../src/lib/brand.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pub = (p) => path.join(ROOT, 'public', p.replace(/^\//, ''));

test('every public asset path in brand.ts exists', () => {
  for (const p of [brand.logo.onDark, brand.logo.onLight, brand.icon, brand.ogImage.url, brand.emailLogo]) {
    assert.ok(existsSync(pub(p)), `missing public${p}`);
  }
});

test('wordmark width and height match brand.logo', () => {
  for (const p of [brand.logo.onDark, brand.logo.onLight]) {
    const svg = readFileSync(pub(p), 'utf8');
    const root = svg.match(/<svg\b[^>]*>/)[0];
    assert.equal(Number(root.match(/\swidth="([^"]+)"/)[1]), brand.logo.width, p);
    assert.equal(Number(root.match(/\sheight="([^"]+)"/)[1]), brand.logo.height, p);
  }
});

test('favicon src/app/icon.svg is the brand icon', () => {
  assert.deepEqual(readFileSync(path.join(ROOT, 'src', 'app', 'icon.svg')), readFileSync(pub(brand.icon)));
});
