/**
 * Stories 3.12-3.15 and 4.3: the shape of the upload queue and how failures
 * are classified.
 *
 * Kept apart from the components so `upload-panel`, `upload-row`,
 * `batch-progress` and `upload-dock` read ONE definition. The state lives
 * in `UploadContext`.
 */

import { errorCodeOf, errorKind } from "../../lib/errorCodes.ts";

export type UploadTaskStatus =
  | "pending"
  /** Hashing a same-name, same-size file to ask the server about duplicates. */
  | "checking"
  | "uploading"
  | "merging"
  | "success"
  /** Identical bytes already in the project; the uploader chose Skip. */
  | "skipped"
  /** An unfinished upload from before a reload: waiting for its file. */
  | "paused"
  | "error";

/** An unfinished upload remembered across reloads (localStorage). */
export type ResumeEntry = {
  sessionId: string;
  projectId: string;
  folderId: string;
  folderName: string | null;
  name: string;
  size: number;
  lastModified: number;
};

export type UploadTask = {
  id: string;
  /** Null only for a paused resume row until the user picks the file again. */
  file: File | null;
  /** 0-100, from bytes the server really received. */
  progress: number;
  status: UploadTaskStatus;
  /** Why the row failed; rendered from messages. */
  error?: UploadFailure;
  /** Section tujuan baris ini (sub-Section hasil seret folder). */
  targetFolderId?: string;
  /** Project of this row when it differs from the panel target (resume rows). */
  projectId?: string;
  /** Nama sub-Section baru bila baris ini datang dari folder yang diseret. */
  subSectionName?: string;
  /** Server upload session (set at initiate; kept for retry and resume). */
  sessionId?: string;
  /** Whole-file MD5 (hex), once known. */
  md5?: string;
  /** "Upload anyway" was chosen for identical bytes in the project. */
  allowDuplicate?: boolean;
  /** Name of the identical file already in the project. */
  duplicateOf?: string;
  /** Resume rows: what the file must look like, and how far it got. */
  resume?: ResumeEntry & { confirmed: number; partCount: number };
  /** A retry of a failed part is scheduled (seconds until it runs). */
  retryIn?: number;
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
  "expired",
  "duplicate",
  "rateLimited",
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
  PART_CHECKSUM_MISMATCH: "checksum",
  UPLOAD_SESSION_EXPIRED: "expired",
  UPLOAD_SESSION_CLOSED: "expired",
  UPLOAD_SESSION_NOT_FOUND: "expired",
  DUPLICATE_FILE: "duplicate",
  RATE_LIMITED: "rateLimited",
};

/** Reasons for an uncoded HTTP failure. */
const REASON_BY_STATUS: Record<number, UploadRejectCode> = {
  401: "session",
  403: "forbidden",
  404: "missingFolder",
  410: "expired",
  413: "tooLarge",
  429: "rateLimited",
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
 * Classifies an `initiateUpload` / part / completion failure by its
 * structure only (server code, HTTP status, network error), never by
 * message text.
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

/**
 * Part failures worth another try: the network, a server hiccup, a rate
 * limit or a part damaged on the way. Session, permission and "gone"
 * answers are final.
 */
export function isRetryablePartError(err: unknown): boolean {
  const code = errorCodeOf(err);
  if (code === "PART_CHECKSUM_MISMATCH" || code === "RATE_LIMITED" || code === "STORAGE_UNAVAILABLE") return true;
  if (code && code !== "INTERNAL") return false;
  const status = statusOf(err);
  if (status === null) return true; // network error, timeout, aborted connection
  return status === 408 || status === 429 || status >= 500;
}

/** Exponential backoff with jitter: ~1 s, 2 s, 4 s, 8 s, 16 s (capped at 30 s). */
export function retryDelayMs(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(30_000, 1000 * 2 ** attempt);
  return Math.round(base * (0.5 + random()));
}

/** Retries per part after the first try, before the row fails with a Retry action. */
export const PART_RETRIES = 5;

/** Ringkasan antrean yang dipakai footer, `batch-progress`, dan dock. */
export function summarize(tasks: UploadTask[]) {
  let done = 0;
  let running = 0;
  let waiting = 0;
  let failed = 0;
  let skipped = 0;
  let paused = 0;
  for (const t of tasks) {
    if (t.status === "success") done++;
    else if (t.status === "skipped") skipped++;
    else if (t.status === "uploading" || t.status === "merging" || t.status === "checking") running++;
    else if (t.status === "pending") waiting++;
    else if (t.status === "error") failed++;
    else if (t.status === "paused") paused++;
  }
  return { total: tasks.length - paused, done: done + skipped, uploaded: done, skipped, running, waiting, failed, paused };
}

/** True when `file` is the one a resume entry was started with (name, size, lastModified). */
export function matchesResume(file: File, entry: Pick<ResumeEntry, "name" | "size" | "lastModified">): boolean {
  return file.name === entry.name && file.size === entry.size && file.lastModified === entry.lastModified;
}
