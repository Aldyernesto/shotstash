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
  /** Varian file: nama Section induk untuk kicker. */
  sectionLabel: string | null;
  fileCount: number;
  sectionCount: number | null;
  totalSizeText: string;
  dateText: string;
  /** "Berisi 60 foto, 12 video, dan 2 dokumen." */
  breakdown: string | null;
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
  | { state: "gone"; target: "project" | "section" | "file" }
  | { state: "not-found" }
  | { state: "private" }
  | { state: "ok"; payload: SharePayload };

/** Jumlah baris per halaman grid ([ASSUMPTION] EXPERIENCE.md). */
export const SHARE_PAGE_SIZE = 12;

/** `sort-pills` halaman share — diurutkan DI SERVER supaya paging benar. */
export type ShareSort = "tanggal" | "nama" | "ukuran" | "tipe" | "nomor" | "jumlah";

export const FILE_SORTS: ShareSort[] = ["nama", "tanggal", "ukuran", "tipe"];
export const SECTION_SORTS: ShareSort[] = ["nomor", "nama", "jumlah"];

/** Kata jenis manusiawi — BUKAN kolom mime. */
export const KIND_WORD: Record<ShareFileKind, string> = {
  image: "Foto",
  video: "Video",
  audio: "Audio",
  document: "Dokumen",
};
