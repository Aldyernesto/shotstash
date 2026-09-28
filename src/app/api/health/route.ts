/**
 * Health (Story 2.7): public, served before setup.
 *
 *   200 { ok: true, setupRequired }           everyone
 *   503 { ok: false, setupRequired }          a dependency is down
 *
 * The detailed body `{ ok, version, db, cache, storage, setupRequired,
 * schemeMismatch }` is returned only to a loopback client (the TCP peer set
 * by server.ts, never a forwarded header) or a Bearer session whose account
 * may `instance.configure`.
 *
 * `schemeMismatch` is true when the configured public URL (`APP_URL`, else
 * `NEXT_PUBLIC_APP_URL`) and the scheme this request arrived with differ
 * (typically TLS terminated by a proxy without `TRUST_PROXY=true`).
 */
import { constants as fsConstants, promises as fs } from 'fs';
import path from 'path';
import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { defineRoute } from '@/lib/defineRoute';
import { CLIENT_IP_HEADER, configuredScheme, requestScheme } from '@/lib/request';
import { bearerToken, validateSessionToken } from '@/lib/sessionStore';
import { can } from '@/modules/auth';
import { isSetupComplete } from '@/lib/setupState';
import { storageRoot } from '@/lib/storageRoot';

export const dynamic = 'force-dynamic';

let version: string | null = null;
async function appVersion(): Promise<string> {
  if (version) return version;
  try {
    const pkg = JSON.parse(await fs.readFile(path.join(process.cwd(), 'package.json'), 'utf8')) as { version?: string };
    version = pkg.version ?? 'unknown';
  } catch {
    version = 'unknown';
  }
  return version;
}

function timeout<T>(p: Promise<T>, ms = 1500): Promise<T> {
  return Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))]);
}

async function dbUp(): Promise<boolean> {
  try {
    await timeout(prisma.$queryRaw`SELECT 1`);
    return true;
  } catch {
    return false;
  }
}

async function cacheUp(): Promise<boolean> {
  try {
    const { dfClient } = await import('@/lib/dragonfly');
    if (dfClient.status !== 'ready') return false;
    return (await timeout(dfClient.ping(), 500)) === 'PONG';
  } catch {
    return false;
  }
}

async function storageUp(): Promise<boolean> {
  try {
    await fs.access(storageRoot(), fsConstants.R_OK | fsConstants.W_OK);
    return true;
  } catch {
    return false;
  }
}

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
    if (!(await mayReadDetails(req))) return NextResponse.json({ ok, setupRequired }, { status, headers });
    const body = {
      ok,
      version: await appVersion(),
      db,
      cache,
      storage,
      setupRequired,
      schemeMismatch: configured !== null && configured !== requestScheme(req),
    };
    return NextResponse.json(body, { status, headers });
  },
});
