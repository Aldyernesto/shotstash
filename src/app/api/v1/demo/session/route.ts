/**
 * Try-it session of a public demo (Story 8.2). Exists only in demo mode
 * (404 otherwise): a 60-minute, never sliding session of the read-only demo
 * viewer, for the docs try-it console. Rate limited per IP; a browser
 * Origin must be the instance itself or listed in SHOTSTASH_CORS_ORIGINS.
 *
 *   200 { token, expiresAt }
 */
import { NextResponse } from 'next/server';
import type { DemoSessionResponse } from '@/lib/apiContract/system';
import type { Wire } from '@/lib/apiContract/conformance';
import { config } from '@/lib/config';
import { originAllowed } from '@/lib/cors';
import { defineRoute, jsonError } from '@/lib/defineRoute';
import { limitBy, rateLimitedResponse } from '@/lib/rateLimit';
import { clientIp } from '@/lib/request';
import { createDemoSession } from '@/modules/demo';

export const dynamic = 'force-dynamic';

/**
 * Demo try-it session
 * @description Public demo instances only (SHOTSTASH_DEMO_MODE): a 60-minute session of the read-only demo viewer for the docs try-it console. It never slides; every write with it is refused. Rate limited to 10 per hour per IP. A browser Origin must be the instance itself or listed in SHOTSTASH_CORS_ORIGINS. 404 on every other instance.
 * @tag Auth
 * @auth public
 * @response 200:DemoSessionResponse:A read-only demo session
 * @response 403:ErrorBody:ORIGIN_NOT_ALLOWED
 * @response 404:ErrorBody:NOT_FOUND (demo mode is off)
 * @response 429:ErrorBody:RATE_LIMITED
 * @response 503:ErrorBody:DEMO_NOT_SEEDED (the demo accounts do not exist yet)
 * @openapi
 */
export const POST = defineRoute({
  auth: 'public',
  handler: async ({ req }) => {
    const c = config();
    if (!c.features.demo) return jsonError(404, 'NOT_FOUND', 'Not found');
    const origin = req.headers.get('origin');
    if (origin && origin !== new URL(c.appUrl).origin && !originAllowed(origin, c.SHOTSTASH_CORS_ORIGINS ?? [])) {
      return jsonError(403, 'ORIGIN_NOT_ALLOWED', 'This origin may not open demo sessions');
    }
    const ip = clientIp(req.headers) ?? 'unknown';
    const limited = await limitBy('demoSession', ip);
    if (!limited.ok) return rateLimitedResponse(limited.retryAfter);
    const session = await createDemoSession({ ip, userAgent: req.headers.get('user-agent') ?? undefined });
    if (!session) return jsonError(503, 'DEMO_NOT_SEEDED', 'The demo accounts do not exist yet');
    return NextResponse.json(
      { token: session.token, expiresAt: session.expiresAt.toISOString() } satisfies Wire<DemoSessionResponse>,
      { headers: { 'Cache-Control': 'no-store' } },
    );
  },
});
