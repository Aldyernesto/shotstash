/** Logout (Story 2.2): revokes the session row of the Bearer token and clears the media cookie. */
import { NextResponse } from 'next/server';
import { defineRoute } from '@/lib/defineRoute';
import { SESSION_COOKIE, SESSION_COOKIE_PATH, clearedCookieOptions, destroySessionToken } from '@/lib/sessionStore';

export const dynamic = 'force-dynamic';

/**
 * Sign out
 * @description Revokes the session of the Bearer token and clears the media cookie. No body.
 * @tag Auth
 * @auth session
 * @response 200:OkResponse:Signed out
 * @response 401:ErrorBody:No valid session
 * @openapi
 */
export const POST = defineRoute({
  auth: 'session',
  handler: async ({ req, session }) => {
    await destroySessionToken(session!.token);
    const res = NextResponse.json({ ok: true });
    res.cookies.set(SESSION_COOKIE, '', clearedCookieOptions(req, SESSION_COOKIE_PATH));
    return res;
  },
});
