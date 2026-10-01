/**
 * Pipeline job kinds (Stories 4.4, 5.1). A kind is `<namespace>/<name>`,
 * lowercase. The built-in kinds are seeded by migration 0007; a worker that
 * registers a new kind adds it to `pipeline_kinds`, and only kinds present
 * there can be enqueued (`KIND_UNKNOWN` otherwise).
 *
 *   shotstash/proxy-720p    720p H.264/AAC MP4 proxy of a video (the
 *                           reference worker in `worker/`)
 *   shotstash/heic-to-jpeg  full-resolution JPEG of a HEIC original (no
 *                           worker ships for it yet; the upload already
 *                           stores a 2048 px `preview` version itself)
 *
 * Kept free of path aliases so tests can import it directly.
 */
export const PIPELINE_KIND_PROXY_720P = 'shotstash/proxy-720p';
export const PIPELINE_KIND_HEIC_TO_JPEG = 'shotstash/heic-to-jpeg';

export const PIPELINE_KINDS = [PIPELINE_KIND_PROXY_720P, PIPELINE_KIND_HEIC_TO_JPEG] as const;

export type BuiltInKind = (typeof PIPELINE_KINDS)[number];

/** `<namespace>/<name>`: lowercase letters, digits, dot, dash and underscore, 64 characters each at most. */
export const KIND_RE = /^[a-z0-9][a-z0-9._-]{0,63}\/[a-z0-9][a-z0-9._-]{0,63}$/;

export function isKindName(value: unknown): value is string {
  return typeof value === 'string' && KIND_RE.test(value);
}

export function isBuiltInKind(value: string): value is BuiltInKind {
  return (PIPELINE_KINDS as readonly string[]).includes(value);
}
