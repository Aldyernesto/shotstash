/**
 * Stories 3.12-3.15 — bentuk antrean upload dan penerjemahan kegagalan.
 *
 * Dipisah dari komponen supaya `upload-panel`, `upload-row`,
 * `batch-progress`, dan `upload-dock` membaca SATU definisi yang sama.
 * Story 3.14 memindahkan STATE-nya ke `UploadContext`; bentuknya tetap
 * yang ini.
 */

export type UploadTaskStatus =
  | "pending"
  | "uploading"
  | "merging"
  | "success"
  | "error";

export type UploadTask = {
  id: string;
  file: File;
  /** 0-100, dari potongan yang BENAR-BENAR terkirim. */
  progress: number;
  status: UploadTaskStatus;
  /** Sebab kegagalan dalam KALIMAT Bahasa Indonesia. */
  error?: string;
  /** Section tujuan baris ini (sub-Section hasil seret folder). */
  targetFolderId?: string;
  /** Nama sub-Section baru bila baris ini datang dari folder yang diseret. */
  subSectionName?: string;
};

export type UploadBatchState = {
  tasks: UploadTask[];
  /** Section tujuan batch. */
  targetFolderId: string | null;
  targetFolderName: string | null;
  projectId: string | null;
  running: boolean;
  /** Batch berhenti karena sesi tidak lagi valid. */
  aborted: boolean;
};

/** Kalimat penolakan `initiateUpload`, bukan teks mentah server. */
export const UPLOAD_REJECT: Record<string, string> = {
  session: "Sesi kamu sudah berakhir. Masuk lagi lalu ulangi upload.",
  forbidden: "Kamu tidak punya izin mengunggah ke Section ini.",
  missingFolder: "Section tujuan sudah tidak ada. Pilih Section lain.",
  quota: "Penyimpanan penuh. Hubungi admin Shotstash.",
  offline: "Kamu sedang offline. Sambungkan internet lalu tekan Upload lagi.",
  generic: "Upload tidak bisa dimulai. Coba lagi sebentar lagi.",
};

export type UploadRejectCode = keyof typeof UPLOAD_REJECT;

/**
 * Menerjemahkan kegagalan `initiateUpload` / potongan menjadi SATU kode
 * yang punya kalimat Indonesia. "Unauthorized", "Forbidden: ADMIN or
 * FIELD_CREW only", dan "HTTP 502" tidak pernah tampil apa adanya.
 */
export function classifyUploadError(err: unknown): UploadRejectCode {
  const raw = String(
    (err as { message?: string } | null | undefined)?.message ?? err ?? "",
  ).toLowerCase();
  if (raw.includes("unauthorized") || raw.includes("401") || raw.includes("session")) return "session";
  if (raw.includes("forbidden") || raw.includes("403") || raw.includes("permission")) return "forbidden";
  if (raw.includes("folder not found") || raw.includes("section") || raw.includes("404")) return "missingFolder";
  if (raw.includes("quota") || raw.includes("storage full") || raw.includes("enospc") || raw.includes("507")) {
    return "quota";
  }
  if (raw.includes("failed to fetch") || raw.includes("networkerror") || raw.includes("network error")) {
    return "offline";
  }
  return "generic";
}

/** Kalimat sebab untuk BARIS yang gagal ("Gagal — {sebab}"). */
export function humanizeTaskError(err: unknown): string {
  const code = classifyUploadError(err);
  if (code === "offline") return "koneksi terputus setelah 3 kali coba";
  if (code === "session") return "sesi kamu sudah berakhir";
  if (code === "forbidden") return "kamu tidak punya izin ke Section ini";
  if (code === "missingFolder") return "Section tujuan sudah tidak ada";
  if (code === "quota") return "penyimpanan penuh";
  return "server menolak potongan terakhir";
}

/** Ringkasan antrean yang dipakai footer, `batch-progress`, dan dock. */
export function summarize(tasks: UploadTask[]) {
  let done = 0;
  let running = 0;
  let waiting = 0;
  let failed = 0;
  for (const t of tasks) {
    if (t.status === "success") done++;
    else if (t.status === "uploading" || t.status === "merging") running++;
    else if (t.status === "pending") waiting++;
    else if (t.status === "error") failed++;
  }
  return { total: tasks.length, done, running, waiting, failed };
}
