// Story 2.6 — geometri kipas Kartu Project.
//
// Semua angka adalah "piksel desain" pada objek berlebar 330 px; CSS
// mengalikannya dengan `fan-scale` (= lebar objek ÷ 330) lewat satuan
// container query, sehingga satu tabel ini berlaku di semua lebar sel.
//
// Sumber angka: DESIGN.md → components.project-card.fan-rest / fan-open
// ("kartu terselip rapat, rotate ±1°–±8°" / "x ±146 / ±76 / 0 px,
// y −24 / −40 / −48 px, rotate ±14°–±18°") dan mock
// the design mock yang memakai angka yang sama.
// Susunan 1 dan 2 kartu tidak ada di mock (mock hanya 3/4/5) — keduanya
// diturunkan dari pola yang sama dan ditandai di bawah.

export type FanSlot = {
  /** x keadaan diam (px desain, relatif titik tengah objek). */
  x: number;
  /** rotate keadaan diam (derajat). */
  r: number;
  /** x keadaan kipas terbuka. */
  hx: number;
  /** y keadaan kipas terbuka (negatif = naik). */
  hy: number;
  /** rotate keadaan kipas terbuka. */
  hr: number;
};

/** Jumlah `rep-card` maksimum di dalam kipas (AC 2.6 = min(5, jumlah file)). */
export const FAN_MAX = 5;

const FAN_LAYOUTS: Record<number, FanSlot[]> = {
  // [TURUNAN] tidak ada di mock: satu kartu duduk di tengah dan naik lurus.
  1: [{ x: 0, r: 0, hx: 0, hy: -46, hr: 0 }],
  // [TURUNAN] tidak ada di mock: dua kartu, jarak di antara pola 3 dan 4.
  2: [
    { x: -40, r: -5, hx: -80, hy: -26, hr: -12 },
    { x: 40, r: 5, hx: 80, hy: -26, hr: 12 },
  ],
  3: [
    { x: -52, r: -6, hx: -101, hy: -24, hr: -14 },
    { x: 0, r: 0, hx: 0, hy: -46, hr: 0 },
    { x: 52, r: 6, hx: 101, hy: -24, hr: 14 },
  ],
  4: [
    { x: -70, r: -7, hx: -128, hy: -22, hr: -16 },
    { x: -23, r: -2, hx: -45, hy: -42, hr: -6 },
    { x: 23, r: 2, hx: 45, hy: -42, hr: 6 },
    { x: 70, r: 7, hx: 128, hy: -22, hr: 16 },
  ],
  5: [
    { x: -89, r: -8, hx: -146, hy: -24, hr: -18 },
    { x: -45, r: -4, hx: -76, hy: -40, hr: -9 },
    { x: 0, r: -1, hx: 0, hy: -48, hr: 0 },
    { x: 45, r: 4, hx: 76, hy: -40, hr: 9 },
    { x: 89, r: 8, hx: 146, hy: -24, hr: 18 },
  ],
};

/** Stagger buka kipas per kartu (ms) — `{motion.fan-stagger}`. */
export const FAN_STAGGER_MS = [0, 40, 70, 110, 140];

/** Susunan kipas untuk n kartu (1–5); n di luar rentang dijepit. */
export function fanLayout(n: number): FanSlot[] {
  const k = Math.max(1, Math.min(FAN_MAX, Math.floor(n)));
  return FAN_LAYOUTS[k] ?? FAN_LAYOUTS[FAN_MAX];
}

/**
 * Lebar terbesar yang dipakai kipas saat terbuka, dalam piksel desain:
 * |x| terjauh × 2 + lebar kartu, ditambah kelonggaran rotasi ±18°.
 * Dipakai `fan-mobile` (DESIGN.md: "skala = min(1, lebar sel ÷ 485)").
 */
export const FAN_OPEN_WIDTH = 485;
