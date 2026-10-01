/**
 * Pipeline queue and worker contract (Stories 5.1-5.2).
 *
 * Jobs live in `pipeline_jobs`. A worker claims the oldest queued job of a
 * kind it registered with ONE statement (`UPDATE ... WHERE id = (SELECT ...
 * FOR UPDATE SKIP LOCKED LIMIT 1)`), so two workers never get the same job.
 * Every later call carries the claim token; each write re-checks the claim
 * and the status in the statement (or transaction) that commits it, so a
 * requeued, cancelled or finished job refuses a stale worker with
 * `409 CLAIM_STALE` or `409 JOB_TERMINAL`.
 *
 * Lease: `heartbeat_at` only. Claim, progress, output and heartbeats move it
 * (database clock); the sweeper requeues a claim older than the lease and
 * fails the job once `max_attempts` claims expired.
 *
 * Output: one per job, streamed to the storage backend at
 * `files/<fileId>/proc/<versionId>.<ext>` and recorded on the job; only
 * `complete` turns it into a processed version (with `job_id` and
 * `attempt`). Any output the job no longer owns (stale upload, requeue,
 * cancel, retry) is deleted. Workers never see storage keys or credentials.
 */
import { Readable, Transform, type TransformCallback } from 'stream';
import { v7 as uuidv7 } from 'uuid';
import prisma from '@/lib/prisma';
import { config } from '@/lib/config';
import { errMessage, logger } from '@/lib/logger';
import { HEARTBEAT_SECONDS, PIPELINE_CONTRACT_VERSION } from '@/lib/pipelineContract';
import { hashWorkerToken, newWorkerToken, secretsEqual, type WorkerPrincipal } from '@/lib/workerStore';
import { isStorageError, storage, storageKeys } from '@/modules/storage';
import { fileResponse } from '@/modules/media';
import {
  CLAIMED_STATUSES,
  MAX_ATTEMPTS,
  RETRY_DELAY_SECONDS,
  kindAccepts,
  PipelineFailure,
  isJobId,
  isTerminal,
  jobState,
  parseOutputHeaders,
  type ClaimedJob,
  type CompleteResponse,
  type FailResponse,
  type HeartbeatResponse,
  type JobState,
  type OutputResponse,
  type ParsedManifest,
  type ProgressResponse,
  type RegisterResponse,
  type ReleaseResponse,
} from './contract.ts';
import { isKindName } from './kinds.ts';

const log = logger('pipeline');

export function leaseSeconds(): number {
  return config().SHOTSTASH_PIPELINE_LEASE_SECONDS;
}

export function maxOutputBytes(): number {
  return config().SHOTSTASH_PIPELINE_MAX_OUTPUT_MB * 1024 * 1024;
}

/** Best effort: a key the job no longer owns. Failures are logged, never thrown. */
async function dropObject(key: string | null | undefined) {
  if (!key) return;
  try {
    await storage().delete(key);
  } catch (err) {
    log.warn('output delete failed', { key, err: errMessage(err) });
  }
}

/* ------------------------------------------------------------------ */
/* Workers                                                             */
/* ------------------------------------------------------------------ */

async function addKinds(kinds: string[]) {
  if (!kinds.length) return;
  await prisma.pipelineKind.createMany({ data: kinds.map((name) => ({ name })), skipDuplicates: true });
}

/** The unique-constraint error of a racing insert. */
function isUniqueViolation(err: unknown): boolean {
  return !!err && typeof err === 'object' && (err as { code?: string }).code === 'P2002';
}

/**
 * Registers a worker by name: its kinds join `pipeline_kinds`; the token is
 * returned once and stored hashed. A name that is already registered keeps
 * its row and gets a new token (the old one stops working); a revoked name
 * is refused with 403 WORKER_REVOKED.
 */
export async function registerWorker(manifest: ParsedManifest): Promise<RegisterResponse> {
  const token = newWorkerToken();
  const data = { version: manifest.version, kinds: manifest.kinds, tokenHash: hashWorkerToken(token), lastSeen: new Date() };
  await addKinds(manifest.kinds);
  let id: string | null = null;
  for (let tries = 0; tries < 2 && !id; tries++) {
    const existing = await prisma.pipelineWorker.findUnique({ where: { name: manifest.name }, select: { id: true, revokedAt: true } });
    if (existing?.revokedAt) throw new PipelineFailure(403, 'WORKER_REVOKED', `The worker name ${manifest.name} is revoked`);
    if (existing) {
      const r = await prisma.pipelineWorker.updateMany({ where: { id: existing.id, revokedAt: null }, data });
      if (r.count) id = existing.id;
      continue;
    }
    try {
      id = (await prisma.pipelineWorker.create({ data: { id: uuidv7(), name: manifest.name, ...data }, select: { id: true } })).id;
    } catch (err) {
      // Another registration of the same name won the insert: rotate on its row.
      if (!isUniqueViolation(err)) throw err;
    }
  }
  if (!id) throw new PipelineFailure(403, 'WORKER_REVOKED', `The worker name ${manifest.name} is revoked`);
  log.info('worker registered', { workerId: id, name: manifest.name, version: manifest.version, kinds: manifest.kinds });
  return {
    workerId: id,
    token,
    contract: PIPELINE_CONTRACT_VERSION,
    heartbeatSeconds: HEARTBEAT_SECONDS,
    leaseSeconds: leaseSeconds(),
  };
}

export type WorkerView = {
  id: string;
  name: string;
  version: string;
  kinds: string[];
  lastSeen: Date;
  revokedAt: Date | null;
  createdAt: Date;
  /** Seen within the lease and not revoked. */
  live: boolean;
};

const WORKER_SELECT = { id: true, name: true, version: true, kinds: true, lastSeen: true, revokedAt: true, createdAt: true } as const;

function workerView(w: Omit<WorkerView, 'live'>): WorkerView {
  return { ...w, live: !w.revokedAt && Date.now() - w.lastSeen.getTime() <= leaseSeconds() * 1000 };
}

/** Registered workers, most recently seen first. */
export async function listWorkers(): Promise<WorkerView[]> {
  const rows = await prisma.pipelineWorker.findMany({ orderBy: [{ lastSeen: 'desc' }, { id: 'asc' }], select: WORKER_SELECT });
  return rows.map(workerView);
}

/**
 * Revokes a worker: its token stops working at once (401) and its name
 * cannot register again (403 WORKER_REVOKED). Its claims expire through the
 * sweeper. Null when there is no such worker.
 */
export async function revokeWorker(workerId: string): Promise<WorkerView | null> {
  if (!isJobId(workerId)) return null;
  await prisma.pipelineWorker.updateMany({ where: { id: workerId, revokedAt: null }, data: { revokedAt: new Date() } });
  const row = await prisma.pipelineWorker.findUnique({ where: { id: workerId }, select: WORKER_SELECT });
  if (row) log.info('worker revoked', { workerId });
  return row ? workerView(row) : null;
}

/**
 * Heartbeat: the manifest may change (a new version or kind), and the
 * leases of `activeJobIds` the worker still holds are refreshed. Answers the
 * ids it no longer holds.
 */
export async function heartbeat(worker: WorkerPrincipal, manifest: ParsedManifest, activeJobIds: string[]): Promise<HeartbeatResponse> {
  await addKinds(manifest.kinds);
  await prisma.pipelineWorker.update({
    where: { id: worker.id },
    // The name is the identity of the row (set at registration); a heartbeat updates version and kinds only.
    data: { version: manifest.version, kinds: manifest.kinds, lastSeen: new Date() },
  });
  let held: string[] = [];
  if (activeJobIds.length) {
    const rows = await prisma.$queryRaw<{ id: string }[]>`
      UPDATE pipeline_jobs SET heartbeat_at = now(), updated_at = now()
      WHERE id = ANY(${activeJobIds}::text[]) AND claimed_by = ${worker.id} AND status IN ('claimed', 'running')
      RETURNING id`;
    held = rows.map((r) => r.id);
  }
  return { contract: PIPELINE_CONTRACT_VERSION, lostJobIds: activeJobIds.filter((id) => !held.includes(id)) };
}

/* ------------------------------------------------------------------ */
/* Claims                                                              */
/* ------------------------------------------------------------------ */

type ClaimRow = {
  id: string;
  kind: string;
  params: unknown;
  attempts: number;
  max_attempts: number;
  claim_token: string;
  media_file_id: string;
};

/**
 * Claims the oldest queued job of the worker's registered kinds whose file
 * is ready and not in the Trash. Null when there is none.
 */
export async function claimNext(worker: WorkerPrincipal): Promise<ClaimedJob | null> {
  const kinds = worker.kinds.filter(isKindName);
  if (!kinds.length) return null;
  const rows = await prisma.$queryRaw<ClaimRow[]>`
    UPDATE pipeline_jobs
    SET status = 'claimed', claimed_by = ${worker.id}, claim_token = gen_random_uuid()::text,
        heartbeat_at = now(), attempts = attempts + 1, progress = 0, seq = seq + 1, updated_at = now(), run_after = NULL,
        output_version_id = NULL, output_key = NULL, output_mime_type = NULL, output_size = NULL
    WHERE id = (
      SELECT j.id FROM pipeline_jobs j
      JOIN media_files m ON m.id = j.media_file_id
      WHERE j.status = 'queued' AND j.kind = ANY(${kinds}::text[])
        AND (j.run_after IS NULL OR j.run_after <= now())
        AND m.status = 'ready' AND m."trashedAt" IS NULL
      ORDER BY j.created_at, j.id
      FOR UPDATE OF j SKIP LOCKED
      LIMIT 1
    ) AND status = 'queued'
    RETURNING id, kind, params, attempts, max_attempts, claim_token, media_file_id`;
  const row = rows[0];
  if (!row) return null;
  const file = await prisma.mediaFile.findUnique({
    where: { id: row.media_file_id },
    select: { originalName: true, mimeType: true, size: true },
  });
  log.info('job claimed', { jobId: row.id, kind: row.kind, workerId: worker.id, attempt: row.attempts });
  const params = row.params && typeof row.params === 'object' && !Array.isArray(row.params) ? (row.params as Record<string, unknown>) : {};
  return {
    id: row.id,
    kind: row.kind,
    params,
    attempt: Number(row.attempts),
    maxAttempts: Number(row.max_attempts),
    claimToken: row.claim_token,
    input: {
      url: `/api/v1/pipeline/jobs/${row.id}/input`,
      name: file?.originalName ?? '',
      mimeType: file?.mimeType ?? 'application/octet-stream',
      size: Number(file?.size ?? 0),
    },
  };
}

/** Why a claim-checked write matched nothing: 404 JOB_NOT_FOUND, 409 CLAIM_STALE or 409 JOB_TERMINAL. */
async function refusal(worker: WorkerPrincipal, jobId: string, claimToken: string): Promise<PipelineFailure> {
  const job = await prisma.pipelineJob.findUnique({ where: { id: jobId }, select: { status: true, claimedBy: true, claimToken: true } });
  if (!job) return new PipelineFailure(404, 'JOB_NOT_FOUND', 'Job not found');
  const holds = job.claimedBy === worker.id && !!job.claimToken && secretsEqual(claimToken, job.claimToken);
  if (holds && isTerminal(job.status)) return new PipelineFailure(409, 'JOB_TERMINAL', `The job is ${job.status}`);
  return new PipelineFailure(409, 'CLAIM_STALE', 'This claim is no longer valid (the job was requeued or claimed again)');
}

function assertJobRef(jobId: string, claimToken: string | null): asserts claimToken is string {
  if (!isJobId(jobId)) throw new PipelineFailure(404, 'JOB_NOT_FOUND', 'Job not found');
  if (!claimToken || claimToken.length > 100) throw new PipelineFailure(400, 'CLAIM_TOKEN_REQUIRED', 'X-Claim-Token is required');
}

/** The job and its file while `worker` holds a live claim with `claimToken`; throws the refusal otherwise. */
async function requireClaim(worker: WorkerPrincipal, jobId: string, claimToken: string | null) {
  assertJobRef(jobId, claimToken);
  const job = await prisma.pipelineJob.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      status: true,
      claimedBy: true,
      claimToken: true,
      mediaFileId: true,
      mediaFile: { select: { storageKey: true, mimeType: true, status: true, trashedAt: true } },
    },
  });
  const live =
    job &&
    job.claimedBy === worker.id &&
    !!job.claimToken &&
    secretsEqual(claimToken, job.claimToken) &&
    (CLAIMED_STATUSES as readonly string[]).includes(job.status);
  if (!live) throw await refusal(worker, jobId, claimToken);
  return job;
}

/** `GET jobs/:id/input`: the original, Range-capable, `Cache-Control: no-store`, only to the claim holder. */
export async function inputResponse(worker: WorkerPrincipal, jobId: string, claimToken: string | null, req: Request): Promise<Response> {
  const job = await requireClaim(worker, jobId, claimToken);
  const file = job.mediaFile;
  if (!file || file.status !== 'ready' || file.trashedAt) throw new PipelineFailure(404, 'FILE_NOT_FOUND', 'The file of this job is gone or in the Trash');
  return fileResponse({ req, key: file.storageKey, mimeType: file.mimeType, cache: 'no-store' });
}

/** `POST jobs/:id/progress`: claimed becomes running; the lease moves and `seq` is bumped. */
export async function reportProgress(worker: WorkerPrincipal, jobId: string, claimToken: string | null, progress: number): Promise<ProgressResponse> {
  assertJobRef(jobId, claimToken);
  const rows = await prisma.$queryRaw<{ progress: number; seq: bigint }[]>`
    UPDATE pipeline_jobs
    SET status = 'running', progress = ${progress}, seq = seq + 1, heartbeat_at = now(), updated_at = now()
    WHERE id = ${jobId} AND claimed_by = ${worker.id} AND claim_token = ${claimToken} AND status IN ('claimed', 'running')
    RETURNING progress, seq`;
  if (!rows[0]) throw await refusal(worker, jobId, claimToken);
  return { status: 'running', progress: Number(rows[0].progress), seq: Number(rows[0].seq) };
}

/** Counts bytes and fails the stream once more than `max` pass. */
class LimitStream extends Transform {
  bytes = 0;
  exceeded = false;
  constructor(private readonly max: number) {
    super();
  }
  _transform(chunk: Buffer, _enc: BufferEncoding, done: TransformCallback) {
    this.bytes += chunk.length;
    if (this.bytes > this.max) {
      this.exceeded = true;
      done(new PipelineFailure(413, 'OUTPUT_TOO_LARGE', `The output is larger than ${this.max} bytes`));
      return;
    }
    done(null, chunk);
  }
}

/**
 * `PUT jobs/:id/output`: streams the raw body to storage under a fresh
 * version id, then records it on the job if the claim is still live (else
 * the object is deleted and the refusal thrown). A second upload by the same
 * claim replaces the first.
 */
export async function storeOutput(
  worker: WorkerPrincipal,
  jobId: string,
  claimToken: string | null,
  input: { body: Readable; contentType: string | null; ext: string | null; contentLength: number | null },
): Promise<OutputResponse> {
  const job = await requireClaim(worker, jobId, claimToken);
  const { ext, mimeType } = parseOutputHeaders(input.ext, input.contentType);
  const max = maxOutputBytes();
  if (input.contentLength !== null && input.contentLength > max) {
    throw new PipelineFailure(413, 'OUTPUT_TOO_LARGE', `The output is larger than ${max} bytes`);
  }
  const versionId = uuidv7();
  const key = storageKeys.processed(job.mediaFileId, versionId, ext);
  const limiter = new LimitStream(max);
  input.body.on('error', (err) => limiter.destroy(err));
  input.body.pipe(limiter);
  let size: number;
  try {
    size = (await storage().putStream(key, limiter, { contentType: mimeType, size: input.contentLength ?? undefined })).size;
  } catch (err) {
    await dropObject(key);
    if (limiter.exceeded) throw new PipelineFailure(413, 'OUTPUT_TOO_LARGE', `The output is larger than ${max} bytes`);
    if (err instanceof PipelineFailure) throw err;
    if (isStorageError(err, 'PART_SIZE_MISMATCH')) throw new PipelineFailure(400, 'INVALID_OUTPUT', 'The body does not match Content-Length');
    if (isStorageError(err)) {
      log.error('output store failed', { jobId, err: errMessage(err) });
      throw new PipelineFailure(503, 'STORAGE_UNAVAILABLE', 'Storage is unavailable');
    }
    throw err;
  }
  if (size === 0) {
    await dropObject(key);
    throw new PipelineFailure(400, 'INVALID_OUTPUT', 'The output is empty');
  }
  // The claim may have expired or been cancelled while the bytes streamed:
  // record the output only if it is still live, in the same statement.
  const rows = await prisma.$queryRaw<{ previous_key: string | null }[]>`
    WITH cur AS (
      SELECT id, output_key FROM pipeline_jobs
      WHERE id = ${jobId} AND claimed_by = ${worker.id} AND claim_token = ${claimToken} AND status IN ('claimed', 'running')
      FOR UPDATE
    )
    UPDATE pipeline_jobs p
    SET output_version_id = ${versionId}, output_key = ${key}, output_mime_type = ${mimeType}, output_size = ${size}::bigint,
        heartbeat_at = now(), updated_at = now()
    FROM cur WHERE p.id = cur.id
    RETURNING cur.output_key AS previous_key`;
  if (!rows[0]) {
    await dropObject(key);
    throw await refusal(worker, jobId, claimToken!);
  }
  if (rows[0].previous_key && rows[0].previous_key !== key) await dropObject(rows[0].previous_key);
  log.info('job output stored', { jobId, size, mimeType });
  return { versionId, size, mimeType };
}

type LockedJob = {
  id: string;
  status: string;
  claimed_by: string | null;
  claim_token: string | null;
  attempts: number;
  kind: string;
  media_file_id: string;
  output_version_id: string | null;
  output_key: string | null;
  output_mime_type: string | null;
  output_size: bigint | null;
};

/** True when the file is missing, not ready or in the Trash. */
async function fileIsGone(fileId: string): Promise<boolean> {
  const f = await prisma.mediaFile.findUnique({ where: { id: fileId }, select: { status: true, trashedAt: true } }).catch(() => null);
  return !f || f.status !== 'ready' || !!f.trashedAt;
}

const fileGoneFailure = () => new PipelineFailure(409, 'FILE_GONE', 'The file of this job was trashed or deleted');

/** Error recorded on jobs cancelled because their file went to the Trash. */
export const FILE_TRASHED_ERROR = 'file trashed';

type CompleteOutcome = { versionId: string } | { refused: PipelineFailure; drop?: string | null };

/**
 * `POST jobs/:id/complete`: in one transaction the claim is verified, the
 * processed version created from the uploaded output (with `job_id` and
 * `attempt`) and the job marked done. A job whose file is trashed or gone
 * answers 409 FILE_GONE and its output is deleted.
 *
 * Lock order: the file row (FOR SHARE) before the job row, the order in
 * which a purge deletes them (the file, then its jobs by cascade), so a
 * purge running at the same time never deadlocks with a completion.
 */
export async function completeJob(worker: WorkerPrincipal, jobId: string, claimToken: string | null): Promise<CompleteResponse> {
  assertJobRef(jobId, claimToken);
  const head = await prisma.pipelineJob.findUnique({ where: { id: jobId }, select: { mediaFileId: true, outputKey: true } });
  if (!head) throw new PipelineFailure(404, 'JOB_NOT_FOUND', 'Job not found');
  let outcome: CompleteOutcome;
  try {
    outcome = await prisma.$transaction(async (tx): Promise<CompleteOutcome> => {
      const files = await tx.$queryRaw<{ live: boolean }[]>`
        SELECT ("trashedAt" IS NULL AND status = 'ready') AS live FROM media_files WHERE id = ${head.mediaFileId} FOR SHARE`;
      const rows = await tx.$queryRaw<LockedJob[]>`
        SELECT id, status::text AS status, claimed_by, claim_token, attempts, kind, media_file_id,
               output_version_id, output_key, output_mime_type, output_size
        FROM pipeline_jobs WHERE id = ${jobId} FOR UPDATE`;
      const job = rows[0];
      if (!job) {
        return files[0] ? { refused: new PipelineFailure(404, 'JOB_NOT_FOUND', 'Job not found') } : { refused: fileGoneFailure(), drop: head.outputKey };
      }
      const holds = job.claimed_by === worker.id && !!job.claim_token && secretsEqual(claimToken, job.claim_token);
      if (!holds) return { refused: new PipelineFailure(409, 'CLAIM_STALE', 'This claim is no longer valid (the job was requeued or claimed again)') };
      if (!files[0]?.live) {
        // Trashed (the trash also cancels the job) or gone: no version, no output.
        await tx.$executeRaw`
          UPDATE pipeline_jobs
          SET status = CASE WHEN status IN ('claimed', 'running') THEN 'cancelled'::"PipelineJobStatus" ELSE status END,
              error = CASE WHEN status IN ('claimed', 'running') THEN ${FILE_TRASHED_ERROR} ELSE error END,
              finished_at = COALESCE(finished_at, now()), seq = seq + 1, heartbeat_at = NULL, updated_at = now(), run_after = NULL,
              output_version_id = NULL, output_key = NULL, output_mime_type = NULL, output_size = NULL
          WHERE id = ${jobId}`;
        return { refused: fileGoneFailure(), drop: job.output_key };
      }
      if (isTerminal(job.status)) {
        // A cancelled job keeps no output.
        const drop = job.output_key;
        if (drop) {
          await tx.$executeRaw`UPDATE pipeline_jobs SET output_version_id = NULL, output_key = NULL, output_mime_type = NULL, output_size = NULL WHERE id = ${jobId}`;
        }
        return { refused: new PipelineFailure(409, 'JOB_TERMINAL', `The job is ${job.status}`), drop };
      }
      if (!(CLAIMED_STATUSES as readonly string[]).includes(job.status)) {
        return { refused: new PipelineFailure(409, 'CLAIM_STALE', 'This claim is no longer valid') };
      }
      if (!job.output_key || !job.output_version_id || !job.output_mime_type || job.output_size === null) {
        return { refused: new PipelineFailure(409, 'OUTPUT_MISSING', 'Upload the output (PUT jobs/:id/output) before completing') };
      }
      await tx.processedVersion.create({
        data: {
          id: job.output_version_id,
          mediaFileId: job.media_file_id,
          kind: job.kind,
          jobId: job.id,
          attempt: Number(job.attempts),
          storageKey: job.output_key,
          mimeType: job.output_mime_type,
          size: BigInt(job.output_size),
        },
      });
      // The object now belongs to the processed version; the job keeps its id.
      await tx.$executeRaw`
        UPDATE pipeline_jobs
        SET status = 'done', progress = 100, seq = seq + 1, heartbeat_at = NULL, finished_at = now(), updated_at = now(),
            error = NULL, output_key = NULL
        WHERE id = ${jobId}`;
      return { versionId: job.output_version_id };
    });
  } catch (err) {
    // A purge that slipped in between (foreign key, deadlock, vanished row)
    // means the file is gone: answer that, never a 500.
    if (await fileIsGone(head.mediaFileId)) {
      await dropObject(head.outputKey);
      throw fileGoneFailure();
    }
    throw err;
  }
  if ('refused' in outcome) {
    await dropObject(outcome.drop);
    throw outcome.refused;
  }
  log.info('job done', { jobId, versionId: outcome.versionId });
  return { status: 'done', versionId: outcome.versionId };
}

/**
 * `POST jobs/:id/release`: the claim holder gives the job back (shutdown)
 * without spending an attempt; it can be claimed again at once.
 */
export async function releaseJob(worker: WorkerPrincipal, jobId: string, claimToken: string | null): Promise<ReleaseResponse> {
  assertJobRef(jobId, claimToken);
  const rows = await prisma.$queryRaw<{ attempts: number; previous_key: string | null }[]>`
    WITH cur AS (
      SELECT id, output_key FROM pipeline_jobs
      WHERE id = ${jobId} AND claimed_by = ${worker.id} AND claim_token = ${claimToken} AND status IN ('claimed', 'running')
      FOR UPDATE
    )
    UPDATE pipeline_jobs p
    SET status = 'queued', attempts = GREATEST(p.attempts - 1, 0), claimed_by = NULL, claim_token = NULL,
        heartbeat_at = NULL, run_after = NULL, progress = 0, seq = p.seq + 1, updated_at = now(),
        output_version_id = NULL, output_key = NULL, output_mime_type = NULL, output_size = NULL
    FROM cur WHERE p.id = cur.id
    RETURNING p.attempts, cur.output_key AS previous_key`;
  const row = rows[0];
  if (!row) throw await refusal(worker, jobId, claimToken);
  await dropObject(row.previous_key);
  log.info('job released', { jobId, attempts: Number(row.attempts) });
  return { status: 'queued', attempts: Number(row.attempts) };
}

/**
 * Cancels every unfinished job whose file is in the Trash (error "file
 * trashed") and deletes their uploaded outputs. Called by the trash after
 * it moves files and by the sweeper. Answers the count.
 */
export async function cancelJobsOfTrashedFiles(): Promise<number> {
  const rows = await prisma.$queryRaw<{ previous_key: string | null }[]>`
    WITH cur AS (
      SELECT j.id, j.output_key FROM pipeline_jobs j
      JOIN media_files m ON m.id = j.media_file_id
      WHERE j.status IN ('queued', 'claimed', 'running') AND m."trashedAt" IS NOT NULL
      FOR UPDATE OF j
    )
    UPDATE pipeline_jobs p
    SET status = 'cancelled', error = ${FILE_TRASHED_ERROR}, seq = p.seq + 1, heartbeat_at = NULL, finished_at = now(), updated_at = now(),
        run_after = NULL, output_version_id = NULL, output_key = NULL, output_mime_type = NULL, output_size = NULL
    FROM cur WHERE p.id = cur.id
    RETURNING cur.output_key AS previous_key`;
  for (const r of rows) await dropObject(r.previous_key);
  if (rows.length) log.info('jobs cancelled: file trashed', { jobs: rows.length });
  return rows.length;
}

/** Days after which a worker row that holds no claim is removed. */
export const WORKER_PRUNE_DAYS = 30;

/** Removes worker rows not seen for 30 days that hold no claim. Answers the count. */
export async function pruneWorkers(): Promise<number> {
  const before = new Date(Date.now() - WORKER_PRUNE_DAYS * 24 * 3600 * 1000);
  const r = await prisma.pipelineWorker.deleteMany({
    where: { lastSeen: { lt: before }, jobs: { none: { status: { in: ['claimed', 'running'] } } } },
  });
  return r.count;
}

type FailRow = { status: string; attempts: number; max_attempts: number; previous_key: string | null };

/** `POST jobs/:id/fail`: retryable with attempts left requeues the job; otherwise it fails with the error. */
export async function failJob(
  worker: WorkerPrincipal,
  jobId: string,
  claimToken: string | null,
  input: { error: string; retryable: boolean },
): Promise<FailResponse> {
  assertJobRef(jobId, claimToken);
  const rows = await prisma.$queryRaw<FailRow[]>`
    WITH cur AS (
      SELECT id, output_key, (${input.retryable} AND attempts < max_attempts) AS requeue
      FROM pipeline_jobs
      WHERE id = ${jobId} AND claimed_by = ${worker.id} AND claim_token = ${claimToken} AND status IN ('claimed', 'running')
      FOR UPDATE
    )
    UPDATE pipeline_jobs p
    SET status = (CASE WHEN cur.requeue THEN 'queued' ELSE 'failed' END)::"PipelineJobStatus",
        claimed_by = CASE WHEN cur.requeue THEN NULL ELSE p.claimed_by END,
        claim_token = CASE WHEN cur.requeue THEN NULL ELSE p.claim_token END,
        progress = CASE WHEN cur.requeue THEN 0 ELSE p.progress END,
        finished_at = CASE WHEN cur.requeue THEN NULL ELSE now() END,
        run_after = CASE WHEN cur.requeue THEN now() + make_interval(secs => ${RETRY_DELAY_SECONDS}::int * p.attempts) ELSE NULL END,
        heartbeat_at = NULL, error = ${input.error}, seq = p.seq + 1, updated_at = now(),
        output_version_id = NULL, output_key = NULL, output_mime_type = NULL, output_size = NULL
    FROM cur WHERE p.id = cur.id
    RETURNING p.status::text AS status, p.attempts, p.max_attempts, cur.output_key AS previous_key`;
  const row = rows[0];
  if (!row) throw await refusal(worker, jobId, claimToken);
  await dropObject(row.previous_key);
  log.info(row.status === 'queued' ? 'job requeued after a failure' : 'job failed', { jobId, attempts: Number(row.attempts) });
  return { status: row.status as 'queued' | 'failed', attempts: Number(row.attempts), maxAttempts: Number(row.max_attempts) };
}

/* ------------------------------------------------------------------ */
/* Sweeper                                                             */
/* ------------------------------------------------------------------ */

/** Error recorded when a claim's lease expires. */
export const LEASE_EXPIRED_ERROR = 'The worker stopped sending heartbeats';

/**
 * Claims whose last heartbeat is older than the lease go back to the queue
 * (claimable again after 30 s per attempt used), or fail once their
 * attempts are used up (the late worker then gets JOB_TERMINAL). Outputs
 * they uploaded are deleted. Also cancels jobs of trashed files and prunes
 * stale worker rows. Answers the counts.
 */
export async function sweepExpiredClaims(): Promise<{ requeued: number; failed: number; cancelled: number; pruned: number }> {
  const lease = leaseSeconds();
  const rows = await prisma.$queryRaw<{ id: string; status: string; previous_key: string | null }[]>`
    WITH expired AS (
      SELECT id, output_key, attempts >= max_attempts AS exhausted FROM pipeline_jobs
      WHERE status IN ('claimed', 'running') AND heartbeat_at < now() - make_interval(secs => ${lease}::int)
      FOR UPDATE SKIP LOCKED
    )
    UPDATE pipeline_jobs p
    SET status = (CASE WHEN e.exhausted THEN 'failed' ELSE 'queued' END)::"PipelineJobStatus",
        claimed_by = CASE WHEN e.exhausted THEN p.claimed_by ELSE NULL END,
        claim_token = CASE WHEN e.exhausted THEN p.claim_token ELSE NULL END,
        progress = CASE WHEN e.exhausted THEN p.progress ELSE 0 END,
        finished_at = CASE WHEN e.exhausted THEN now() ELSE NULL END,
        run_after = CASE WHEN e.exhausted THEN NULL ELSE now() + make_interval(secs => ${RETRY_DELAY_SECONDS}::int * p.attempts) END,
        heartbeat_at = NULL, error = ${LEASE_EXPIRED_ERROR}, seq = p.seq + 1, updated_at = now(),
        output_version_id = NULL, output_key = NULL, output_mime_type = NULL, output_size = NULL
    FROM expired e WHERE p.id = e.id
    RETURNING p.id, p.status::text AS status, e.output_key AS previous_key`;
  for (const r of rows) await dropObject(r.previous_key);
  const failed = rows.filter((r) => r.status === 'failed').length;
  const cancelled = await cancelJobsOfTrashedFiles();
  const pruned = await pruneWorkers();
  return { requeued: rows.length - failed, failed, cancelled, pruned };
}

/* ------------------------------------------------------------------ */
/* Jobs for people (GraphQL)                                           */
/* ------------------------------------------------------------------ */

export type JobRequestCode = 'KIND_UNKNOWN' | 'KIND_NOT_APPLICABLE' | 'JOB_TERMINAL' | 'NOT_FOUND';

/** Refusals of the GraphQL job API; resolvers turn them into coded errors. */
export class JobRequestError extends Error {
  readonly code: JobRequestCode;
  constructor(code: JobRequestCode, message: string) {
    super(message);
    this.name = 'JobRequestError';
    this.code = code;
  }
}

export type JobView = {
  id: string;
  kind: string;
  fileId: string;
  status: string;
  state: JobState;
  progress: number;
  attempts: number;
  maxAttempts: number;
  error: string | null;
  seq: number;
  outputVersionId: string | null;
  createdAt: Date;
  updatedAt: Date;
  finishedAt: Date | null;
};

const JOB_SELECT = {
  id: true,
  kind: true,
  mediaFileId: true,
  status: true,
  progress: true,
  attempts: true,
  maxAttempts: true,
  error: true,
  seq: true,
  outputVersionId: true,
  createdAt: true,
  updatedAt: true,
  finishedAt: true,
} as const;

type JobRow = {
  id: string;
  kind: string;
  mediaFileId: string;
  status: string;
  progress: number;
  attempts: number;
  maxAttempts: number;
  error: string | null;
  seq: bigint;
  outputVersionId: string | null;
  createdAt: Date;
  updatedAt: Date;
  finishedAt: Date | null;
};

/** Kinds served by a worker seen within the lease. */
export async function liveKinds(): Promise<Set<string>> {
  const since = new Date(Date.now() - leaseSeconds() * 1000);
  const workers = await prisma.pipelineWorker.findMany({ where: { revokedAt: null, lastSeen: { gte: since } }, select: { kinds: true } });
  return new Set(workers.flatMap((w) => w.kinds));
}

function view(row: JobRow, live: Set<string>): JobView {
  return {
    id: row.id,
    kind: row.kind,
    fileId: row.mediaFileId,
    status: row.status,
    state: jobState(row.status, live.has(row.kind)),
    progress: row.progress,
    attempts: row.attempts,
    maxAttempts: row.maxAttempts,
    // Only a done job hides its last error (a retry that succeeded).
    error: row.status === 'done' ? null : row.error,
    seq: Number(row.seq),
    outputVersionId: row.status === 'done' ? row.outputVersionId : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    finishedAt: row.finishedAt,
  };
}

/**
 * Queues `kind` for a ready, live file whose type the kind accepts. At most
 * one unfinished job per file and kind exists (a partial unique index): a
 * second request answers the open one (a double click queues once).
 */
export async function enqueueJob(input: { fileId: string; kind: string; createdById: string; params?: Record<string, unknown> }): Promise<JobView> {
  const kind = isKindName(input.kind)
    ? await prisma.pipelineKind.findUnique({ where: { name: input.kind }, select: { name: true, accepts: true } })
    : null;
  if (!kind) throw new JobRequestError('KIND_UNKNOWN', `Unknown job kind ${input.kind}`);
  const file = await prisma.mediaFile.findUnique({ where: { id: input.fileId }, select: { id: true, status: true, trashedAt: true, mimeType: true } });
  if (!file || file.status !== 'ready' || file.trashedAt) throw new JobRequestError('NOT_FOUND', 'File not found');
  if (!kindAccepts(kind.accepts, file.mimeType)) {
    throw new JobRequestError('KIND_NOT_APPLICABLE', `${kind.name} does not apply to ${file.mimeType} files`);
  }
  const params = JSON.stringify(input.params ?? {});
  for (let tries = 0; tries < 3; tries++) {
    const id = uuidv7();
    const inserted = await prisma.$queryRaw<{ id: string }[]>`
      INSERT INTO pipeline_jobs (id, kind, media_file_id, params, max_attempts, created_by)
      VALUES (${id}, ${kind.name}, ${file.id}, ${params}::jsonb, ${MAX_ATTEMPTS}::int, ${input.createdById})
      ON CONFLICT (media_file_id, kind) WHERE status IN ('queued', 'claimed', 'running') DO NOTHING
      RETURNING id`;
    const row = await prisma.pipelineJob.findFirst({
      where: inserted[0] ? { id } : { mediaFileId: file.id, kind: kind.name, status: { in: ['queued', 'claimed', 'running'] } },
      select: JOB_SELECT,
    });
    // The open job may have finished between the conflict and the read: try again.
    if (!row) continue;
    if (inserted[0]) log.info('job queued', { jobId: row.id, kind: row.kind, fileId: file.id });
    return view(row, await liveKinds());
  }
  throw new Error('enqueueJob: could not queue or find the open job');
}

const labelCache = { at: 0, labels: new Map<string, string | null>() };

/** The stored label of a kind (`pipeline_kinds.label`), cached for a minute; null when none. */
export async function kindLabel(kind: string): Promise<string | null> {
  if (Date.now() - labelCache.at > 60_000) {
    const rows = await prisma.pipelineKind.findMany({ select: { name: true, label: true } });
    labelCache.labels = new Map(rows.map((r) => [r.name, r.label]));
    labelCache.at = Date.now();
  }
  return labelCache.labels.get(kind) ?? null;
}

/** Cancels a queued, claimed or running job; its worker learns it through 409 JOB_TERMINAL. */
export async function cancelJob(jobId: string): Promise<JobView> {
  if (!isJobId(jobId)) throw new JobRequestError('NOT_FOUND', 'Job not found');
  const rows = await prisma.$queryRaw<{ previous_key: string | null }[]>`
    WITH cur AS (
      SELECT id, output_key FROM pipeline_jobs WHERE id = ${jobId} AND status IN ('queued', 'claimed', 'running') FOR UPDATE
    )
    UPDATE pipeline_jobs p
    SET status = 'cancelled', seq = p.seq + 1, heartbeat_at = NULL, finished_at = now(), updated_at = now(),
        output_version_id = NULL, output_key = NULL, output_mime_type = NULL, output_size = NULL
    FROM cur WHERE p.id = cur.id
    RETURNING cur.output_key AS previous_key`;
  const job = await prisma.pipelineJob.findUnique({ where: { id: jobId }, select: JOB_SELECT });
  if (!job) throw new JobRequestError('NOT_FOUND', 'Job not found');
  if (!rows[0]) throw new JobRequestError('JOB_TERMINAL', `The job is already ${job.status}`);
  await dropObject(rows[0].previous_key);
  log.info('job cancelled', { jobId });
  return view(job, await liveKinds());
}

export async function jobById(jobId: string): Promise<JobView | null> {
  if (!isJobId(jobId)) return null;
  const row = await prisma.pipelineJob.findUnique({ where: { id: jobId }, select: JOB_SELECT });
  return row ? view(row, await liveKinds()) : null;
}

/** Jobs of one file, newest first. */
export async function jobsForFile(fileId: string, limit = 20): Promise<JobView[]> {
  const rows = await prisma.pipelineJob.findMany({
    where: { mediaFileId: fileId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit,
    select: JOB_SELECT,
  });
  if (!rows.length) return [];
  const live = await liveKinds();
  return rows.map((r) => view(r, live));
}

/** Live workers and queued jobs for the status page. */
export async function pipelineCounts(): Promise<{ workers: number; queuedJobs: number }> {
  const since = new Date(Date.now() - leaseSeconds() * 1000);
  const [workers, queuedJobs] = await Promise.all([
    prisma.pipelineWorker.count({ where: { revokedAt: null, lastSeen: { gte: since } } }),
    prisma.pipelineJob.count({ where: { status: 'queued' } }),
  ]);
  return { workers, queuedJobs };
}
