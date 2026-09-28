/**
 * Generates the brand custom properties in src/app/globals.css from
 * src/lib/brand.ts. The block between the `brand:start` and `brand:end`
 * markers is owned by this script; never edit it by hand.
 *
 *   npm run brand:css              rewrite the block
 *   npm run brand:css -- --check   exit 1 when the block is stale
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brand } from '../src/lib/brand';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CSS = resolve(root, 'src/app/globals.css');
const START = '/* brand:start */';
const END = '/* brand:end */';

// JSON string escaping (backslash and double quote) is valid CSS string escaping for these values.
const cssString = (value: string) => JSON.stringify(value);

export function renderBrandBlock(): string {
  const lines = [
    START,
    '  /* Generated from src/lib/brand.ts by `npm run brand:css`. Do not edit. */',
    `  --brand-name: ${cssString(brand.productName)};`,
    `  --brand-accent: ${brand.accent};`,
    `  --brand-accent-edge: ${brand.accentEdge};`,
    `  --brand-on-accent: ${brand.onAccent};`,
    `  --brand-mark: ${brand.mark};`,
    `  --brand-theme-color: ${brand.themeColor};`,
    `  --brand-logo-on-dark: url(${cssString(brand.logo.onDark)});`,
    `  --brand-logo-on-light: url(${cssString(brand.logo.onLight)});`,
    `  --brand-logo-aspect: ${brand.logo.width} / ${brand.logo.height};`,
    `  --brand-icon: url(${cssString(brand.icon)});`,
    `  ${END}`,
  ];
  return lines.join('\n');
}

function main() {
  const check = process.argv.includes('--check');
  const css = readFileSync(CSS, 'utf8');
  const start = css.indexOf(START);
  const end = css.indexOf(END);
  if (start === -1 || end === -1 || end < start) {
    console.error(`brand:css: markers ${START} ... ${END} not found in src/app/globals.css`);
    process.exit(1);
  }
  if (css.indexOf(START, start + 1) !== -1 || css.indexOf(END, end + 1) !== -1) {
    console.error(`brand:css: more than one ${START} ... ${END} block in src/app/globals.css`);
    process.exit(1);
  }
  const next = css.slice(0, start) + renderBrandBlock() + css.slice(end + END.length);
  if (next === css) {
    console.log('brand:css: globals.css is up to date');
    return;
  }
  if (check) {
    console.error('brand:css: globals.css is stale, run `npm run brand:css`');
    process.exit(1);
  }
  writeFileSync(CSS, next);
  console.log('brand:css: globals.css updated');
}

// Run only when executed directly, not when imported (e.g. by tests).
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
