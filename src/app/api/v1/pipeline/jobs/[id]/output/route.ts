/**
 * Job output (Story 5.2): `PUT /api/v1/pipeline/jobs/:id/output`.
 *
 * One output per job, sent as the raw request body (not multipart, so the
 * app never buffers it) with `Content-Type` and `X-Output-Ext`. Stored
 * through the storage backend; a second upload by the same claim replaces
 * the first. It becomes a processed version only on `complete`.
 *
 *   200 OutputResponse
 *   400 INVALID_OUTPUT | CLAIM_TOKEN_REQUIRED   401 UNAUTHENTICATED   404 JOB_NOT_FOUND
 *   409 CLAIM_STALE | JOB_TERMINAL   413 OUTPUT_TOO_LARGE   503 STORAGE_UNAVAILABLE
 */
import { Readable } from 'stream';
import { NextResponse } from 'next/server';
import { defineRoute } from '@/lib/defineRoute';
import { CLAIM_TOKEN_HEADER, OUTPUT_EXT_HEADER } from '@/lib/pipelineContract';
import { pipelineErrorResponse, storeOutput } from '@/modules/pipeline';

export const dynamic = 'force-dynamic';

/**
 * Upload the job output
 * @description The raw bytes of the one output, streamed. Content-Type is its media type (video/mp4) and X-Output-Ext its extension (mp4). The size limit is SHOTSTASH_PIPELINE_MAX_OUTPUT_MB.
 * @tag Pipeline
 * @auth apikey
 * @pathParams JobPathParams
 * @body Blob
 * @response 200:OutputResponse
 * @openapi
 */
export const PUT = defineRoute<{ id: string }>({
  auth: 'worker',
  action: 'claim holder',
  handler: async ({ req, worker, params }) => {
    const lengthHeader = req.headers.get('content-length');
    const contentLength = lengthHeader !== null && /^\d+$/.test(lengthHeader) ? Number(lengthHeader) : null;
    const body = req.body ? Readable.fromWeb(req.body as never) : Readable.from([]);
    try {
      const result = await storeOutput(worker!, params.id, req.headers.get(CLAIM_TOKEN_HEADER), {
        body,
        contentType: req.headers.get('content-type'),
        ext: req.headers.get(OUTPUT_EXT_HEADER),
        contentLength,
      });
      return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
    } catch (err) {
      body.destroy();
      const refused = pipelineErrorResponse(err);
      if (refused) return refused;
      throw err;
    }
  },
});
