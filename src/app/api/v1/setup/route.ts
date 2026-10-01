/**
 * First-run setup (Story 2.6): creates the first super admin once.
 *
 *   201 { ok: true }                         super admin created, setup complete
 *   400 { code: INVALID_INPUT | PASSWORD_TOO_SHORT | PASSWORD_TOO_LONG | PASSWORD_MISMATCH, field }
 *   403 { code: 'SETUP_TOKEN_INVALID' }       SETUP_TOKEN is set and the body's setupToken differs
 *   409 { code: 'SETUP_ALREADY_DONE' }       setup already happened (or lost the race)
 *   500 { code: 'STORAGE_UNAVAILABLE' }      storage probe failed; nothing created
 *
 * Public and served before setup; its own rate limit (10 per 15 min per IP)
 * is checked before anything else. When `SETUP_TOKEN` is set, the body must
 * carry the same `setupToken` (constant-time compare).
 */
import { NextResponse } from 'next/server';
import { defineRoute, jsonError } from '@/lib/defineRoute';
import { clientIp } from '@/lib/request';
import { limitBy, rateLimitedResponse } from '@/lib/rateLimit';
import { SetupError, completeSetup, isSetupComplete, setupTokenMatches, validateSetupInput } from '@/modules/setup';

export const dynamic = 'force-dynamic';

/**
 * First-run setup
 * @description Creates the first super admin once. Public and served before setup; rate limited to 10 per 15 minutes per IP. When the operator set SETUP_TOKEN the body must carry the same setupToken.
 * @tag System
 * @auth public
 * @body SetupRequest
 * @response 201:OkResponse:Super admin created and setup complete
 * @response 400:ErrorBody:INVALID_INPUT or PASSWORD_TOO_SHORT or PASSWORD_TOO_LONG or PASSWORD_MISMATCH
 * @response 403:ErrorBody:SETUP_TOKEN_INVALID
 * @response 409:ErrorBody:SETUP_ALREADY_DONE
 * @response 429:ErrorBody:RATE_LIMITED
 * @response 500:ErrorBody:STORAGE_UNAVAILABLE (nothing was created)
 * @openapi
 */
export const POST = defineRoute({
  auth: 'public',
  action: 'first-run only',
  allowBeforeSetup: true,
  handler: async ({ req }) => {
    const limited = await limitBy('setup', clientIp(req.headers) ?? 'unknown');
    if (!limited.ok) return rateLimitedResponse(limited.retryAfter);

    if (await isSetupComplete()) return jsonError(409, 'SETUP_ALREADY_DONE', 'Setup is already complete');

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!setupTokenMatches(body?.setupToken)) {
      return jsonError(403, 'SETUP_TOKEN_INVALID', 'The setup token is missing or wrong', { field: 'setupToken' });
    }
    const checked = validateSetupInput(body);
    if (!checked.ok) return jsonError(400, checked.code, checked.message, { field: checked.field });

    try {
      await completeSetup(checked.value);
    } catch (err) {
      if (err instanceof SetupError) {
        if (err.code === 'SETUP_ALREADY_DONE') return jsonError(409, err.code, 'Setup is already complete');
        return jsonError(500, err.code, err.message);
      }
      throw err;
    }
    return NextResponse.json({ ok: true }, { status: 201 });
  },
});
