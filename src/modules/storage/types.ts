/**
 * The storage contract (AD-3). One backend per installation (`local` or
 * `s3`, chosen by `STORAGE_BACKEND`); every byte the app stores or reads for
 * media goes through it, addressed by hierarchy-free keys (keys.ts).
 *
 * Multipart uploads: `beginUpload` returns an opaque upload id; parts are
 * numbered from 1, may arrive in any order and in parallel, and re-sending a
 * part replaces it. `completeUpload` assembles the listed parts in order at
 * the key given to `beginUpload`; `abortUpload` drops everything staged.
 */
import type { Readable } from 'node:stream';

export type BackendName = 'local' | 's3';

/** Inclusive byte range, as in HTTP `Range: bytes=start-end`. */
export type ByteRange = { start: number; end: number };

export type StoredPart = { partNumber: number; etag: string; size: number };

export type ObjectStat = { size: number; modifiedAt: Date | null };

export type ProbeResult = { ok: true } | { ok: false; reason: string };

export type Capacity = { total: number; free: number };

export interface StorageBackend {
  readonly name: BackendName;

  /** Starts a multipart upload that will land at `key`. Returns the upload id. */
  beginUpload(key: string): Promise<string>;
  /**
   * Stores part `partNumber` (1-based) of `size` bytes from `body`. With
   * `md5` (hex) the part is refused with `CHECKSUM_MISMATCH` unless the
   * bytes match; a body shorter or longer than `size` is refused with
   * `PART_SIZE_MISMATCH`. Idempotent per part number.
   */
  putPart(uploadId: string, partNumber: number, body: Readable, size: number, opts?: { md5?: string }): Promise<StoredPart>;
  /** Assembles `parts` (in part-number order). `md5` is set when the backend hashed while assembling. */
  completeUpload(uploadId: string, parts: StoredPart[]): Promise<{ size: number; md5?: string }>;
  /** Drops a staged upload; unknown ids are ignored. */
  abortUpload(uploadId: string): Promise<void>;

  /** Writes `body` at `key` (atomically: readers see the old object or the new one). */
  putStream(key: string, body: Readable, opts?: { contentType?: string; size?: number }): Promise<{ size: number }>;
  /** Reads `key`, whole or one inclusive range. Missing key: `NOT_FOUND`. */
  getStream(key: string, range?: ByteRange): Promise<Readable>;
  /** Deletes `key`; a missing key is not an error. */
  delete(key: string): Promise<void>;
  /** Size of `key`. Missing key: `NOT_FOUND`. */
  stat(key: string): Promise<ObjectStat>;
  exists(key: string): Promise<boolean>;

  /* ---------- module-internal helpers ---------- */

  /** Server-side copy of `from` to `to`. */
  copy(from: string, to: string): Promise<void>;
  /** Copy then delete (a rename on the local disk). */
  move(from: string, to: string): Promise<void>;
  /**
   * `read`: the backend answers (local: root readable, writable and marked
   * as the storage root; S3: bucket reachable). With `init` a local root
   * without its marker is initialised (first-run setup only).
   * `write`: an object can be written, read back and deleted.
   */
  probe(mode: 'read' | 'write', opts?: { init?: boolean }): Promise<ProbeResult>;
  /**
   * Runs `fn` with an input ffmpeg can open: a local path, or a presigned
   * URL for S3 valid `ttlSeconds` (default 1 h). The URL never leaves the
   * server and is never logged.
   */
  withLocalInput<T>(key: string, fn: (input: string) => Promise<T>, opts?: { ttlSeconds?: number }): Promise<T>;
  /** Disk size and free space, when the backend can tell (local disk only). */
  capacity(): Promise<Capacity | null>;
  /**
   * Removes staging leftovers older than `before` that no live upload in
   * `live` references (local: `.tmp/` files and `.parts/` directories; S3
   * relies on the bucket's AbortIncompleteMultipartUpload rule). Answers the count.
   */
  sweepStaging(before: Date, live: Set<string>): Promise<number>;
}
