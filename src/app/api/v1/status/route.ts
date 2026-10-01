/**
 * Instance status for the `/status` page (Story 6.1). Super admin only
 * (`instance.configure`); everyone else gets 404 so the page's existence is
 * not advertised.
 *
 *   200 { version, storage: { backend, reachable }, database, cache, search,
 *         workers, queuedJobs, jobs }
 *
 * `workers` counts registered workers seen within the lease (live) and
 * `queuedJobs` the jobs waiting in the queue (Story 5.1); both are null when
 * the database cannot answer. Story 5.4: `jobs` holds the queue figures by
 * state (queued, waitingForWorker, claimed, running, and done24h, failed24h,
 * cancelled24h for the last 24 hours), null when the database cannot answer.
 * `storage.backend` is `local` or `s3` (STORAGE_BACKEND).
 */
import { NextResponse } from 'next/server';
import { defineRoute, jsonError } from '@/lib/defineRoute';
import { cacheUp, dbUp } from '@/lib/healthChecks';
import { storageHealth } from '@/modules/storage';
import { config } from '@/lib/config';
import { can } from '@/modules/auth';
import { jobCounts, pipelineCounts } from '@/modules/pipeline';

export const dynamic = 'force-dynamic';

export const GET = defineRoute({
  auth: 'session',
  action: 'instance.configure',
  handler: async ({ actor }) => {
    if (!can(actor, 'instance.configure')) return jsonError(404, 'NOT_FOUND', 'Not found');
    const c = config();
    const [database, cache, storage] = [await dbUp(), await cacheUp(), await storageHealth()];
    const pipeline = database ? await pipelineCounts().catch(() => null) : null;
    const jobs = database ? await jobCounts().catch(() => null) : null;
    return NextResponse.json(
      {
        version: c.version,
        storage: { backend: storage.backend, reachable: storage.reachable },
        database,
        cache,
        search: c.features.search,
        workers: pipeline?.workers ?? null,
        // Kept for older clients: every queued job (with or without a live worker).
        queuedJobs: jobs ? jobs.queued + jobs.waitingForWorker : null,
        jobs,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  },
});
