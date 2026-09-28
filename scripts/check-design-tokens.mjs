#!/usr/bin/env node
/**
 * Compares the spine color tokens in docs/design/DESIGN.md with the values
 * actually installed in src/app/globals.css. Color values may only come from
 * the spine; they must never be invented in CSS.
 *
 *   node scripts/check-design-tokens.mjs        -> exit 0 when they match
 *
 * Rules enforced:
 *   1. Every `colors:` name in DESIGN.md exists as --app-spine-<name>, except
 *      the 11 chrome names with a -light suffix, which fold into one property
 *      that switches value under html[data-theme="light"].
 *   2. The value is exactly the DESIGN.md value (lowercase, no spaces).
 *   3. No --app-spine-* property exists that DESIGN.md does not know.
 *   4. UNDECLARED: every var(--app-spine-<name>) reference in the .css, .ts
 *      and .tsx files under src/ names a property that globals.css declares.
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DESIGN = resolve(root, 'docs/design/DESIGN.md');
const CSS = resolve(root, 'src/app/globals.css');

/** Folded chrome names: each <name>/<name>-light pair becomes one property. */
const FOLDED = ['bg', 'surface', 'surface-2', 'line', 'input-border', 'text',
  'text-soft', 'muted', 'nav-idle', 'meta', 'placeholder'];

if (!existsSync(DESIGN)) {
  // Deployments may ship without docs/. CI always has it, so the gate still runs there.
  console.log('Skipped: docs/design/DESIGN.md is not present in this environment.');
  process.exit(0);
}

const design = readFileSync(DESIGN, 'utf8');
const colorsBlock = design.split(/^colors:$/m)[1]?.split(/^[a-z-]+:$/m)[0] ?? '';
const spine = new Map();
for (const line of colorsBlock.split('\n')) {
  const m = line.match(/^\s{2,}([a-z0-9-]+):\s*'([^']+)'/i);
  if (m) spine.set(m[1], m[2].trim().toLowerCase());
}

const css = readFileSync(CSS, 'utf8');
const installed = new Map();
for (const m of css.matchAll(/--app-spine-([a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
  const name = m[1];
  const value = m[2].trim().toLowerCase();
  if (!installed.has(name)) installed.set(name, []);
  installed.get(name).push(value);
}

const problems = [];
for (const [name, value] of spine) {
  const base = FOLDED.find((b) => name === `${b}-light`);
  const target = base ?? name;
  const values = installed.get(target);
  if (!values) { problems.push(`MISSING  --app-spine-${target} (DESIGN.md: ${name} = ${value})`); continue; }
  if (!values.includes(value)) {
    problems.push(`VALUE    --app-spine-${target} does not carry ${value} from DESIGN.md ${name} (found: ${values.join(', ')})`);
  }
}
for (const name of installed.keys()) {
  const known = spine.has(name) || spine.has(`${name}-light`);
  if (!known) problems.push(`UNKNOWN  --app-spine-${name} is not in DESIGN.md colors:`);
}
for (const base of FOLDED) {
  if (installed.has(`${base}-light`)) problems.push(`DUPLICATE --app-spine-${base}-light should be folded into --app-spine-${base}`);
}

const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
  (e.isDirectory() ? walk(resolve(dir, e.name)) : [resolve(dir, e.name)]));
for (const file of walk(resolve(root, 'src')).filter((p) => /\.(css|ts|tsx)$/.test(p))) {
  const text = readFileSync(file, 'utf8');
  for (const m of text.matchAll(/var\(\s*--app-spine-([a-z0-9-]+)/gi)) {
    if (installed.has(m[1])) continue;
    const line = text.slice(0, m.index).split('\n').length;
    const rel = file.slice(root.length + 1).replaceAll('\\', '/');
    problems.push(`UNDECLARED --app-spine-${m[1]} used in ${rel}:${line} is not declared in globals.css`);
  }
}

const checked = spine.size;
if (problems.length) {
  console.error(`Color tokens do NOT match DESIGN.md (${problems.length} problems across ${checked} tokens):`);
  for (const p of problems) console.error('  ' + p);
  process.exit(1);
}
console.log(`Color tokens match DESIGN.md: ${checked} spine tokens, ${installed.size} properties installed.`);
