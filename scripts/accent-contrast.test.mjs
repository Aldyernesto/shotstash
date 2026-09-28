// WCAG contrast gate for the accent family. Values come from the colors: block
// of docs/design/DESIGN.md (check:tokens keeps globals.css in lockstep with it).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { brand } from '../src/lib/brand.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const design = readFileSync(path.join(ROOT, 'docs/design/DESIGN.md'), 'utf8');
const block = design.split(/^colors:$/m)[1].split(/^[a-z-]+:$/m)[0];
const c = {};
for (const line of block.split('\n')) {
  const m = line.match(/^\s{2,}([a-z0-9-]+):\s*'(#[0-9a-f]{6})'/i);
  if (m) c[m[1]] = m[2].toLowerCase();
}

function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

const DARK = ['bg', 'surface', 'surface-2'];
const LIGHT = ['bg-light', 'surface-light', 'surface-2-light'];
const STAGE = ['stage-1', 'stage-mid', 'stage-2', 'label-pill', 'object-back-top', 'pocket-top', 'scrim'];

// [foreground, background, minimum ratio, why]
const PAIRS = [
  ['on-accent', 'accent', 4.5, 'text and icons on the accent fill'],
  ['on-accent', 'accent-edge', 4.5, 'white text reaching over the accent-edge lip'],
  ['ink', 'accent-2', 4.5, 'dark legacy primary fill (--color-primary) with ink text'],
  ['on-accent', 'accent-text-light', 4.5, 'text on the light legacy primary fill'],
  ...[...DARK, ...LIGHT].map((bg) => ['accent', bg, 3, 'accent fill as a UI boundary']),
  ...[...DARK, ...STAGE].map((bg) => ['accent-2', bg, 4.5, 'accent text on dark surfaces']),
  ...DARK.map((bg) => ['accent-2', bg, 3, 'dark focus ring']),
  ...LIGHT.map((bg) => ['accent-text-light', bg, 4.5, 'accent text on light surfaces']),
  ...[...DARK, ...LIGHT].map((bg) => ['accent', bg, 3, 'accent focus/selection ring on page chrome']),
  ...STAGE.map((bg) => ['accent-2', bg, 3, 'boundary on invariant dark surfaces (selection, drop outline, video progress)']),
  ...LIGHT.map((bg) => ['accent-edge', bg, 3, 'accent-edge lip as a boundary on light surfaces']),
  ...DARK.map((bg) => ['warning-text', bg, 4.5, 'warning text, dark theme']),
  ...LIGHT.map((bg) => ['warning-text-light', bg, 4.5, 'warning text, light theme']),
  ...DARK.map((bg) => ['warning', bg, 3, 'warning fill as a UI boundary, dark theme']),
];

test('every accent pair meets WCAG AA', () => {
  const failures = [];
  for (const [fg, bg, min, why] of PAIRS) {
    assert.ok(c[fg] && c[bg], `DESIGN.md is missing ${c[fg] ? bg : fg}`);
    const ratio = contrast(c[fg], c[bg]);
    if (ratio < min) failures.push(`${fg} on ${bg} = ${ratio.toFixed(2)}:1 < ${min}:1 (${why})`);
  }
  assert.deepEqual(failures, []);
});

test('brand.ts accent values match the spine tokens', () => {
  assert.equal(brand.accent, c.accent);
  assert.equal(brand.accentEdge, c['accent-edge']);
  assert.equal(brand.onAccent, c['on-accent']);
});

test('--app-accent maps to accent-2 (dark) and accent-text-light (light)', () => {
  const css = readFileSync(path.join(ROOT, 'src/app/globals.css'), 'utf8');
  const block = (selector) => {
    const i = css.indexOf(selector + ' {');
    assert.ok(i !== -1, `missing ${selector} block`);
    return css.slice(i, css.indexOf('}', i));
  };
  assert.match(block(':root,\nhtml[data-theme="dark"]'), /--app-accent: var\(--app-spine-accent-2\);/);
  assert.match(block('html[data-theme="light"]'), /--app-accent: var\(--app-spine-accent-text-light\);/);
});
