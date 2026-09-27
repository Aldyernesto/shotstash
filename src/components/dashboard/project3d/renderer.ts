/**
 * Story 2.9 — renderer WebGL BERSAMA untuk objek 3D Kartu Project.
 *
 * Kontrak keras dari AC:
 *   • TEPAT SATU context WebGL untuk seluruh grid, berapa pun jumlah
 *     kartunya. Modul ini memegang satu canvas + satu context di level
 *     modul; tidak ada jalan membuat yang kedua.
 *   • Renderer berhenti menggambar saat tidak ada yang berubah —
 *     dashboard yang diam memakai 0 frame per detik. Di sini bahkan
 *     tidak ada `requestAnimationFrame` sama sekali: setiap kartu di
 *     grid adalah objek yang SAMA pada lebar yang sama, jadi shell
 *     dirender SEKALI per (lebar × devicePixelRatio × tema) menjadi dua
 *     lapisan gambar yang dipakai bersama oleh semua kartu. Gerak kipas,
 *     squish saku, dan hover tetap murni CSS di DOM.
 *   • `devicePixelRatio` dijepit maksimum 2.
 *   • Kegagalan apa pun (WebGL tidak ada, context hilang, shader gagal)
 *     mengembalikan null — pemanggil tetap memakai gambar diam CSS dan
 *     TIDAK memunculkan pesan error kepada pengguna.
 *
 * Bentuk objeknya datang dari `shellGeometry.ts`, hasil dekode
 * `public/folder-v2-shell.glb` (Draco, 420 segitiga) di tahap build.
 * WARNANYA datang dari token spine, bukan dari material GLB: form milik
 * GLB, warna milik spine, sehingga jalur 3D dan jalur gambar diam tidak
 * pernah berbeda warna. Tidak ada teks yang dipanggang ke tekstur —
 * `label_pill` sengaja TIDAK digambar karena pill nama harus melebar
 * mengikuti nama project, jadi ia tetap elemen DOM.
 */

import { SHELL_PARTS, type ShellPart } from "./shellGeometry";

export type ShellLayers = {
  /** URL objek gambar panel belakang (lapisan di belakang kipas). */
  back: string;
  /** URL objek gambar saku depan (lapisan di depan kipas). */
  front: string;
  /** Lebar objek (CSS px) yang dipakai saat merender. */
  width: number;
  dpr: number;
};

export type ShellColors = {
  /** {colors.object-back-top} → {colors.object-back-bottom} */
  backTop: [number, number, number];
  backBottom: [number, number, number];
  /** {colors.pocket-top} / {colors.pocket-mid} / {colors.pocket-bottom} */
  pocketTop: [number, number, number];
  pocketMid: [number, number, number];
  pocketBottom: [number, number, number];
};

/* ------------------------------------------------------------------ */
/* Kalibrasi: peta dunia 3D → kotak objek 330 × 300 px desain           */
/* ------------------------------------------------------------------ */

/** Ukuran kotak objek dalam piksel desain (sama dengan CSS Story 2.6). */
const OBJ_W = 330;
const OBJ_H = 300;
/** Kotak saku CSS di dalam kotak itu: x 8..322, y (dari bawah) 0..162. */
const POCKET_X0 = 8;
const POCKET_X1 = 322;
const POCKET_Y0 = 0;
const POCKET_Y1 = 162;
/** Kekuatan perspektif: makin besar makin datar. */
const CAM_DISTANCE = 9;

const PART_BACK = "pocket_back";
const PART_FRONT = "pocket_front";

function findPart(name: string): ShellPart | undefined {
  return SHELL_PARTS.find((p) => p.name === name);
}

/**
 * Peta afin dunia → NDC, dipas supaya kotak batas `pocket_front`
 * mendarat PERSIS di kotak saku CSS. Dengan begitu teks DOM (pill nama,
 * tanggal, count-sticker) tidak bergeser sedikit pun saat kartu
 * berpindah antara jalur gambar diam dan jalur 3D.
 */
function fit() {
  const front = findPart(PART_FRONT);
  if (!front) return null;
  const [wx0, wy0] = front.bounds.min;
  const [wx1, wy1] = front.bounds.max;

  // px desain -> NDC (x: 0..330 -> -1..1, y dari bawah: 0..300 -> -1..1)
  const pxToNdcX = (px: number) => (px / OBJ_W) * 2 - 1;
  const pxToNdcY = (px: number) => (px / OBJ_H) * 2 - 1;

  const nx0 = pxToNdcX(POCKET_X0);
  const nx1 = pxToNdcX(POCKET_X1);
  const ny0 = pxToNdcY(POCKET_Y0);
  const ny1 = pxToNdcY(POCKET_Y1);

  const sx = (nx1 - nx0) / (wx1 - wx0);
  const sy = (ny1 - ny0) / (wy1 - wy0);
  const cx = wx0 - nx0 / sx;
  const cy = wy0 - ny0 / sy;
  const zRef = (front.bounds.min[2] + front.bounds.max[2]) / 2;
  return { sx, sy, cx, cy, zRef };
}

/* ------------------------------------------------------------------ */
/* Shader                                                              */
/* ------------------------------------------------------------------ */

const VERT = `
attribute vec3 aPos;
attribute vec3 aNormal;
uniform vec3 uTranslate;
uniform vec4 uRotate;      // kuaternion
uniform vec3 uScale;
uniform vec4 uFit;         // sx, sy, cx, cy
uniform float uZRef;
uniform float uCamDistance;
varying vec3 vNormal;
varying float vHeight;

vec3 qrot(vec4 q, vec3 v) {
  return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v);
}

void main() {
  vec3 world = qrot(uRotate, aPos) * uScale + uTranslate;
  vNormal = normalize(qrot(uRotate, aNormal));
  vHeight = world.y;
  // Pembagi perspektif ringan di sekitar bidang acuan.
  float w = 1.0 - (world.z - uZRef) / uCamDistance;
  float x = (world.x - uFit.z) * uFit.x;
  float y = (world.y - uFit.w) * uFit.y;
  float z = clamp(-world.z * 0.5, -0.95, 0.95);
  gl_Position = vec4(x * w, y * w, z * w, w);
}
`;

const FRAG = `
precision mediump float;
varying vec3 vNormal;
varying float vHeight;
uniform vec3 uColorTop;
uniform vec3 uColorMid;
uniform vec3 uColorBottom;
uniform vec2 uHeightRange;   // y min, y max objek ini

void main() {
  float t = clamp((vHeight - uHeightRange.x) / max(uHeightRange.y - uHeightRange.x, 1e-4), 0.0, 1.0);
  // gradasi tiga henti persis seperti token spine saku
  vec3 albedo = t > 0.5
    ? mix(uColorMid, uColorTop, (t - 0.5) * 2.0)
    : mix(uColorBottom, uColorMid, t * 2.0);

  vec3 n = normalize(vNormal);
  // Satu key light dari depan-atas + fill lembut; nilainya dipilih agar
  // permukaan datar mendarat tepat di warna token (faktor 1.0), jadi
  // jalur 3D dan jalur gambar diam CSS berwarna sama.
  vec3 keyDir = normalize(vec3(-0.25, 0.55, 1.0));
  float key = max(dot(n, keyDir), 0.0);
  float fill = 0.5 + 0.5 * n.y;
  float shade = 0.72 + 0.28 * key + 0.16 * fill;

  // Kilau tipis di tepi (clearcoat GLB) — menghidupkan pinggiran bulat.
  float rim = pow(1.0 - max(n.z, 0.0), 3.0);
  vec3 color = albedo * shade + vec3(0.02) * rim * key;

  // Kembali ke sRGB: albedo dikirim dalam ruang linear (token spine
  // di-degamma di useShellLayers), jadi tanpa langkah ini objek 3D akan
  // jauh lebih gelap daripada gradasi CSS jalur gambar diam.
  gl_FragColor = vec4(pow(max(color, vec3(0.0)), vec3(1.0 / 2.2)), 1.0);
}
`;

/* ------------------------------------------------------------------ */
/* Context bersama — SATU untuk seluruh dokumen                        */
/* ------------------------------------------------------------------ */

type Ctx = {
  canvas: HTMLCanvasElement;
  gl: WebGLRenderingContext;
  program: WebGLProgram;
  loc: Record<string, WebGLUniformLocation | null>;
  attr: { pos: number; normal: number };
  buffers: Map<string, { pos: WebGLBuffer; normal: WebGLBuffer; index: WebGLBuffer; count: number }>;
};

let ctx: Ctx | null = null;
let contextLost = false;
let recoveryAttempted = false;
let onLostCallback: (() => void) | null = null;

/** Apakah WebGL tersedia sama sekali di perangkat ini. */
export function isWebglAvailable(): boolean {
  if (typeof document === "undefined") return false;
  try {
    const probe = document.createElement("canvas");
    const gl =
      probe.getContext("webgl2") ||
      probe.getContext("webgl") ||
      probe.getContext("experimental-webgl");
    if (!gl) return false;
    // Lepaskan context penjajakan supaya tidak ikut dihitung.
    const ext = (gl as WebGLRenderingContext).getExtension("WEBGL_lose_context");
    ext?.loseContext();
    return true;
  } catch {
    return false;
  }
}

function compile(gl: WebGLRenderingContext, type: number, src: string) {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

function ensureContext(): Ctx | null {
  if (ctx) return ctx;
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  // Canvas ini SENGAJA tidak pernah dimasukkan ke dokumen: ia hanya
  // sumber gambar. Jumlah context WebGL "hidup di dokumen" karena itu
  // tidak pernah lebih dari satu, berapa pun jumlah kartunya.
  const gl = (canvas.getContext("webgl", {
    alpha: true,
    antialias: true,
    premultipliedAlpha: true,
    preserveDrawingBuffer: false,
    powerPreference: "low-power",
  }) || canvas.getContext("experimental-webgl")) as WebGLRenderingContext | null;
  if (!gl) return null;

  canvas.addEventListener("webglcontextlost", (e) => {
    e.preventDefault();
    contextLost = true;
    ctx = null;
    onLostCallback?.();
  });
  canvas.addEventListener("webglcontextrestored", () => {
    contextLost = false;
  });

  const vs = compile(gl, gl.VERTEX_SHADER, VERT);
  const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
  if (!vs || !fs) return null;
  const program = gl.createProgram();
  if (!program) return null;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;

  const u = (n: string) => gl.getUniformLocation(program, n);
  ctx = {
    canvas,
    gl,
    program,
    loc: {
      uTranslate: u("uTranslate"),
      uRotate: u("uRotate"),
      uScale: u("uScale"),
      uFit: u("uFit"),
      uZRef: u("uZRef"),
      uCamDistance: u("uCamDistance"),
      uColorTop: u("uColorTop"),
      uColorMid: u("uColorMid"),
      uColorBottom: u("uColorBottom"),
      uHeightRange: u("uHeightRange"),
    },
    attr: {
      pos: gl.getAttribLocation(program, "aPos"),
      normal: gl.getAttribLocation(program, "aNormal"),
    },
    buffers: new Map(),
  };
  return ctx;
}

function uploadPart(c: Ctx, part: ShellPart) {
  const cached = c.buffers.get(part.name);
  if (cached) return cached;
  const { gl } = c;
  const pos = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, pos);
  gl.bufferData(gl.ARRAY_BUFFER, part.positions, gl.STATIC_DRAW);
  const normal = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, normal);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    part.normals.length ? part.normals : new Float32Array(part.positions.length),
    gl.STATIC_DRAW,
  );
  const index = gl.createBuffer()!;
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, index);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, part.indices, gl.STATIC_DRAW);
  const entry = { pos, normal, index, count: part.indices.length };
  c.buffers.set(part.name, entry);
  return entry;
}

function drawPart(
  c: Ctx,
  part: ShellPart,
  f: NonNullable<ReturnType<typeof fit>>,
  colors: [number[], number[], number[]],
) {
  const { gl } = c;
  const bufs = uploadPart(c, part);
  gl.bindBuffer(gl.ARRAY_BUFFER, bufs.pos);
  gl.enableVertexAttribArray(c.attr.pos);
  gl.vertexAttribPointer(c.attr.pos, 3, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, bufs.normal);
  gl.enableVertexAttribArray(c.attr.normal);
  gl.vertexAttribPointer(c.attr.normal, 3, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, bufs.index);

  gl.uniform3fv(c.loc.uTranslate!, part.translation);
  gl.uniform4fv(c.loc.uRotate!, part.rotation);
  gl.uniform3fv(c.loc.uScale!, part.scale);
  gl.uniform4f(c.loc.uFit!, f.sx, f.sy, f.cx, f.cy);
  gl.uniform1f(c.loc.uZRef!, f.zRef);
  gl.uniform1f(c.loc.uCamDistance!, CAM_DISTANCE);
  gl.uniform3fv(c.loc.uColorTop!, colors[0]);
  gl.uniform3fv(c.loc.uColorMid!, colors[1]);
  gl.uniform3fv(c.loc.uColorBottom!, colors[2]);
  gl.uniform2f(c.loc.uHeightRange!, part.bounds.min[1], part.bounds.max[1]);

  gl.drawElements(gl.TRIANGLES, bufs.count, gl.UNSIGNED_SHORT, 0);
}

function toBlobUrl(canvas: HTMLCanvasElement): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob((blob) => resolve(blob ? URL.createObjectURL(blob) : null), "image/png");
    } catch {
      resolve(null);
    }
  });
}

/**
 * Merender dua lapisan objek (panel belakang dan saku depan) sekali
 * untuk seluruh grid. Mengembalikan null pada kegagalan apa pun —
 * pemanggil lalu tetap memakai gambar diam CSS tanpa pesan error.
 */
export async function renderShellLayers(opts: {
  /** Lebar objek dalam CSS px (lebar `.object`). */
  width: number;
  /** devicePixelRatio; DIJEPIT maksimum 2 di sini. */
  dpr: number;
  colors: ShellColors;
  onContextLost?: () => void;
}): Promise<ShellLayers | null> {
  if (contextLost && recoveryAttempted) return null;
  const f = fit();
  if (!f) return null;
  const c = ensureContext();
  if (!c) return null;
  onLostCallback = opts.onContextLost ?? null;

  const dpr = Math.min(Math.max(opts.dpr || 1, 1), 2);
  const w = Math.max(1, Math.round(opts.width * dpr));
  const h = Math.max(1, Math.round((opts.width * OBJ_H) / OBJ_W) * dpr);

  const { gl } = c;
  c.canvas.width = w;
  c.canvas.height = h;
  gl.viewport(0, 0, w, h);
  gl.useProgram(c.program);
  gl.enable(gl.DEPTH_TEST);
  gl.depthFunc(gl.LEQUAL);
  gl.disable(gl.CULL_FACE); // material GLB doubleSided
  gl.clearColor(0, 0, 0, 0);

  const back = findPart(PART_BACK);
  const front = findPart(PART_FRONT);
  if (!back || !front) return null;

  // Lapisan 1 — panel belakang (di belakang kipas).
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  drawPart(c, back, f, [
    opts.colors.backTop,
    opts.colors.backTop,
    opts.colors.backBottom,
  ]);
  const backUrl = await toBlobUrl(c.canvas);

  // Lapisan 2 — saku depan (di depan kipas, di belakang teks DOM).
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  drawPart(c, front, f, [
    opts.colors.pocketTop,
    opts.colors.pocketMid,
    opts.colors.pocketBottom,
  ]);
  const frontUrl = await toBlobUrl(c.canvas);

  if (!backUrl || !frontUrl) {
    if (backUrl) URL.revokeObjectURL(backUrl);
    if (frontUrl) URL.revokeObjectURL(frontUrl);
    return null;
  }
  if (contextLost) {
    URL.revokeObjectURL(backUrl);
    URL.revokeObjectURL(frontUrl);
    return null;
  }
  return { back: backUrl, front: frontUrl, width: opts.width, dpr };
}

/** Menandai bahwa satu-satunya percobaan pemulihan sudah dipakai. */
export function markRecoveryAttempted() {
  recoveryAttempted = true;
}

export function isContextLost() {
  return contextLost;
}

/** Jumlah context WebGL yang dipegang modul ini (0 atau 1) — untuk uji. */
export function liveContextCount() {
  return ctx ? 1 : 0;
}

/**
 * Menjatuhkan context WebGL dengan cara yang sama seperti driver
 * menjatuhkannya (`WEBGL_lose_context`). Ada semata-mata supaya jalur
 * pemulihan AC 2.9 ("context hilang di tengah jalan") bisa DIUJI
 * sungguhan di browser, bukan hanya dibaca di kode.
 */
export function forceContextLossForTest(): boolean {
  if (!ctx) return false;
  const ext = ctx.gl.getExtension("WEBGL_lose_context");
  if (!ext) return false;
  ext.loseContext();
  return true;
}
