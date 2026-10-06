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

test('the mark in every brand SVG uses brand.mark', () => {
  const ogSvg = brand.ogImage.url.replace(/\.png$/, '.svg');
  for (const p of [brand.icon, brand.logo.onDark, brand.logo.onLight, ogSvg]) {
    const svg = readFileSync(pub(p), 'utf8');
    // The mark is the first rounded rect of the 512 grid: <rect width="512" height="512" rx=... fill=...>.
    const m = svg.match(/<rect width="512" height="512" rx="[\d.]+" fill="(#[0-9a-f]{6})"/i);
    assert.ok(m, `no mark rect in public${p}`);
    assert.equal(m[1].toLowerCase(), brand.mark, p);
  }
});

test('README banner: SVG source with the brand mark, PNG rendered at 1280x640', async () => {
  const { default: sharp } = await import('sharp');
  const dir = path.join(ROOT, '.github', 'assets');
  const svg = readFileSync(path.join(dir, 'banner.svg'), 'utf8');
  const m = svg.match(/<rect width="512" height="512" rx="[\d.]+" fill="(#[0-9a-f]{6})"/i);
  assert.ok(m, 'no mark rect in .github/assets/banner.svg');
  assert.equal(m[1].toLowerCase(), brand.mark);
  // Outlined paths only: no font is needed to render it.
  assert.doesNotMatch(svg, /<text\b/);
  const meta = await sharp(path.join(dir, 'banner.png')).metadata();
  assert.equal(meta.width, 1280);
  assert.equal(meta.height, 640);
});
