/**
 * Instance status for the `/status` page (Story 6.1). Super admin only
 * (`instance.configure`); everyone else gets 404 so the page's existence is
 * not advertised.
 *
 *   200 { version, storage: { backend, reachable }, database, cache, search,
 *         workers: null, queuedJobs: null }
 *
 * `workers` and `queuedJobs` stay null until the pipeline (Epic 5) exists;
 * the storage backend is the local disk until Epic 4 lands.
 */
import { NextResponse } from 'next/server';
import { defineRoute, jsonError } from '@/lib/defineRoute';
import { cacheUp, dbUp, storageUp } from '@/lib/healthChecks';
import { config } from '@/lib/config';
import { can } from '@/modules/auth';

export const dynamic = 'force-dynamic';

export const GET = defineRoute({
  auth: 'session',
  action: 'instance.configure',
  handler: async ({ actor }) => {
    if (!can(actor, 'instance.configure')) return jsonError(404, 'NOT_FOUND', 'Not found');
    const c = config();
    const [database, cache, storage] = [await dbUp(), await cacheUp(), await storageUp()];
    return NextResponse.json(
      {
        version: c.version,
        storage: { backend: 'local', reachable: storage },
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
