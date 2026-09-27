#!/usr/bin/env node
/**
 * Story 2.9 — gerbang build objek 3D Kartu Project.
 *
 *   node scripts/check-folder-shell.mjs      -> keluar 0 bila lolos
 *
 * Yang dijaga:
 *   1. `public/folder-v2-shell.glb` ADA dan ukurannya <= 8.192 byte
 *      (AC 2.9 menyebut angka ini sebagai gerbang langkah build).
 *   2. Berkas itu byte-identik dengan sumbernya di mockups/assets —
 *      spine menuntut ia disalin "apa adanya", jadi penyalinan yang
 *      keliru (mis. re-export, konversi CRLF) ikut tertangkap.
 *   3. Geometri turunan `shellGeometry.ts` masih cocok dengan GLB itu
 *      (stempel byte-length + sha256 dicatat di berkas turunan).
 *
 * Perbandingan (2) dan (3) dilewati dengan tenang bila sumber spine
 * tidak ada — server produksi tidak menerima folder docs/.
 */
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GLB = resolve(root, 'public/folder-v2-shell.glb');
const SRC = resolve(
  root,
  'docs/design/assets/folder-v2-shell.glb',
);
const GEOM = resolve(root, 'src/components/dashboard/project3d/shellGeometry.ts');

const MAX_BYTES = 8192;
const problems = [];

if (!existsSync(GLB)) {
  problems.push(`HILANG  public/folder-v2-shell.glb tidak ada.`);
} else {
  const glb = readFileSync(GLB);
  if (glb.length > MAX_BYTES) {
    problems.push(
      `UKURAN  public/folder-v2-shell.glb ${glb.length} byte melebihi batas ${MAX_BYTES} byte.`,
    );
  }
  if (glb.length < 12 || glb.toString('ascii', 0, 4) !== 'glTF') {
    problems.push('BENTUK  public/folder-v2-shell.glb bukan berkas GLB yang sah.');
  }
  if (existsSync(SRC)) {
    const src = readFileSync(SRC);
    if (!src.equals(glb)) {
      problems.push(
        'SALINAN public/folder-v2-shell.glb tidak byte-identik dengan sumber spine di mockups/assets.',
      );
    }
  }
  if (existsSync(GEOM)) {
    const sha = createHash('sha256').update(glb).digest('hex');
    const geom = readFileSync(GEOM, 'utf8');
    const m = geom.match(/SOURCE_GLB_SHA256 = "([0-9a-f]{64})"/);
    if (!m) {
      problems.push('STEMPEL shellGeometry.ts tidak memuat SOURCE_GLB_SHA256.');
    } else if (m[1] !== sha) {
      problems.push(
        'BASI    shellGeometry.ts dibuat dari GLB lain — jalankan `npm run build:folder-shell`.',
      );
    }
  }
}

if (problems.length) {
  console.error(`Objek 3D Kartu Project TIDAK lolos gerbang build (${problems.length} masalah):`);
  for (const p of problems) console.error('  ' + p);
  process.exit(1);
}
console.log(
  `Objek 3D Kartu Project lolos: folder-v2-shell.glb ${readFileSync(GLB).length}/${MAX_BYTES} byte, byte-identik dengan spine.`,
);
