#!/usr/bin/env node
/**
 * Membandingkan token warna spine di DESIGN.md dengan yang benar-benar terpasang
 * di src/app/globals.css. Dipakai sebagai gerbang mutu Story 1.1 dan seterusnya:
 * nilai warna hanya boleh berasal dari spine, tidak boleh dikarang di CSS.
 *
 *   node scripts/check-design-tokens.mjs        -> keluar 0 bila cocok
 *
 * Aturan yang dijaga:
 *   1. Setiap nama `colors:` di DESIGN.md hadir sebagai --app-spine-<nama>,
 *      kecuali 11 nama chrome bersufiks -light yang sengaja dilipat menjadi
 *      satu property yang berganti nilai di html[data-theme="light"].
 *   2. Nilainya persis sama dengan DESIGN.md (huruf kecil, tanpa spasi).
 *   3. Tidak ada --app-spine-* yang tidak dikenal DESIGN.md.
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DESIGN = resolve(root, 'docs/design/DESIGN.md');
const CSS = resolve(root, 'src/app/globals.css');

/** Nama chrome yang dilipat: pasangan <nama>/<nama>-light jadi satu property. */
const FOLDED = ['bg', 'surface', 'surface-2', 'line', 'input-border', 'text',
  'text-soft', 'muted', 'nav-idle', 'meta', 'placeholder'];

if (!existsSync(DESIGN)) {
  // Spine hanya ada di repo pengembangan; server produksi tidak menerima
  // docs/. Lewati dengan tenang supaya bukan alarm palsu.
  console.log('Lewati: DESIGN.md tidak ada di lingkungan ini (gerbang token hanya berlaku di repo pengembangan).');
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
  if (!values) { problems.push(`HILANG  --app-spine-${target} (DESIGN.md: ${name} = ${value})`); continue; }
  if (!values.includes(value)) {
    problems.push(`NILAI   --app-spine-${target} tidak memuat ${value} dari DESIGN.md ${name} (ada: ${values.join(', ')})`);
  }
}
for (const name of installed.keys()) {
  const known = spine.has(name) || spine.has(`${name}-light`);
  if (!known) problems.push(`ASING   --app-spine-${name} tidak ada di DESIGN.md colors:`);
}
for (const base of FOLDED) {
  if (installed.has(`${base}-light`)) problems.push(`KEMBAR  --app-spine-${base}-light seharusnya dilipat ke --app-spine-${base}`);
}

const checked = spine.size;
if (problems.length) {
  console.error(`Token warna TIDAK cocok dengan DESIGN.md (${problems.length} masalah dari ${checked} token):`);
  for (const p of problems) console.error('  ' + p);
  process.exit(1);
}
console.log(`Token warna cocok dengan DESIGN.md: ${checked} token spine, ${installed.size} property terpasang.`);
