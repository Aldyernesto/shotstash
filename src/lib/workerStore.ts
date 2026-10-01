/**
 * Worker credentials (Story 5.2) for the `worker` auth mode of
 * `defineRoute`. A worker registers once with the shared
 * `WORKER_BOOTSTRAP_TOKEN` and receives its own token, which is stored only
 * as a SHA-256 hash; every later call carries it in `X-Worker-Token`.
 *
 * Tokens are never logged. Revoked workers authenticate as nobody (401).
 */
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import prisma from '@/lib/prisma';
import { config } from '@/lib/config';

export type WorkerPrincipal = {
  id: string;
  name: string;
  version: string;
  /** Kinds the worker registered; claims are filtered by these, never by a request parameter. */
  kinds: string[];
};

/** `last_seen` is written at most this often per worker. */
const LAST_SEEN_EVERY_MS = 5_000;

const TOKEN_PREFIX = 'ssw_';

export function newWorkerToken(): string {
  return TOKEN_PREFIX + randomBytes(32).toString('base64url');
}

export function hashWorkerToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Constant-time comparison of two secrets of any length. */
export function secretsEqual(given: string, expected: string): boolean {
  const a = createHash('sha256').update(given, 'utf8').digest();
  const b = createHash('sha256').update(expected, 'utf8').digest();
  return timingSafeEqual(a, b) && given.length === expected.length;
}

/** True when the bootstrap token is configured. */
export function bootstrapConfigured(): boolean {
  return Boolean(config().WORKER_BOOTSTRAP_TOKEN);
}

/** True when `given` equals `WORKER_BOOTSTRAP_TOKEN` (false when none is configured). */
export function bootstrapTokenMatches(given: string | null | undefined): boolean {
  const expected = config().WORKER_BOOTSTRAP_TOKEN;
  if (!expected || typeof given !== 'string' || !given) return false;
  return secretsEqual(given, expected);
}

/** Resolves a worker token to a live (not revoked) worker and moves its `last_seen`. */
export async function validateWorkerToken(token: string | null | undefined): Promise<WorkerPrincipal | null> {
  if (!token || token.length > 256) return null;
  const row = await prisma.pipelineWorker.findUnique({
    where: { tokenHash: hashWorkerToken(token) },
    select: { id: true, name: true, version: true, kinds: true, revokedAt: true, lastSeen: true },
  });
  if (!row || row.revokedAt) return null;
  if (Date.now() - row.lastSeen.getTime() >= LAST_SEEN_EVERY_MS) {
    await prisma.pipelineWorker.update({ where: { id: row.id }, data: { lastSeen: new Date() } });
  }
  return { id: row.id, name: row.name, version: row.version, kinds: row.kinds };
}
