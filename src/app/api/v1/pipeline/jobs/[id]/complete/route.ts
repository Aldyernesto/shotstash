/**
 * Job completion (Story 5.2): `POST /api/v1/pipeline/jobs/:id/complete`.
 *
 * In one transaction: the claim is verified, the uploaded output becomes a
 * processed version of the file (with `job_id` and `attempt`) and the job is
 * done. A stale claim answers 409 and its output never becomes a version.
 *
 *   200 CompleteResponse
 *   400 CLAIM_TOKEN_REQUIRED   401 UNAUTHENTICATED   404 JOB_NOT_FOUND
 *   409 CLAIM_STALE | JOB_TERMINAL | OUTPUT_MISSING
 */
import { NextResponse } from 'next/server';
import { defineRoute } from '@/lib/defineRoute';
import { CLAIM_TOKEN_HEADER } from '@/lib/pipelineContract';
import { completeJob, pipelineErrorResponse } from '@/modules/pipeline';

export const dynamic = 'force-dynamic';

/**
 * Complete the job
 * @description Turns the uploaded output into a processed version of the file. Upload the output first.
 * @tag Pipeline
 * @auth apikey
 * @pathParams JobPathParams
 * @body EmptyBody
 * @response 200:CompleteResponse
 * @openapi
 */
export const POST = defineRoute<{ id: string }>({
  auth: 'worker',
  action: 'claim holder',
  handler: async ({ req, worker, params }) => {
    try {
      return NextResponse.json(await completeJob(worker!, params.id, req.headers.get(CLAIM_TOKEN_HEADER)), {
        headers: { 'Cache-Control': 'no-store' },
      });
    } catch (err) {
      const refused = pipelineErrorResponse(err);
      if (refused) return refused;
      throw err;
    }
  },
});
