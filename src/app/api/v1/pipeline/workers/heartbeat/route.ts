/**
 * Worker heartbeat (Story 5.2): `POST /api/v1/pipeline/workers/heartbeat`.
 *
 * Every 30 s. Updates the manifest and refreshes the lease of every job in
 * `activeJobIds` the worker still holds; `lostJobIds` lists the others
 * (cancelled, requeued or gone), which the worker should stop.
 *
 *   200 HeartbeatResponse
 *   400 INVALID_BODY | INVALID_MANIFEST   401 UNAUTHENTICATED   422 CONTRACT_UNSUPPORTED   429 RATE_LIMITED
 */
import { NextResponse } from 'next/server';
import { defineRoute } from '@/lib/defineRoute';
import { heartbeat, parseHeartbeat, pipelineErrorResponse, readJsonBody } from '@/modules/pipeline';

export const dynamic = 'force-dynamic';

/**
 * Send a heartbeat
 * @description Keeps the worker live and refreshes the leases of the jobs it is processing. A claim without a heartbeat for the lease (90 s by default) goes back to the queue.
 * @tag Pipeline
 * @auth worker
 * @body HeartbeatRequest
 * @response 200:HeartbeatResponse:Heartbeat stored
 * @response 400:ErrorBody:INVALID_BODY or INVALID_MANIFEST
 * @response 401:ErrorBody:Missing or revoked worker token
 * @response 422:ErrorBody:CONTRACT_UNSUPPORTED
 * @response 429:ErrorBody:RATE_LIMITED
 * @openapi
 */
export const POST = defineRoute({
  auth: 'worker',
  action: 'registered worker',
  handler: async ({ req, worker }) => {
    try {
      const { manifest, activeJobIds } = parseHeartbeat(await readJsonBody(req));
      return NextResponse.json(await heartbeat(worker!, manifest, activeJobIds), { headers: { 'Cache-Control': 'no-store' } });
    } catch (err) {
      const refused = pipelineErrorResponse(err);
      if (refused) return refused;
      throw err;
    }
  },
});
