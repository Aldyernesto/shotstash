/**
 * REST login (Story 2.2). Returns the Bearer token for `/api/graphql` and
 * `/api/v1/*` and sets the `shotstash_session` media cookie
 * (HttpOnly; SameSite=Lax; Path=/media; Secure only over HTTPS).
 * Rate limited to 10 attempts per 15 minutes per IP and per email.
 */
import { NextResponse } from 'next/server';
import type { LoginResponse } from '@/lib/apiContract/auth';
import type { Wire } from '@/lib/apiContract/conformance';
import { defineRoute, jsonError } from '@/lib/defineRoute';
import { clientIp } from '@/lib/request';
import { loginLimit, rateLimitedResponse } from '@/lib/rateLimit';
import { SESSION_COOKIE, sessionCookieOptions } from '@/lib/sessionStore';
import * as AuthService from '@/services/auth.service';

export const dynamic = 'force-dynamic';

/**
 * Sign in
 * @description Email and password in and a Bearer token out; also sets the shotstash_session media cookie. Rate limited to 10 attempts per 15 minutes per IP and per email.
 * @tag Auth
 * @auth public
 * @body LoginRequest
 * @response 200:LoginResponse:Signed in
 * @response 400:ErrorBody:BAD_REQUEST (email and password are required)
 * @response 401:ErrorBody:INVALID_CREDENTIALS or another login refusal code
 * @response 429:ErrorBody:RATE_LIMITED
 * @openapi
 */
export const POST = defineRoute({
  auth: 'public',
  handler: async ({ req }) => {
    const ip = clientIp(req.headers) ?? 'unknown';
    const body = (await req.json().catch(() => null)) as { email?: unknown; password?: unknown } | null;
    const email = typeof body?.email === 'string' ? body.email.trim() : '';
    const password = typeof body?.password === 'string' ? body.password : '';
    const retryAfter = await loginLimit(ip, email || null);
    if (retryAfter !== null) return rateLimitedResponse(retryAfter);
    if (!email || !password) return jsonError(400, 'BAD_REQUEST', 'email and password are required');

    let user: Awaited<ReturnType<typeof AuthService.loginUser>>;
    try {
      user = await AuthService.loginUser(email, password);
    } catch (err) {
      // A LoginError names the case (Google-only, deactivated, rejected);
      // anything else stays a plain credentials failure. Status stays 401.
      const code = err instanceof AuthService.LoginError ? err.code : 'INVALID_CREDENTIALS';
      return jsonError(401, code, (err as Error)?.message || 'Invalid email or password');
    }

    const session = await AuthService.createSession(user.id, {
      ip,
      userAgent: req.headers.get('user-agent') ?? undefined,
    });
    const res = NextResponse.json({
      token: session.token,
      expiresAt: session.expiresAt.toISOString(),
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        avatarUrl: user.avatarUrl,
        accountStatus: user.accountStatus,
        onboardedAt: user.onboardedAt,
      },
    } satisfies Wire<LoginResponse>);
    res.cookies.set(SESSION_COOKIE, session.token, sessionCookieOptions(req, session.expiresAt));
    return res;
  },
});
