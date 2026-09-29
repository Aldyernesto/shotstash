/**
 * Pipeline job kinds (Epic 5). Only registered here so far: the worker,
 * queue and job table arrive with Epic 5.
 *
 *   heic-to-jpeg  full-resolution JPEG of a HEIC original, stored as a
 *                 processed version (the original stays untouched). The
 *                 upload already makes a 2048 px `preview` version itself.
 *
 * Kept free of path aliases so tests can import it directly.
 */
export const PIPELINE_KINDS = ['heic-to-jpeg'] as const;

export type PipelineKind = (typeof PIPELINE_KINDS)[number];

export const PIPELINE_KIND_HEIC_TO_JPEG: PipelineKind = 'heic-to-jpeg';

export function isPipelineKind(value: string): value is PipelineKind {
  return (PIPELINE_KINDS as readonly string[]).includes(value);
}
