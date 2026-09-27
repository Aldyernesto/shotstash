// Story 2.4 (sisi klien): merakit kalimat ringkasan isi dari ANGKA MENTAH
// `contentSummary` GraphQL. Server sengaja hanya mengirim angka per ember —
// urutan kata dan formatnya milik klien (AC 2.4), jadi satu modul ini yang
// memegangnya supaya sub-judul page-head (Story 2.5), kontrak a11y Kartu
// Project (Story 2.6), dan kolom "Isi" mode daftar memakai kalimat yang
// sama persis. Angka memakai format Indonesia titik-ribuan dari Epic 1.

import { formatNumber } from "./format";

export type ContentSummary = {
  photos?: number | null;
  videos?: number | null;
  documents?: number | null;
  total?: number | null;
};

const BUCKETS = [
  ["photos", "foto"],
  ["videos", "video"],
  ["documents", "dokumen"],
] as const;

/**
 * Potongan "{n} {jenis}". Ember berjumlah 0 TIDAK pernah ditulis
 * ("Berisi 18 dokumen · 7 video", bukan "… · 0 foto").
 * @param largestFirst true = urut dari jumlah terbesar (kalimat kartu);
 *   false = urutan tetap foto → video → dokumen (sub-judul page-head).
 */
export function contentSummaryParts(
  summary?: ContentSummary | null,
  largestFirst = false,
): string[] {
  if (!summary) return [];
  const rows = BUCKETS.map(([key, label]) => ({
    n: Number(summary[key] ?? 0) || 0,
    label,
  })).filter((row) => row.n > 0);
  if (largestFirst) rows.sort((a, b) => b.n - a.n);
  return rows.map((row) => `${formatNumber(row.n)} ${row.label}`);
}

/**
 * Kalimat ringkasan isi untuk nama/deskripsi aksesibel kartu:
 * "Berisi 1.900 video · 650 foto · 50 dokumen" (terbesar dulu).
 * Isi kosong / field gagal dimuat → "" (pemanggil tidak merender apa pun).
 */
export function describeContentSummary(summary?: ContentSummary | null): string {
  const parts = contentSummaryParts(summary, true);
  return parts.length ? `Berisi ${parts.join(" · ")}` : "";
}
