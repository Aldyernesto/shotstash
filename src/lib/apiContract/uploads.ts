/**
 * Story 7.3: shapes of the upload part route and the cover upload.
 * Type-only and alias-free (see `common.ts`).
 */

/** Path parameters of `/api/v1/uploads/:sessionId/parts/:partNumber`. */
export type UploadPartPathParams = {
  /** Upload session id (UUID) from the `initiateUpload` mutation. */
  sessionId: string;
  /** Part number, from 1 to the session's `partCount`. */
  partNumber: string;
};

/** Headers of an upload part (`_` in a name stands for `-`; see scripts/gen-openapi.mjs). */
export type UploadPartHeaders = {
  /** Base64 MD5 of the part body (RFC 1864); the server checks it. */
  Content_MD5: string;
};

/** A stored part. */
export type UploadPartResponse = {
  /** The part that was stored. */
  partNumber: number;
  /** Bytes stored for this part. */
  size: number;
  /** How many parts of the session are stored so far (a count, not a list). */
  confirmedParts: number;
  /** Parts the session needs in total. */
  partCount: number;
};

/** Multipart form of a cover or avatar upload. */
export type CoverUploadForm = {
  /** `project` (a project cover, needs `section.create`) or `user` (your own avatar). */
  kind?: 'project' | 'user';
  /** The image, at most 10 MiB; re-encoded to JPEG. */
  file: string;
};

/** A stored cover. */
export type CoverResponse = {
  /** Relative cookie-authorised URL, `/media/c/<kind>/<id>?v=<n>`. */
  url: string;
  /** Cover id (UUID). */
  id: string;
};
