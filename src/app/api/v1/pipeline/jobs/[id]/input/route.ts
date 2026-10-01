/**
 * Job input (Story 5.2): `GET /api/v1/pipeline/jobs/:id/input`.
 *
 * Streams the original of the job's file to the worker holding the claim
 * (`X-Claim-Token`), with Range support and `Cache-Control: no-store`. The
 * only way a worker reads bytes: it never gets storage credentials or URLs.
 *
 *   200 | 206 bytes   416 bad range
 *   400 CLAIM_TOKEN_REQUIRED   401 UNAUTHENTICATED   404 JOB_NOT_FOUND | FILE_NOT_FOUND
 *   409 CLAIM_STALE | JOB_TERMINAL   503 STORAGE_UNAVAILABLE
 */
import { defineRoute } from '@/lib/defineRoute';
import { CLAIM_TOKEN_HEADER } from '@/lib/pipelineContract';
import { inputResponse, pipelineErrorResponse } from '@/modules/pipeline';

export const dynamic = 'force-dynamic';

/**
 * Read the job input
 * @description The original file of the job, whole or one byte range (Range: bytes=start-end). Only for the worker holding the claim.
 * @tag Pipeline
 * @auth apikey
 * @pathParams JobPathParams
 * @response 200:Blob
 * @openapi
 */
export const GET = defineRoute<{ id: string }>({
  auth: 'worker',
  action: 'claim holder',
  handler: async ({ req, worker, params }) => {
    try {
      return await inputResponse(worker!, params.id, req.headers.get(CLAIM_TOKEN_HEADER), req);
    } catch (err) {
      const refused = pipelineErrorResponse(err);
      if (refused) return refused;
      throw err;
    }
  },
});
