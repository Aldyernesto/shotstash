/**
 * Stories 3.9 / 3.10 / 3.11 — bentuk payload halaman share dan tetapan
 * yang dipakai DUA SISI.
 *
 * Dipisah dari `shareLink.ts` dengan sengaja: berkas itu mengimpor
 * Prisma, dan komponen klien yang mengimpornya akan menyeret klien
 * database ke bundel browser. Di sini tidak ada satu pun impor server.
 */

export type ShareFileKind = "image" | "video" | "audio" | "document";

export type ShareFile = {
  id: string;
  name: string;
  kind: ShareFileKind;
  sizeBytes: number;
  sizeText: string;
  /** Signed `/media/s/<token>` URLs (valid 5 min); re-minted through `POST /s/<slug>/sign`. */
  thumbnailUrl: string | null;
  inlineUrl: string | null;
  downloadUrl: string | null;
  /** Kolom durasi belum ada di skema — selalu null untuk saat ini. */
  duration: string | null;
};

export type ShareSection = {
  id: string;
  /** "25" bila nama berawalan nomor. */
  number: string | null;
  title: string;
  fileCount: number;
  /** Maksimal 3 thumbnail (NFR6). */
  repThumbs: (string | null)[];
};

export type SharePayload = {
  slug: string;
  kind: "project" | "section" | "file";
  /** Headline — awalan nomor sudah dibuang. */
  title: string;
  number: string | null;
  projectId: string;
  /** Varian Section: id folder yang dibagikan. */
  folderId: string | null;
  /** Signed URL of the ZIP for the whole payload (valid 24 h), null when nothing can be signed. */
  zipUrl: string | null;
  projectName: string | null;
  /** File variant: the parent Section for the kicker (number and title). */
  sectionLabel: { number: string | null; title: string } | null;
  fileCount: number;
  sectionCount: number | null;
  totalSizeText: string;
  dateText: string;
  /** Counts per kind for "Contains 60 photos, 12 videos and 2 documents."; null when empty. */
  breakdown: { photos: number; videos: number; documents: number } | null;
  expiresAt: string | null;
  /** 1-3 thumbnail Kartu perwakilan panggung. */
  stageThumbs: (string | null)[];
  /** Halaman pertama grid file — varian Section & drill-in. */
  files: ShareFile[];
  /** Varian Project: hanya Section YANG IKUT DIBAGIKAN. */
  sections: ShareSection[];
  /** Varian file tunggal. */
  single: ShareFile | null;
  /** Drill-in aktif (varian Project). */
  section: { id: string; number: string | null; title: string; fileCount: number } | null;
};

export type ShareResolution =
  | { state: "expired" }
  | { state: "revoked" }
  | { state: "gone"; target: "project" | "section" | "file" }
  | { state: "not-found" }
  | { state: "private" }
  | { state: "ok"; payload: SharePayload };

/** Jumlah baris per halaman grid ([ASSUMPTION] EXPERIENCE.md). */
export const SHARE_PAGE_SIZE = 12;

/** Share page sort ids (the public `?sort=` contract), sorted on the server so paging stays right. */
export type ShareSort = "date" | "name" | "size" | "type" | "number" | "count";

export const FILE_SORTS: ShareSort[] = ["name", "date", "size", "type"];
export const SECTION_SORTS: ShareSort[] = ["number", "name", "count"];

/** Sort ids of earlier releases, still accepted in `?sort=` links. */
const LEGACY_SORTS: Record<string, ShareSort> = {
  tanggal: "date", // i18n-ignore: old URL id
  nama: "name", // i18n-ignore: old URL id
  ukuran: "size", // i18n-ignore: old URL id
  tipe: "type", // i18n-ignore: old URL id
  nomor: "number", // i18n-ignore: old URL id
  jumlah: "count", // i18n-ignore: old URL id
};

/** A `?sort=` value as a sort id: current ids pass, old ids map to their new name, anything else is null. */
export function normalizeShareSort(raw: string | null | undefined): ShareSort | null {
  if (!raw) return null;
  if ((FILE_SORTS as string[]).includes(raw) || (SECTION_SORTS as string[]).includes(raw)) return raw as ShareSort;
  return Object.prototype.hasOwnProperty.call(LEGACY_SORTS, raw) ? LEGACY_SORTS[raw] : null;
}
