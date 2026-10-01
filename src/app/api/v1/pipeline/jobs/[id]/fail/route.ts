/**
 * Job failure (Story 5.2): `POST /api/v1/pipeline/jobs/:id/fail`.
 *
 * `retryable: true` with attempts left puts the job back in the queue;
 * otherwise it fails with the error. Any uploaded output is deleted.
 *
 *   200 FailResponse
 *   400 INVALID_BODY | CLAIM_TOKEN_REQUIRED   401 UNAUTHENTICATED   404 JOB_NOT_FOUND
 *   409 CLAIM_STALE | JOB_TERMINAL
 */
import { NextResponse } from 'next/server';
import { defineRoute } from '@/lib/defineRoute';
import { CLAIM_TOKEN_HEADER } from '@/lib/pipelineContract';
import { failJob, parseFail, pipelineErrorResponse, readJsonBody } from '@/modules/pipeline';

export const dynamic = 'force-dynamic';

/**
 * Fail the job
 * @description Reports an error. Retryable failures are requeued while attempts remain (3 in total); the rest fail for good.
 * @tag Pipeline
 * @auth worker
 * @pathParams JobPathParams
 * @header ClaimHeaders
 * @body FailRequest
 * @response 200:FailResponse:Failure recorded
 * @response 400:ErrorBody:INVALID_BODY or CLAIM_TOKEN_REQUIRED
 * @response 401:ErrorBody:Missing or revoked worker token
 * @response 404:ErrorBody:JOB_NOT_FOUND
 * @response 409:ErrorBody:CLAIM_STALE or JOB_TERMINAL
 * @openapi
 */
export const POST = defineRoute<{ id: string }>({
  auth: 'worker',
  action: 'claim holder',
  handler: async ({ req, worker, params }) => {
    try {
      const input = parseFail(await readJsonBody(req));
      return NextResponse.json(await failJob(worker!, params.id, req.headers.get(CLAIM_TOKEN_HEADER), input), {
        headers: { 'Cache-Control': 'no-store' },
      });
    } catch (err) {
      const refused = pipelineErrorResponse(err);
      if (refused) return refused;
      throw err;
    }
  },
});
