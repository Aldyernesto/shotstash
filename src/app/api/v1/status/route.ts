/**
 * Instance status for the `/status` page (Story 6.1). Super admin only
 * (`instance.configure`); everyone else gets 404 so the page's existence is
 * not advertised.
 *
 *   200 { version, storage: { backend, reachable }, database, cache, search,
 *         workers: null, queuedJobs: null }
 *
 * `workers` and `queuedJobs` stay null until the pipeline (Epic 5) exists.
 * `storage.backend` is `local` or `s3` (STORAGE_BACKEND).
 */
import { NextResponse } from 'next/server';
import { defineRoute, jsonError } from '@/lib/defineRoute';
import { cacheUp, dbUp } from '@/lib/healthChecks';
import { storageHealth } from '@/modules/storage';
import { config } from '@/lib/config';
import { can } from '@/modules/auth';

export const dynamic = 'force-dynamic';

export const GET = defineRoute({
  auth: 'session',
  action: 'instance.configure',
  handler: async ({ actor }) => {
    if (!can(actor, 'instance.configure')) return jsonError(404, 'NOT_FOUND', 'Not found');
    const c = config();
    const [database, cache, storage] = [await dbUp(), await cacheUp(), await storageHealth()];
    return NextResponse.json(
      {
        version: c.version,
        storage: { backend: storage.backend, reachable: storage.reachable },
        database,
        cache,
        search: c.features.search,
        workers: null,
        queuedJobs: null,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  },
});
