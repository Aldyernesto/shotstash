/**
 * Worker registration (Story 5.2): `POST /api/v1/pipeline/workers/register`.
 *
 * The only pipeline route that takes the shared `X-Worker-Bootstrap-Token`
 * (`WORKER_BOOTSTRAP_TOKEN`). Registers the manifest's kinds and answers a
 * per-worker token once; only its SHA-256 hash is stored.
 *
 *   201 RegisterResponse
 *   400 INVALID_BODY | INVALID_MANIFEST   401 UNAUTHENTICATED (wrong or missing bootstrap token)
 *   422 CONTRACT_UNSUPPORTED   429 RATE_LIMITED   503 PIPELINE_DISABLED | SETUP_REQUIRED
 */
import { NextResponse } from 'next/server';
import { defineRoute } from '@/lib/defineRoute';
import { parseRegister, pipelineErrorResponse, readJsonBody, registerWorker } from '@/modules/pipeline';

export const dynamic = 'force-dynamic';

/**
 * Register a worker
 * @description Exchanges the shared bootstrap token for a per-worker token (shown once). The manifest names the worker, its version, the kinds it processes and the contract major (1).
 * @tag Pipeline
 * @auth apikey
 * @body RegisterRequest
 * @response 201:RegisterResponse
 * @openapi
 */
export const POST = defineRoute({
  auth: 'worker',
  bootstrap: true,
  action: 'bootstrap token',
  handler: async ({ req }) => {
    try {
      const manifest = parseRegister(await readJsonBody(req));
      return NextResponse.json(await registerWorker(manifest), { status: 201, headers: { 'Cache-Control': 'no-store' } });
    } catch (err) {
      const refused = pipelineErrorResponse(err);
      if (refused) return refused;
      throw err;
    }
  },
});
