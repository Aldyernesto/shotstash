/**
 * Story 2.1: every route handler declares how it authenticates.
 *
 *   public   no credential (health, login, share page data for PUBLIC links)
 *   session  Bearer token in `Authorization`; the cookie is never read
 *   cookie   `shotstash_session` cookie; only allowed under `/media/`
 *   signed   HMAC-signed URL, verified by the handler (media module)
 *   share    share-link access, verified by the handler (share cookie or PUBLIC link)
 *
 * `session` and `cookie` resolve the actor here and answer
 * `401 { code: 'UNAUTHENTICATED' }` when it is missing, expired or inactive.
 * The declared `auth` and optional `action` are attached to the handler and
 * read by `scripts/gen-route-matrix.ts` for `docs/security/route-matrix.md`.
 *
 * Setup gate (Story 2.6): until the first super admin exists every route
 * answers `503 { code: 'SETUP_REQUIRED' }` unless it opts in with
 * `allowBeforeSetup: true` (setup and health). `server.ts` applies the same
 * gate in front of Next; this is the second layer.
 *
 * No Next middleware / proxy is used: this wrapper and the custom server are the only gates.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  SESSION_COOKIE,
  bearerToken,
  validateSessionToken,
  type SessionActor,
  type ValidSession,
} from '@/lib/sessionStore';
import { isSetupComplete } from '@/lib/setupState';
import { errMessage, logger } from '@/lib/logger';

const log = logger('route');

export type AuthMode = 'public' | 'session' | 'cookie' | 'signed' | 'share';

export const AUTH_MODES: readonly AuthMode[] = ['public', 'session', 'cookie', 'signed', 'share'];

export type RouteParams = Record<string, string | string[] | undefined>;

export type RouteContext<P extends RouteParams> = {
  req: NextRequest;
  params: P;
  /** Set for `session` and `cookie` routes (never null there). */
  actor: SessionActor | null;
  session: ValidSession | null;
};

export type RouteDefinition<P extends RouteParams> = {
  auth: AuthMode;
  /** Permission the handler checks with `can()`, for the route matrix only. */
  action?: string;
  /** Serve this route before first-run setup is complete (setup and health only). */
  allowBeforeSetup?: boolean;
  handler: (ctx: RouteContext<P>) => Promise<Response> | Response;
};

export function jsonError(status: number, code: string, message: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ code, message, ...(extra ?? {}) }, { status });
}

export function unauthenticatedResponse() {
  return jsonError(401, 'UNAUTHENTICATED', 'Authentication required');
}

async function resolveSession(req: NextRequest, auth: AuthMode): Promise<ValidSession | null> {
  if (auth === 'session') return validateSessionToken(bearerToken(req.headers));
  if (auth === 'cookie') return validateSessionToken(req.cookies.get(SESSION_COOKIE)?.value ?? null);
  return null;
}

export function defineRoute<P extends RouteParams = Record<string, never>>(def: RouteDefinition<P>) {
  if (!AUTH_MODES.includes(def.auth)) throw new Error(`defineRoute: unknown auth mode ${String(def.auth)}`);

  const route = async (req: NextRequest, context: { params: Promise<P> }): Promise<Response> => {
    try {
      if (!def.allowBeforeSetup && !(await isSetupComplete())) {
        return jsonError(503, 'SETUP_REQUIRED', 'First-run setup is required');
      }

      if (def.auth === 'cookie' && !req.nextUrl.pathname.startsWith('/media/')) {
        // The media cookie is scoped to /media; anywhere else it would be a CSRF vector.
        log.error('cookie auth declared outside /media', { path: req.nextUrl.pathname });
        return jsonError(500, 'INTERNAL', 'Internal error');
      }

      let session: ValidSession | null = null;
      if (def.auth === 'session' || def.auth === 'cookie') {
        session = await resolveSession(req, def.auth);
        if (!session || !session.actor.active) return unauthenticatedResponse();
      }

      const params = ((await context?.params) ?? {}) as P;
      return await def.handler({ req, params, actor: session?.actor ?? null, session });
    } catch (err) {
      log.error('route failed', { method: req.method, path: req.nextUrl.pathname, err: errMessage(err) });
      return jsonError(500, 'INTERNAL', 'Internal error');
    }
  };

  return Object.assign(route, {
    auth: def.auth,
    action: def.action ?? null,
    allowBeforeSetup: def.allowBeforeSetup === true,
  });
}
