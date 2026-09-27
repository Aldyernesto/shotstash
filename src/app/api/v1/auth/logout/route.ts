/** Logout (Story 2.2): revokes the session row of the Bearer token and clears the media cookie. */
import { NextResponse } from 'next/server';
import { defineRoute } from '@/lib/defineRoute';
import { SESSION_COOKIE, SESSION_COOKIE_PATH, clearedCookieOptions, destroySessionToken } from '@/lib/sessionStore';

export const dynamic = 'force-dynamic';

export const POST = defineRoute({
  auth: 'session',
  handler: async ({ req, session }) => {
    await destroySessionToken(session!.token);
    const res = NextResponse.json({ ok: true });
    res.cookies.set(SESSION_COOKIE, '', clearedCookieOptions(req, SESSION_COOKIE_PATH));
    return res;
  },
});
