/**
 * Story 7.3: shapes shared by the REST routes, named by their OpenAPI
 * annotations (`@response`, `@body`, `@params`). Type-only and alias-free so
 * `next-openapi-gen` resolves them into real schemas (`npm run openapi`).
 *
 * Every property carries its own doc comment: the generator takes a
 * property's description from the nearest comment, so an undocumented
 * property would borrow the next one's.
 */

/** Error answer of every route: a stable code, a readable message and optional details. */
export type ErrorBody = {
  /** Stable machine-readable code, such as `NOT_FOUND` or `RATE_LIMITED`. */
  code: string;
  /** Human-readable English message; never shown as is to end users. */
  message: string;
  /** The input field the error is about, when there is one. */
  field?: string;
  /** Seconds to wait before trying again (429 answers only; also in `Retry-After`). */
  retryAfter?: number;
  /** Extra machine-readable details for some codes. */
  details?: Record<string, unknown>;
};

/** A plain acknowledgement. */
export type OkResponse = {
  /** Always true. */
  ok: true;
};

/** Raw bytes of a stored file, with the file's own media type. Range requests answer 206 with one byte range. */
export type MediaBytes = string;

/** A JPEG thumbnail or cover image. */
export type JpegImage = string;

/** A ZIP archive streamed without compression (STORE), ZIP64 when needed. */
export type ZipArchive = string;

/** Raw request bytes (the upload part or worker output), streamed. */
export type BinaryBody = string;

/** No body (204, 416 and HEAD answers). */
export type NoBody = null;
