/**
 * Stories 3.12-3.15 — bentuk antrean upload dan penerjemahan kegagalan.
 *
 * Dipisah dari komponen supaya `upload-panel`, `upload-row`,
 * `batch-progress`, dan `upload-dock` membaca SATU definisi yang sama.
 * Story 3.14 memindahkan STATE-nya ke `UploadContext`; bentuknya tetap
 * yang ini.
 */

import { errorCodeOf, errorKind } from "../../lib/errorCodes.ts";

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
  /** Why the row failed; rendered from messages. */
  error?: UploadFailure;
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

/**
 * Why an upload could not start or a row failed. The visible sentence comes
 * from messages (`upload.reject.<reason>` for the panel, `upload.rowReason.<reason>`
 * for a row); raw server text is never shown.
 */
export const UPLOAD_REASONS = [
  "session",
  "forbidden",
  "missingFolder",
  "quota",
  "storage",
  "tooLarge",
  "unsupportedType",
  "checksum",
  "offline",
  "generic",
] as const;

export type UploadRejectCode = (typeof UPLOAD_REASONS)[number];

/** A failed row: the reason, plus the server code when there was one. */
export type UploadFailure = { reason: UploadRejectCode; code?: string };

const REASON_BY_CODE: Record<string, UploadRejectCode> = {
  UNAUTHENTICATED: "session",
  FORBIDDEN: "forbidden",
  NOT_FOUND: "missingFolder",
  TOO_LARGE: "tooLarge",
  UNSUPPORTED_TYPE: "unsupportedType",
  FILE_TYPE_NOT_ALLOWED: "unsupportedType",
  STORAGE_UNAVAILABLE: "storage",
  CHECKSUM_MISMATCH: "checksum",
};

/** Reasons for an uncoded HTTP failure (for example a storage-edge PUT). */
const REASON_BY_STATUS: Record<number, UploadRejectCode> = {
  401: "session",
  403: "forbidden",
  404: "missingFolder",
  413: "tooLarge",
  507: "quota",
};

function statusOf(err: unknown): number | null {
  const v = err as { status?: unknown; statusCode?: unknown; networkError?: { statusCode?: unknown } } | null;
  for (const s of [v?.status, v?.statusCode, v?.networkError?.statusCode]) {
    if (typeof s === "number") return s;
  }
  return null;
}

/**
 * Classifies an `initiateUpload` / chunk failure by its structure only
 * (server code, HTTP status, network error), never by message text.
 */
export function classifyUploadError(err: unknown): UploadFailure {
  const code = errorCodeOf(err) ?? undefined;
  if (code && REASON_BY_CODE[code]) return { reason: REASON_BY_CODE[code], code };
  const status = statusOf(err);
  if (!code && status !== null && REASON_BY_STATUS[status]) return { reason: REASON_BY_STATUS[status] };
  const kind = errorKind(err);
  if (kind === "session") return { reason: "session", code };
  if (kind === "forbidden") return { reason: "forbidden", code };
  if (kind === "offline") return { reason: "offline", code };
  if (kind === "notFound") return { reason: "missingFolder", code };
  return { reason: "generic", code };
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
