/**
 * Job progress (Story 5.2): `POST /api/v1/pipeline/jobs/:id/progress`.
 *
 * The first report moves the job from claimed to running; every report
 * refreshes the lease and bumps `seq`.
 *
 *   200 ProgressResponse
 *   400 INVALID_BODY | CLAIM_TOKEN_REQUIRED   401 UNAUTHENTICATED   404 JOB_NOT_FOUND
 *   409 CLAIM_STALE | JOB_TERMINAL (cancelled: stop working)
 */
import { NextResponse } from 'next/server';
import { defineRoute } from '@/lib/defineRoute';
import { CLAIM_TOKEN_HEADER } from '@/lib/pipelineContract';
import { parseProgress, pipelineErrorResponse, readJsonBody, reportProgress } from '@/modules/pipeline';

export const dynamic = 'force-dynamic';

/**
 * Report progress
 * @description Percent done (0 to 100). A cancelled job answers 409 JOB_TERMINAL: stop and drop the work.
 * @tag Pipeline
 * @auth apikey
 * @pathParams JobPathParams
 * @body ProgressRequest
 * @response 200:ProgressResponse
 * @openapi
 */
export const POST = defineRoute<{ id: string }>({
  auth: 'worker',
  action: 'claim holder',
  handler: async ({ req, worker, params }) => {
    try {
      const progress = parseProgress(await readJsonBody(req));
      return NextResponse.json(await reportProgress(worker!, params.id, req.headers.get(CLAIM_TOKEN_HEADER), progress), {
        headers: { 'Cache-Control': 'no-store' },
      });
    } catch (err) {
      const refused = pipelineErrorResponse(err);
      if (refused) return refused;
      throw err;
    }
  },
});
