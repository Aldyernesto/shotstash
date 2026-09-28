#!/usr/bin/env node
/**
 * Renders the raster brand assets from the SVG sources in public/brand/ and
 * copies the favicon. Run after replacing the SVGs:
 *
 *   npm run brand:assets
 *
 *   public/brand/icon.svg  -> src/app/icon.svg (byte copy, the favicon)
 *                          -> public/brand/logo.png (128px, email logo)
 *                          -> src/app/apple-icon.png (180px, full bleed: iOS
 *                             applies its own mask, so the corners are filled
 *                             with brand.mark instead of staying transparent)
 *   public/brand/og.svg    -> public/brand/og.png (1200x630 social card)
 */
import { copyFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { brand } from '../src/lib/brand.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pub = (p) => path.join(ROOT, 'public', p.replace(/^\//, ''));

const icon = pub(brand.icon);
copyFileSync(icon, path.join(ROOT, 'src/app/icon.svg'));

const iconSvg = readFileSync(icon);
await sharp(iconSvg, { density: 300 }).resize(128, 128).png().toFile(pub(brand.emailLogo));
await sharp(iconSvg, { density: 300 })
  .resize(180, 180)
  .flatten({ background: brand.mark })
  .png()
  .toFile(path.join(ROOT, 'src/app/apple-icon.png'));

const og = pub(brand.ogImage.url.replace(/\.png$/, '.svg'));
await sharp(readFileSync(og))
  .resize(brand.ogImage.width, brand.ogImage.height)
  .png()
  .toFile(pub(brand.ogImage.url));

console.log('brand:assets: icon.svg copied; logo.png, apple-icon.png and og.png rendered');
