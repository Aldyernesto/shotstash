"use client";

/**
 * Story 2.9 — gerbang + toko bersama untuk objek 3D Kartu Project.
 *
 * Tugas berkas ini persis tiga hal:
 *   1. MENAHAN `import()` modul renderer sampai Kartu Project pertama
 *      benar-benar masuk layar (IntersectionObserver). Sebelum itu,
 *      `/dashboard` tidak mengunduh renderer maupun geometri GLB-nya.
 *   2. MENOLAK 3D sama sekali bila mode kalem aktif (prefers-reduced-
 *      motion / Save-Data / deviceMemory <= 2) atau WebGL tidak tersedia.
 *      Di kedua keadaan itu modul renderer tidak pernah diunduh.
 *   3. MEMBAGI satu hasil render ke SEMUA kartu. Setiap kartu di grid
 *      adalah objek yang sama pada lebar yang sama, jadi satu render
 *      cukup — tidak ada context, canvas, atau loop gambar per kartu.
 *
 * Setiap kegagalan (WebGL hilang, context lost, shader gagal, modul
 * gagal dimuat) mengembalikan `null` dan kartu tetap memakai lapisan
 * gambar diam CSS dari Story 2.6 — tanpa layar kosong, tanpa kartu yang
 * menghilang, dan tanpa pesan error yang terlihat pengguna.
 */

import React from "react";

export type ShellLayerUrls = { back: string; front: string } | null;

type RendererModule = typeof import("./renderer");

type State = {
  layers: ShellLayerUrls;
  width: number;
  dpr: number;
};

let state: State = { layers: null, width: 0, dpr: 0 };
const listeners = new Set<() => void>();
let loadStarted = false;
let disabled = false;
let mod: RendererModule | null = null;
let pending = false;
let recoveryUsed = false;
let lastFailure: string | null = null;

function emit() {
  for (const l of listeners) l();
}

function revoke(layers: ShellLayerUrls) {
  if (!layers) return;
  try {
    URL.revokeObjectURL(layers.back);
    URL.revokeObjectURL(layers.front);
  } catch {
    /* tidak ada yang perlu dilaporkan ke pengguna */
  }
}

/** Mode kalem = jalur gambar diam, dan modul 3D tidak pernah diunduh. */
function isCalm(): boolean {
  if (typeof document === "undefined") return true;
  return document.documentElement.dataset.motion === "calm";
}

function readColor(name: string): [number, number, number] {
  const fallback: [number, number, number] = [0.1, 0.1, 0.1];
  if (typeof getComputedStyle === "undefined") return fallback;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const m = /^#([0-9a-f]{6})$/i.exec(raw);
  if (!m) return fallback;
  const n = parseInt(m[1], 16);
  // sRGB -> linear kira-kira (gamma 2.2) supaya permukaan datar mendarat
  // di warna token setelah shading.
  const lin = (v: number) => Math.pow(v / 255, 2.2);
  return [lin((n >> 16) & 255), lin((n >> 8) & 255), lin(n & 255)];
}

function currentColors() {
  return {
    backTop: readColor("--app-spine-object-back-top"),
    backBottom: readColor("--app-spine-object-back-bottom"),
    pocketTop: readColor("--app-spine-pocket-top"),
    pocketMid: readColor("--app-spine-pocket-mid"),
    pocketBottom: readColor("--app-spine-pocket-bottom"),
  };
}

function handleContextLost() {
  // Seluruh grid berpindah ke gambar diam dalam frame yang sama.
  revoke(state.layers);
  state = { layers: null, width: 0, dpr: 0 };
  if (recoveryUsed) {
    disabled = true;
  } else {
    // Percobaan pemulihan dilakukan PALING BANYAK SEKALI.
    recoveryUsed = true;
    mod?.markRecoveryAttempted?.();
    disabled = true;
  }
  emit();
}

async function ensureLayers(width: number) {
  if (disabled || pending) return;
  const dpr = Math.min(typeof devicePixelRatio === "number" ? devicePixelRatio : 1, 2);
  const w = Math.round(width);
  if (w <= 0) return;
  if (state.layers && state.width === w && state.dpr === dpr) return;
  pending = true;
  try {
    if (!mod) {
      // Satu-satunya tempat modul renderer + geometri GLB diunduh.
      mod = await import("./renderer");
      if (!mod.isWebglAvailable()) {
        lastFailure = "webgl-unavailable";
        disabled = true;
        return;
      }
    }
    const next = await mod.renderShellLayers({
      width: w,
      dpr,
      colors: currentColors(),
      onContextLost: handleContextLost,
    });
    if (!next) {
      // GLB/shader/context gagal: diam-diam tetap di gambar diam.
      lastFailure = "render-null";
      disabled = true;
      return;
    }
    revoke(state.layers);
    state = { layers: { back: next.back, front: next.front }, width: w, dpr };
    emit();
  } catch (e) {
    // Modul gagal dimuat (jaringan, chunk hilang): gambar diam, senyap.
    lastFailure = String((e as Error)?.message ?? e);
    disabled = true;
  } finally {
    pending = false;
    if (disabled && state.layers) {
      revoke(state.layers);
      state = { layers: null, width: 0, dpr: 0 };
      emit();
    }
  }
}

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};
const getSnapshot = () => state.layers;
const getServerSnapshot = () => null;

/**
 * Dipakai `ProjectCard`. Mengembalikan URL dua lapisan objek 3D, atau
 * `null` selama objek belum siap / tidak dipakai — saat `null` kartu
 * merender lapisan CSS Story 2.6 apa adanya.
 */
export function useShellLayers(objectRef: React.RefObject<HTMLElement | null>): ShellLayerUrls {
  const layers = React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  React.useEffect(() => {
    const el = objectRef.current;
    if (!el || typeof window === "undefined") return;
    if (disabled) return;
    // Mode kalem: modul renderer dan GLB TIDAK diunduh sama sekali.
    if (isCalm()) return;
    if (typeof IntersectionObserver === "undefined") return;

    let ro: ResizeObserver | null = null;
    let timer = 0;

    // Kait verifikasi manual (AC 2.9 menuntut jalur ini bisa diperiksa
    // ulang). `state()` membaca keadaan gerbang; `render(w)` menjalankan
    // langkah yang sama dengan yang dipicu IntersectionObserver — berguna
    // di lingkungan uji tempat dokumen berstatus `hidden`, karena Chrome
    // TIDAK mengirim callback IntersectionObserver untuk dokumen tersembunyi.
    (window as unknown as Record<string, unknown>).__mamShell3d = {
      state: shell3dDebug,
      render: (w: number) => ensureLayers(w),
      loseContext: () => mod?.forceContextLossForTest?.() ?? false,
    };

    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        loadStarted = true;
        void ensureLayers(el.getBoundingClientRect().width);
        // Lebar sel berubah (resize / ganti breakpoint) -> render ulang
        // sekali, ditunda, untuk SELURUH grid.
        if (typeof ResizeObserver !== "undefined") {
          ro = new ResizeObserver(() => {
            window.clearTimeout(timer);
            timer = window.setTimeout(() => {
              void ensureLayers(el.getBoundingClientRect().width);
            }, 250);
          });
          ro.observe(el);
        }
      },
      { rootMargin: "120px" },
    );
    io.observe(el);

    return () => {
      io.disconnect();
      ro?.disconnect();
      window.clearTimeout(timer);
    };
  }, [objectRef]);

  return layers;
}

/** Hanya untuk verifikasi manual di konsol. */
export function shell3dDebug() {
  return {
    loadStarted,
    disabled,
    lastFailure,
    hasLayers: !!state.layers,
    width: state.width,
    dpr: state.dpr,
    calm: isCalm(),
  };
}
