/**
 * Job release (Story 5.2): `POST /api/v1/pipeline/jobs/:id/release`.
 *
 * The claim holder gives the job back, for example when it shuts down: the
 * job is queued again at once and the attempt is not counted. Any uploaded
 * output is deleted.
 *
 *   200 ReleaseResponse
 *   400 CLAIM_TOKEN_REQUIRED   401 UNAUTHENTICATED   404 JOB_NOT_FOUND
 *   409 CLAIM_STALE | JOB_TERMINAL
 */
import { NextResponse } from 'next/server';
import { defineRoute } from '@/lib/defineRoute';
import { CLAIM_TOKEN_HEADER } from '@/lib/pipelineContract';
import { pipelineErrorResponse, releaseJob } from '@/modules/pipeline';

export const dynamic = 'force-dynamic';

/**
 * Release the job
 * @description Puts a claimed or running job back in the queue without spending an attempt (use it on shutdown). Another worker can claim it at once.
 * @tag Pipeline
 * @auth apikey
 * @pathParams JobPathParams
 * @body EmptyBody
 * @response 200:ReleaseResponse
 * @openapi
 */
export const POST = defineRoute<{ id: string }>({
  auth: 'worker',
  action: 'claim holder',
  handler: async ({ req, worker, params }) => {
    try {
      return NextResponse.json(await releaseJob(worker!, params.id, req.headers.get(CLAIM_TOKEN_HEADER)), {
        headers: { 'Cache-Control': 'no-store' },
      });
    } catch (err) {
      const refused = pipelineErrorResponse(err);
      if (refused) return refused;
      throw err;
    }
  },
});
