/**
 * Story 4.3: the byte side of an upload in the browser. Parts go to
 * `PUT /api/v1/uploads/:sessionId/parts/:n` with a Content-MD5 header; the
 * whole-file MD5 is computed with hash-wasm while the parts are read, in
 * order. Pure browser code, no React.
 */
import { createMD5, md5 } from "hash-wasm";
import type { ResumeEntry } from "./uploadTypes";

/** A failed HTTP answer as an error that carries its REST body `{ code, ... }` and status. */
export function httpError(status: number, body: unknown): Error {
  const fields = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const code = typeof fields.code === "string" ? fields.code : undefined;
  return Object.assign(new Error(code ?? `HTTP ${status}`), { status, body: fields, ...(code ? { code } : {}) });
}

export function hexToBase64(hex: string): string {
  let bin = "";
  for (let i = 0; i < hex.length; i += 2) bin += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
  return btoa(bin);
}

/** MD5 (hex) of bytes. */
export function md5Of(bytes: Uint8Array): Promise<string> {
  return md5(bytes);
}

/** An incremental MD5 fed in file order. */
export async function wholeFileHasher() {
  const h = await createMD5();
  h.init();
  return {
    update: (bytes: Uint8Array) => h.update(bytes),
    hex: () => h.digest("hex"),
  };
}

const HASH_SLICE = 8 * 1024 * 1024;

/** MD5 (hex) of a whole file, read in 8 MiB slices; `onProgress` gets 0-1. */
export async function hashFile(file: File, onProgress?: (fraction: number) => void, signal?: AbortSignal): Promise<string> {
  const h = await wholeFileHasher();
  for (let start = 0; start < file.size; start += HASH_SLICE) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const bytes = new Uint8Array(await file.slice(start, Math.min(start + HASH_SLICE, file.size)).arrayBuffer());
    h.update(bytes);
    onProgress?.(Math.min(1, (start + bytes.length) / Math.max(1, file.size)));
  }
  return h.hex();
}

/**
 * Sends one part. Resolves with the parsed body on 2xx; rejects with an
 * `httpError` (status + body code) or a TypeError for network failures.
 * `onProgress` receives the bytes sent so far.
 */
export function putPart(input: {
  sessionId: string;
  partNumber: number;
  bytes: Uint8Array;
  md5Hex: string;
  token: string | null;
  onProgress?: (loaded: number) => void;
  signal?: AbortSignal;
}): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", `/api/v1/uploads/${encodeURIComponent(input.sessionId)}/parts/${input.partNumber}`);
    if (input.token) xhr.setRequestHeader("Authorization", `Bearer ${input.token}`);
    xhr.setRequestHeader("Content-MD5", hexToBase64(input.md5Hex));
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.upload.onprogress = (e) => input.onProgress?.(e.loaded);
    const onAbort = () => xhr.abort();
    input.signal?.addEventListener("abort", onAbort, { once: true });
    xhr.onload = () => {
      input.signal?.removeEventListener("abort", onAbort);
      let body: unknown = null;
      try {
        body = xhr.responseText ? JSON.parse(xhr.responseText) : null;
      } catch {
        body = null;
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(body);
      else {
        const err = httpError(xhr.status, body);
        const retryAfter = Number(xhr.getResponseHeader("Retry-After"));
        if (Number.isFinite(retryAfter) && retryAfter > 0) Object.assign(err, { retryAfter });
        reject(err);
      }
    };
    xhr.onerror = () => {
      input.signal?.removeEventListener("abort", onAbort);
      reject(new TypeError("Network error"));
    };
    xhr.ontimeout = xhr.onerror;
    xhr.onabort = () => {
      input.signal?.removeEventListener("abort", onAbort);
      reject(new DOMException("Aborted", "AbortError"));
    };
    xhr.send(input.bytes as unknown as XMLHttpRequestBodyInit);
  });
}

/** Waits `ms`, or rejects early when `signal` aborts. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException("Aborted", "AbortError"));
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/* ------------------------------------------------------------------ */
/* Resume entries (localStorage)                                       */
/* ------------------------------------------------------------------ */

/** One list per account: a shared browser never offers one user's uploads to another. */
const resumeKey = (userId: string) => `shotstash_uploads:${userId}`;

export function readResumeEntries(userId: string): ResumeEntry[] {
  try {
    const raw = localStorage.getItem(resumeKey(userId));
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list)
      ? (list.filter(
          (e) => e && typeof e.sessionId === "string" && typeof e.name === "string" && typeof e.size === "number",
        ) as ResumeEntry[])
      : [];
  } catch {
    return [];
  }
}

function writeResumeEntries(userId: string, list: ResumeEntry[]) {
  try {
    if (list.length) localStorage.setItem(resumeKey(userId), JSON.stringify(list.slice(-200)));
    else localStorage.removeItem(resumeKey(userId));
  } catch {
    /* storage unavailable (private mode): resume is best effort */
  }
}

export function rememberUpload(userId: string, entry: ResumeEntry) {
  writeResumeEntries(userId, [...readResumeEntries(userId).filter((e) => e.sessionId !== entry.sessionId), entry]);
}

export function forgetUpload(userId: string, sessionId: string) {
  writeResumeEntries(userId, readResumeEntries(userId).filter((e) => e.sessionId !== sessionId));
}
