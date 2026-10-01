/**
 * Claim the next job (Story 5.1): `POST /api/v1/pipeline/jobs/next`.
 *
 * Claims the oldest queued job of the kinds the worker registered (never a
 * request parameter) in one statement; two workers never get the same job.
 *
 *   200 ClaimResponse   204 nothing to do
 *   401 UNAUTHENTICATED   429 RATE_LIMITED
 */
import { NextResponse } from 'next/server';
import { defineRoute } from '@/lib/defineRoute';
import { claimNext, pipelineErrorResponse } from '@/modules/pipeline';

export const dynamic = 'force-dynamic';

/**
 * Claim the next job
 * @description Answers 204 when no queued job of the worker's kinds exists. The claim token in the answer goes into X-Claim-Token on every later call for the job.
 * @tag Pipeline
 * @auth apikey
 * @body EmptyBody
 * @response 200:ClaimResponse
 * @openapi
 */
export const POST = defineRoute({
  auth: 'worker',
  action: 'registered worker',
  handler: async ({ worker }) => {
    try {
      const job = await claimNext(worker!);
      if (!job) return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
      return NextResponse.json({ job }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (err) {
      const refused = pipelineErrorResponse(err);
      if (refused) return refused;
      throw err;
    }
  },
});
