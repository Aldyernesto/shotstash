/**
 * Bearer in, media cookie out (Story 2.2). The browser calls this after
 * password, Google or registration login and again on boot (renewal).
 */
import { NextResponse } from 'next/server';
import { defineRoute } from '@/lib/defineRoute';
import { SESSION_COOKIE, sessionCookieOptions } from '@/lib/sessionStore';

export const dynamic = 'force-dynamic';

export const POST = defineRoute({
  auth: 'session',
  handler: ({ req, session }) => {
    const s = session!;
    const res = NextResponse.json({ ok: true, expiresAt: s.expiresAt.toISOString() });
    res.cookies.set(SESSION_COOKIE, s.token, sessionCookieOptions(req, s.expiresAt));
    return res;
  },
});
