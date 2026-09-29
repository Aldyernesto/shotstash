/**
 * Health (Story 2.7): public, served before setup.
 *
 *   200 { ok: true, setupRequired, version }    everyone
 *   503 { ok: false, setupRequired, version }   a dependency is down
 *
 * The detailed body `{ ok, version, db, cache, storage, setupRequired,
 * schemeMismatch }` is returned only to a loopback client (the TCP peer set
 * by server.ts, never a forwarded header) or a Bearer session whose account
 * may `instance.configure`.
 *
 * `schemeMismatch` is true when the configured public URL (`APP_URL`) and
 * the scheme this request arrived with differ (typically TLS terminated by a
 * proxy without `TRUST_PROXY=true`).
 *
 * `version` is `SHOTSTASH_VERSION` (set by the Docker image), else the
 * version in package.json. Storage is the local storage root until the
 * storage backend abstraction (Epic 4) lands.
 */
import { NextResponse } from 'next/server';
import { cacheUp, dbUp, storageUp } from '@/lib/healthChecks';
import { defineRoute } from '@/lib/defineRoute';
import { CLIENT_IP_HEADER, configuredScheme, requestScheme } from '@/lib/request';
import { bearerToken, validateSessionToken } from '@/lib/sessionStore';
import { can } from '@/modules/auth';
import { isSetupComplete } from '@/lib/setupState';
import { config } from '@/lib/config';

export const dynamic = 'force-dynamic';

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

async function mayReadDetails(req: Request): Promise<boolean> {
  if (LOOPBACK.has(req.headers.get(CLIENT_IP_HEADER)?.trim() ?? '')) return true;
  const token = bearerToken(req.headers);
  if (!token) return false;
  const session = await validateSessionToken(token).catch(() => null);
  return Boolean(session && can(session.actor, 'instance.configure'));
}

export const GET = defineRoute({
  auth: 'public',
  allowBeforeSetup: true,
  handler: async ({ req }) => {
    const [db, cache, storage] = [await dbUp(), await cacheUp(), await storageUp()];
    let setupRequired = true;
    if (db) setupRequired = !(await isSetupComplete().catch(() => false));
    const configured = configuredScheme();
    const ok = db && cache && storage;
    const status = ok ? 200 : 503;
    const headers = { 'Cache-Control': 'no-store' };
    const version = config().version;
    if (!(await mayReadDetails(req))) return NextResponse.json({ ok, setupRequired, version }, { status, headers });
    const body = {
      ok,
      version,
      db,
      cache,
      storage,
      setupRequired,
      schemeMismatch: configured !== null && configured !== requestScheme(req),
    };
    return NextResponse.json(body, { status, headers });
  },
});
