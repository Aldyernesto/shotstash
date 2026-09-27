#!/usr/bin/env node
/**
 * Story 2.9 — mendekode `public/folder-v2-shell.glb` (Draco) SEKALI DI
 * TAHAP BUILD menjadi modul geometri yang ikut di dalam chunk renderer
 * yang di-`import()` dinamis.
 *
 *   npm run build:folder-shell
 *
 * Kenapa bukan mendekode di runtime: dekoder Draco adalah ~100 KB wasm.
 * Story ini justru menuntut kartu "tidak menghabiskan memori atau membuat
 * halaman macet" di HP kelas bawah dan menetapkan anggaran GLB 8 KB —
 * mengirim dekoder 100 KB untuk membuka mesh 420 segitiga melawan
 * tujuannya sendiri. GLB-nya sendiri tetap disalin apa adanya ke
 * `public/` dan tetap dijaga gerbang <= 8.192 byte (AC 2.9); yang
 * berpindah ke tahap build hanyalah biaya dekodenya. Stempel sha256
 * membuat berkas turunan tidak bisa diam-diam basi — `check-folder-shell`
 * gagal bila GLB berubah tanpa regenerasi.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import draco3d from 'draco3d';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GLB = resolve(root, 'public/folder-v2-shell.glb');
const OUT_DIR = resolve(root, 'src/components/dashboard/project3d');
const OUT = resolve(OUT_DIR, 'shellGeometry.ts');

const glb = readFileSync(GLB);
const sha = createHash('sha256').update(glb).digest('hex');

/* ---- bongkar container GLB ---- */
if (glb.toString('ascii', 0, 4) !== 'glTF') throw new Error('bukan GLB');
let off = 12;
let json = null;
let bin = null;
while (off < glb.length) {
  const len = glb.readUInt32LE(off);
  const type = glb.toString('ascii', off + 4, off + 8);
  const body = glb.subarray(off + 8, off + 8 + len);
  if (type === 'JSON') json = JSON.parse(body.toString('utf8'));
  if (type.startsWith('BIN')) bin = body;
  off += 8 + len;
}
if (!json || !bin) throw new Error('chunk JSON/BIN tidak lengkap');

const decoderModule = await draco3d.createDecoderModule({});

function bufferViewBytes(index) {
  const bv = json.bufferViews[index];
  const start = bv.byteOffset || 0;
  return bin.subarray(start, start + bv.byteLength);
}

/** Dekode satu primitive ber-KHR_draco_mesh_compression. */
function decodePrimitive(prim) {
  const ext = prim.extensions?.KHR_draco_mesh_compression;
  if (!ext) throw new Error('primitive tanpa ekstensi Draco — tidak didukung skrip ini');
  const bytes = bufferViewBytes(ext.bufferView);

  const decoder = new decoderModule.Decoder();
  const buffer = new decoderModule.DecoderBuffer();
  buffer.Init(new Int8Array(bytes), bytes.length);
  const geomType = decoder.GetEncodedGeometryType(buffer);
  if (geomType !== decoderModule.TRIANGULAR_MESH) throw new Error('bukan triangular mesh');

  const mesh = new decoderModule.Mesh();
  const status = decoder.DecodeBufferToMesh(buffer, mesh);
  if (!status.ok()) throw new Error('gagal dekode Draco: ' + status.error_msg());

  const numPoints = mesh.num_points();
  const numFaces = mesh.num_faces();

  const readAttr = (dracoId, components) => {
    const attr = decoder.GetAttributeByUniqueId(mesh, dracoId);
    const arr = new decoderModule.DracoFloat32Array();
    decoder.GetAttributeFloatForAllPoints(mesh, attr, arr);
    const out = new Float32Array(numPoints * components);
    for (let i = 0; i < numPoints * components; i++) out[i] = arr.GetValue(i);
    decoderModule.destroy(arr);
    return out;
  };

  const positions = readAttr(ext.attributes.POSITION, 3);
  const normals =
    ext.attributes.NORMAL != null ? readAttr(ext.attributes.NORMAL, 3) : new Float32Array(0);

  const indices = new Uint16Array(numFaces * 3);
  const face = new decoderModule.DracoInt32Array();
  for (let f = 0; f < numFaces; f++) {
    decoder.GetFaceFromMesh(mesh, f, face);
    indices[f * 3] = face.GetValue(0);
    indices[f * 3 + 1] = face.GetValue(1);
    indices[f * 3 + 2] = face.GetValue(2);
  }
  decoderModule.destroy(face);
  decoderModule.destroy(mesh);
  decoderModule.destroy(buffer);
  decoderModule.destroy(decoder);

  return { positions, normals, indices, numPoints, numFaces };
}

/* ---- node → mesh, dengan translasi/rotasi dari glTF ---- */
const parts = [];
let totalTris = 0;
for (const node of json.nodes) {
  if (node.mesh == null) continue;
  const mesh = json.meshes[node.mesh];
  const prim = mesh.primitives[0];
  const geo = decodePrimitive(prim);
  totalTris += geo.numFaces;
  const material = json.materials[prim.material] ?? {};
  const base = material.pbrMetallicRoughness?.baseColorFactor ?? [1, 1, 1, 1];
  parts.push({
    name: node.name ?? mesh.name ?? `mesh${node.mesh}`,
    translation: node.translation ?? [0, 0, 0],
    rotation: node.rotation ?? [0, 0, 0, 1],
    scale: node.scale ?? [1, 1, 1],
    baseColor: base.slice(0, 3),
    roughness: material.pbrMetallicRoughness?.roughnessFactor ?? 0.5,
    ...geo,
  });
}

/* ---- kotak batas seluruh objek (dipakai kalibrasi kamera) ---- */
const bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
function applyNode(p, i) {
  const [x, y, z] = [p.positions[i * 3], p.positions[i * 3 + 1], p.positions[i * 3 + 2]];
  const [qx, qy, qz, qw] = p.rotation;
  // rotasi kuaternion
  const ix = qw * x + qy * z - qz * y;
  const iy = qw * y + qz * x - qx * z;
  const iz = qw * z + qx * y - qy * x;
  const iw = -qx * x - qy * y - qz * z;
  const rx = ix * qw + iw * -qx + iy * -qz - iz * -qy;
  const ry = iy * qw + iw * -qy + iz * -qx - ix * -qz;
  const rz = iz * qw + iw * -qz + ix * -qy - iy * -qx;
  return [rx * p.scale[0] + p.translation[0], ry * p.scale[1] + p.translation[1], rz * p.scale[2] + p.translation[2]];
}
for (const p of parts) {
  p.bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  for (let i = 0; i < p.numPoints; i++) {
    const v = applyNode(p, i);
    for (let k = 0; k < 3; k++) {
      if (v[k] < bounds.min[k]) bounds.min[k] = v[k];
      if (v[k] > bounds.max[k]) bounds.max[k] = v[k];
      if (v[k] < p.bounds.min[k]) p.bounds.min[k] = v[k];
      if (v[k] > p.bounds.max[k]) p.bounds.max[k] = v[k];
    }
  }
}
for (const p of parts) {
  console.log('  ', p.name.padEnd(14), 'min', p.bounds.min.map((n) => n.toFixed(3)).join(', '),
    '  max', p.bounds.max.map((n) => n.toFixed(3)).join(', '), '  warna', p.baseColor.map((c) => c.toFixed(4)).join(','));
}

const f = (arr, digits = 4) =>
  '[' + Array.from(arr, (v) => Number(v.toFixed(digits))).join(',') + ']';

const body = `// BERKAS TURUNAN — JANGAN DIEDIT TANGAN.
// Dihasilkan \`npm run build:folder-shell\` dari public/folder-v2-shell.glb
// (Draco, ${glb.length} byte, ${totalTris} segitiga). Story 2.9.
//
// Geometri didekode SEKALI di tahap build supaya runtime tidak perlu
// dekoder Draco (~100 KB wasm) di HP kelas bawah. Modul ini hanya masuk
// ke chunk renderer yang di-import() dinamis saat Kartu Project pertama
// masuk layar — tidak pernah ke bundle awal. \`check-folder-shell\` gagal
// bila GLB berubah tanpa regenerasi berkas ini.

export const SOURCE_GLB_SHA256 = "${sha}";
export const SOURCE_GLB_BYTES = ${glb.length};
export const TRIANGLE_COUNT = ${totalTris};

/** Kotak batas objek setelah transform node (x, y, z). */
export const SHELL_BOUNDS = {
  min: ${f(bounds.min)},
  max: ${f(bounds.max)},
} as const;

export type ShellPart = {
  name: string;
  translation: [number, number, number];
  rotation: [number, number, number, number];
  scale: [number, number, number];
  baseColor: [number, number, number];
  roughness: number;
  /** Kotak batas bagian ini SETELAH transform node. */
  bounds: { min: [number, number, number]; max: [number, number, number] };
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint16Array;
};

export const SHELL_PARTS: ShellPart[] = [
${parts
  .map(
    (p) => `  {
    name: ${JSON.stringify(p.name)},
    translation: ${f(p.translation)},
    rotation: ${f(p.rotation, 6)},
    scale: ${f(p.scale)},
    baseColor: ${f(p.baseColor, 5)},
    roughness: ${Number(p.roughness.toFixed(4))},
    bounds: { min: ${f(p.bounds.min)}, max: ${f(p.bounds.max)} },
    positions: new Float32Array(${f(p.positions)}),
    normals: new Float32Array(${f(p.normals, 3)}),
    indices: new Uint16Array(${f(p.indices, 0)}),
  },`,
  )
  .join('\n')}
];
`;

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT, body, 'utf8');
console.log(
  `shellGeometry.ts ditulis: ${parts.length} bagian (${parts.map((p) => p.name).join(', ')}), ` +
    `${totalTris} segitiga, ${(body.length / 1024).toFixed(1)} KB sumber.`,
);
console.log('bounds', JSON.stringify(bounds));
