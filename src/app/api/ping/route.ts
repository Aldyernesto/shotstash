import { NextResponse } from 'next/server';
import type { PingResponse } from '@/lib/apiContract/system';
import { defineRoute } from '@/lib/defineRoute';

/**
 * Ping
 * @description Liveness answer with the server time; touches no dependency.
 * @tag System
 * @auth public
 * @response 200:PingResponse:The server is up
 * @openapi
 */
export const GET = defineRoute({
  auth: 'public',
  handler: () => NextResponse.json({ ok: true, time: Date.now() } satisfies PingResponse),
});
