/**
 * Story 2.1: every route handler declares how it authenticates.
 *
 *   public   no credential (health, login, share page data for PUBLIC links)
 *   session  Bearer token in `Authorization`; the cookie is never read
 *   cookie   `shotstash_session` cookie; only allowed under `/media/`
 *   signed   HMAC-signed URL, verified by the handler (media module)
 *   share    share-link access, verified by the handler (share cookie or PUBLIC link)
 *   worker   processing worker (Story 5.2): `X-Worker-Token` of a registered,
 *            non-revoked worker, rate limited per worker; with
 *            `bootstrap: true` (registration only) the shared
 *            `X-Worker-Bootstrap-Token` instead. Every response carries
 *            `X-Shotstash-Pipeline: <contract major>`.
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
import { clientIp } from '@/lib/request';
import { limitBy, rateLimitedResponse } from '@/lib/rateLimit';
import {
  PIPELINE_CONTRACT_VERSION,
  PIPELINE_HEADER,
  WORKER_BOOTSTRAP_HEADER,
  WORKER_TOKEN_HEADER,
} from '@/lib/pipelineContract';
import { bootstrapConfigured, bootstrapTokenMatches, validateWorkerToken, type WorkerPrincipal } from '@/lib/workerStore';

const log = logger('route');

export type AuthMode = 'public' | 'session' | 'cookie' | 'signed' | 'share' | 'worker';

export const AUTH_MODES: readonly AuthMode[] = ['public', 'session', 'cookie', 'signed', 'share', 'worker'];

export type RouteParams = Record<string, string | string[] | undefined>;

export type RouteContext<P extends RouteParams> = {
  req: NextRequest;
  params: P;
  /** Set for `session` and `cookie` routes (never null there). */
  actor: SessionActor | null;
  session: ValidSession | null;
  /** Set for `worker` routes (null only with `bootstrap: true`). */
  worker: WorkerPrincipal | null;
};

export type RouteDefinition<P extends RouteParams> = {
  auth: AuthMode;
  /** Permission the handler checks with `can()`, for the route matrix only. */
  action?: string;
  /** Serve this route before first-run setup is complete (setup and health only). */
  allowBeforeSetup?: boolean;
  /** `worker` routes only: authenticate with the shared bootstrap token (worker registration). */
  bootstrap?: boolean;
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

/** Adds the contract header to a worker route's response (headers of a fetched body may be immutable). */
function withPipelineHeader(res: Response): Response {
  try {
    res.headers.set(PIPELINE_HEADER, String(PIPELINE_CONTRACT_VERSION));
    return res;
  } catch {
    const headers = new Headers(res.headers);
    headers.set(PIPELINE_HEADER, String(PIPELINE_CONTRACT_VERSION));
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  }
}

/** Resolves the worker of a `worker` route, or the response refusing it. */
async function resolveWorker(req: NextRequest, bootstrap: boolean): Promise<{ worker: WorkerPrincipal | null } | { refused: Response }> {
  if (bootstrap) {
    // Registration is rare: a small per-IP budget stops token guessing.
    const limited = await limitBy('workerRegister', clientIp(req.headers) ?? 'unknown');
    if (!limited.ok) return { refused: rateLimitedResponse(limited.retryAfter) };
    if (!bootstrapConfigured()) {
      return { refused: jsonError(503, 'PIPELINE_DISABLED', 'WORKER_BOOTSTRAP_TOKEN is not set on this instance') };
    }
    if (!bootstrapTokenMatches(req.headers.get(WORKER_BOOTSTRAP_HEADER))) return { refused: unauthenticatedResponse() };
    return { worker: null };
  }
  // Per IP before the token lookup, so guessing tokens costs a budget too.
  const byIp = await limitBy('workerIp', clientIp(req.headers) ?? 'unknown');
  if (!byIp.ok) return { refused: rateLimitedResponse(byIp.retryAfter) };
  const worker = await validateWorkerToken(req.headers.get(WORKER_TOKEN_HEADER));
  if (!worker) return { refused: unauthenticatedResponse() };
  const limited = await limitBy('worker', worker.id);
  if (!limited.ok) return { refused: rateLimitedResponse(limited.retryAfter) };
  return { worker };
}

export function defineRoute<P extends RouteParams = Record<string, never>>(def: RouteDefinition<P>) {
  if (!AUTH_MODES.includes(def.auth)) throw new Error(`defineRoute: unknown auth mode ${String(def.auth)}`);
  if (def.bootstrap && def.auth !== 'worker') throw new Error('defineRoute: bootstrap is only valid with auth worker');

  const route = async (req: NextRequest, context: { params: Promise<P> }): Promise<Response> => {
    const res = await run(req, context);
    return def.auth === 'worker' ? withPipelineHeader(res) : res;
  };

  const run = async (req: NextRequest, context: { params: Promise<P> }): Promise<Response> => {
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

      let worker: WorkerPrincipal | null = null;
      if (def.auth === 'worker') {
        const resolved = await resolveWorker(req, def.bootstrap === true);
        if ('refused' in resolved) return resolved.refused;
        worker = resolved.worker;
      }

      const params = ((await context?.params) ?? {}) as P;
      return await def.handler({ req, params, actor: session?.actor ?? null, session, worker });
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
