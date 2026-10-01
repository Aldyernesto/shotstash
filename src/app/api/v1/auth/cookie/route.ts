/**
 * Bearer in, media cookie out (Story 2.2). The browser calls this after
 * password, Google or registration login and again on boot (renewal).
 */
import { NextResponse } from 'next/server';
import type { CookieResponse } from '@/lib/apiContract/auth';
import { defineRoute } from '@/lib/defineRoute';
import { SESSION_COOKIE, sessionCookieOptions } from '@/lib/sessionStore';

export const dynamic = 'force-dynamic';

/**
 * Set the media cookie
 * @description Bearer in and media cookie out: sets shotstash_session (HttpOnly; SameSite=Lax; Path=/media) for the session of the Bearer token. Browsers call it after sign-in and on boot. No body.
 * @tag Auth
 * @auth session
 * @response 200:CookieResponse:Cookie set
 * @response 401:ErrorBody:No valid session
 * @openapi
 */
export const POST = defineRoute({
  auth: 'session',
  handler: ({ req, session }) => {
    const s = session!;
    const res = NextResponse.json({ ok: true, expiresAt: s.expiresAt.toISOString() } satisfies CookieResponse);
    res.cookies.set(SESSION_COOKIE, s.token, sessionCookieOptions(req, s.expiresAt));
    return res;
  },
});
