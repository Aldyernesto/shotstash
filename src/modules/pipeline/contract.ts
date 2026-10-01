/**
 * Worker contract v1 (Story 5.2): request parsing, error codes and the
 * shapes every `/api/v1/pipeline/*` route answers with. The types below are
 * the ones the routes' OpenAPI annotations name (`@body`, `@response`).
 *
 * Pure and alias-free: `node --test` imports it directly.
 */
import { PIPELINE_CONTRACT_VERSION } from '../../lib/pipelineContract.ts';
import { isKindName } from './kinds.ts';

/* ------------------------------------------------------------------ */
/* States                                                              */
/* ------------------------------------------------------------------ */

export const JOB_STATUSES = ['queued', 'claimed', 'running', 'done', 'failed', 'cancelled'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

/** A stored status, or the derived `waiting_for_worker` (queued, no live worker for the kind). */
export type JobState = JobStatus | 'waiting_for_worker';

export const TERMINAL_STATUSES: readonly JobStatus[] = ['done', 'failed', 'cancelled'];
/** Statuses a claim can act in. */
export const CLAIMED_STATUSES: readonly JobStatus[] = ['claimed', 'running'];

/** True when a kind that accepts `accepts` (MIME prefixes; empty or null means any) applies to a file of `mimeType`. */
export function kindAccepts(accepts: readonly string[] | null | undefined, mimeType: string): boolean {
  if (!accepts || !accepts.length) return true;
  const m = mimeType.toLowerCase();
  return accepts.some((prefix) => m.startsWith(prefix.toLowerCase()));
}

/** Seconds before a requeued job may be claimed again: 30 s per attempt used. */
export const RETRY_DELAY_SECONDS = 30;

export function isTerminal(status: string): boolean {
  return (TERMINAL_STATUSES as readonly string[]).includes(status);
}

export function jobState(status: string, kindHasLiveWorker: boolean): JobState {
  if (status === 'queued' && !kindHasLiveWorker) return 'waiting_for_worker';
  return status as JobStatus;
}

/** Attempts before a job fails for good. */
export const MAX_ATTEMPTS = 3;

/* ------------------------------------------------------------------ */
/* Errors                                                              */
/* ------------------------------------------------------------------ */

export type PipelineErrorCode =
  | 'INVALID_BODY'
  | 'BODY_TOO_LARGE'
  | 'WORKER_REVOKED'
  | 'FILE_GONE'
  | 'INVALID_MANIFEST'
  | 'CONTRACT_UNSUPPORTED'
  | 'KIND_UNKNOWN'
  | 'JOB_NOT_FOUND'
  | 'CLAIM_TOKEN_REQUIRED'
  | 'CLAIM_STALE'
  | 'JOB_TERMINAL'
  | 'FILE_NOT_FOUND'
  | 'INVALID_OUTPUT'
  | 'OUTPUT_TOO_LARGE'
  | 'OUTPUT_MISSING'
  | 'STORAGE_UNAVAILABLE';

/** A refused contract call: HTTP status plus a stable code (`{ code, message }`). */
export class PipelineFailure extends Error {
  readonly status: number;
  readonly code: PipelineErrorCode;
  constructor(status: number, code: PipelineErrorCode, message: string) {
    super(message);
    this.name = 'PipelineFailure';
    this.status = status;
    this.code = code;
  }
}

export type ErrorBody = {
  /** Stable error code, such as CLAIM_STALE. */
  code: string;
  /** English developer message; never shown to people. */
  message: string;
};

/* ------------------------------------------------------------------ */
/* Manifest                                                            */
/* ------------------------------------------------------------------ */

export type Manifest = {
  /** Display name of the worker, such as "reference-proxy". */
  name: string;
  /** Worker version, such as "0.1.0". */
  version: string;
  /** Kinds this worker processes, `<namespace>/<name>`. */
  kinds: string[];
  /** Contract major the worker speaks (1). A string such as "1.2" is read by its major. */
  contract: number | string;
};

export const MAX_KINDS_PER_WORKER = 32;

/** Major of a contract value: 1, "1", "1.4.0" are all 1; anything else is null. */
export function contractMajor(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return Math.trunc(value);
  if (typeof value === 'string' && /^\d{1,4}(\.\d+){0,2}$/.test(value.trim())) return Number(value.trim().split('.')[0]);
  return null;
}

export type ParsedManifest = { name: string; version: string; kinds: string[] };

const text = (v: unknown, max: number) => (typeof v === 'string' && v.trim() && v.trim().length <= max ? v.trim() : null);

/** Validates a manifest. The contract major is checked first (422), then the fields (400). */
export function parseManifest(value: unknown): ParsedManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new PipelineFailure(400, 'INVALID_MANIFEST', 'manifest must be an object');
  }
  const m = value as Record<string, unknown>;
  if (contractMajor(m.contract) !== PIPELINE_CONTRACT_VERSION) {
    throw new PipelineFailure(
      422,
      'CONTRACT_UNSUPPORTED',
      `This server speaks pipeline contract ${PIPELINE_CONTRACT_VERSION}; the manifest says ${JSON.stringify(m.contract ?? null)}`,
    );
  }
  const name = text(m.name, 100);
  const version = text(m.version, 50);
  if (!name) throw new PipelineFailure(400, 'INVALID_MANIFEST', 'manifest.name must be 1 to 100 characters');
  if (!version) throw new PipelineFailure(400, 'INVALID_MANIFEST', 'manifest.version must be 1 to 50 characters');
  if (!Array.isArray(m.kinds) || !m.kinds.length || m.kinds.length > MAX_KINDS_PER_WORKER) {
    throw new PipelineFailure(400, 'INVALID_MANIFEST', `manifest.kinds must list 1 to ${MAX_KINDS_PER_WORKER} kinds`);
  }
  const bad = m.kinds.find((k) => !isKindName(k));
  if (bad !== undefined) {
    throw new PipelineFailure(400, 'INVALID_MANIFEST', `manifest.kinds: ${JSON.stringify(bad)} is not <namespace>/<name>`);
  }
  return { name, version, kinds: [...new Set(m.kinds as string[])] };
}

/* ------------------------------------------------------------------ */
/* Request and response bodies                                         */
/* ------------------------------------------------------------------ */

/** Path parameters of `/api/v1/pipeline/jobs/:id/*`. */
export type JobPathParams = {
  /** Job id (UUID). */
  id: string;
};

export type RegisterRequest = { manifest: Manifest };

export type RegisterResponse = {
  /** Id of the new worker. */
  workerId: string;
  /** Per-worker token for `X-Worker-Token`. Shown once; keep it. */
  token: string;
  /** Contract major of the server (1). */
  contract: number;
  /** Send a heartbeat this often (seconds). */
  heartbeatSeconds: number;
  /** A claim without a heartbeat for this long is requeued (seconds). */
  leaseSeconds: number;
};

export type HeartbeatRequest = {
  manifest: Manifest;
  /** Ids of the jobs the worker is processing; their leases are refreshed. */
  activeJobIds?: string[];
};

export type HeartbeatResponse = {
  contract: number;
  /** Ids from `activeJobIds` this worker no longer holds (cancelled, requeued or gone): stop working on them. */
  lostJobIds: string[];
};

export type ClaimedJob = {
  id: string;
  kind: string;
  /** Free-form parameters given at enqueue (an object). */
  params: Record<string, unknown>;
  /** 1 for the first try, up to `maxAttempts`. */
  attempt: number;
  maxAttempts: number;
  /** Send as `X-Claim-Token` on every call for this job. */
  claimToken: string;
  input: {
    /** Path of the input stream (Range supported). */
    url: string;
    /** Name of the original as uploaded. */
    name: string;
    mimeType: string;
    size: number;
  };
};

export type ClaimResponse = { job: ClaimedJob };

export type ProgressRequest = {
  /** Percent done, 0 to 100. */
  progress: number;
};

export type ProgressResponse = { status: 'running'; progress: number; seq: number };

export type OutputResponse = { versionId: string; size: number; mimeType: string };

export type EmptyBody = Record<string, never>;

export type CompleteResponse = { status: 'done'; versionId: string };

export type FailRequest = {
  /** What went wrong (shown to people with access to the file). */
  error: string;
  /** True when another attempt may succeed (the job is requeued while attempts remain). */
  retryable?: boolean;
};

export type FailResponse = { status: 'queued' | 'failed'; attempts: number; maxAttempts: number };

export type ReleaseResponse = { status: 'queued'; attempts: number };

const JOB_ID_RE = /^[0-9a-f-]{36}$/i;

export function isJobId(value: unknown): value is string {
  return typeof value === 'string' && JOB_ID_RE.test(value);
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new PipelineFailure(400, 'INVALID_BODY', 'The body must be a JSON object');
  }
  return value as Record<string, unknown>;
}

export function parseRegister(body: unknown): ParsedManifest {
  return parseManifest(asObject(body).manifest);
}

export const MAX_ACTIVE_JOBS = 100;

export function parseHeartbeat(body: unknown): { manifest: ParsedManifest; activeJobIds: string[] } {
  const b = asObject(body);
  const manifest = parseManifest(b.manifest);
  const ids = b.activeJobIds ?? [];
  if (!Array.isArray(ids) || ids.length > MAX_ACTIVE_JOBS || !ids.every(isJobId)) {
    throw new PipelineFailure(400, 'INVALID_BODY', `activeJobIds must be a list of at most ${MAX_ACTIVE_JOBS} job ids`);
  }
  return { manifest, activeJobIds: [...new Set(ids as string[])] };
}

export function parseProgress(body: unknown): number {
  const p = asObject(body).progress;
  if (typeof p !== 'number' || !Number.isFinite(p) || p < 0 || p > 100) {
    throw new PipelineFailure(400, 'INVALID_BODY', 'progress must be a number from 0 to 100');
  }
  return Math.floor(p);
}

export const MAX_ERROR_LENGTH = 2000;

export function parseFail(body: unknown): { error: string; retryable: boolean } {
  const b = asObject(body);
  if (typeof b.error !== 'string' || !b.error.trim()) throw new PipelineFailure(400, 'INVALID_BODY', 'error must be a non-empty string');
  if (b.retryable !== undefined && typeof b.retryable !== 'boolean') {
    throw new PipelineFailure(400, 'INVALID_BODY', 'retryable must be true or false');
  }
  return { error: b.error.trim().slice(0, MAX_ERROR_LENGTH), retryable: b.retryable === true };
}

/* ------------------------------------------------------------------ */
/* Output                                                              */
/* ------------------------------------------------------------------ */

const EXT_RE = /^[a-z0-9]{1,10}$/;

/** Media types an output may have; anything else is refused (400 INVALID_OUTPUT). */
export const OUTPUT_MIME_TYPES: readonly string[] = [
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'image/jpeg',
  'image/png',
  'image/webp',
  'audio/mpeg',
  'audio/mp4',
  'audio/wav',
  'application/pdf',
  'application/json',
  'text/plain',
  'text/vtt',
];

/** `X-Output-Ext` and `Content-Type` of an output upload, normalised; throws INVALID_OUTPUT. */
export function parseOutputHeaders(ext: string | null, contentType: string | null): { ext: string; mimeType: string } {
  const e = (ext ?? '').trim().replace(/^\./, '').toLowerCase();
  if (!EXT_RE.test(e)) throw new PipelineFailure(400, 'INVALID_OUTPUT', 'X-Output-Ext must be 1 to 10 letters or digits, such as mp4');
  const mime = (contentType ?? '').split(';')[0].trim().toLowerCase();
  if (!OUTPUT_MIME_TYPES.includes(mime)) {
    throw new PipelineFailure(400, 'INVALID_OUTPUT', `Content-Type must be one of ${OUTPUT_MIME_TYPES.join(', ')}`);
  }
  return { ext: e, mimeType: mime };
}
