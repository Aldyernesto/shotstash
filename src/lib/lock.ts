/**
 * Single-holder lock on Dragonfly (Story 2.8: the trash sweeper).
 *
 * Acquire: `SET key token NX PX ttlMs`. Release: a compare-and-delete script,
 * so a lock that expired and was taken over by another instance is never
 * removed by the previous holder. Pure (the client is passed in):
 * `node --test` runs it against a fake client.
 */
import { randomBytes } from 'crypto';

export type LockClient = {
  status: string;
  set(key: string, value: string, px: 'PX', ttlMs: number, nx: 'NX'): Promise<unknown>;
  eval(script: string, numKeys: number, ...args: (string | number)[]): Promise<unknown>;
};

/** `unavailable`: no ready lock store (the caller decides); `held`: another instance has it. */
export type LockResult<T> = { ran: true; value: T } | { ran: false; reason: 'unavailable' | 'held' };

export const RELEASE_LOCK_LUA = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end`;

export async function withLockOn<T>(
  client: LockClient | null,
  key: string,
  ttlMs: number,
  fn: () => Promise<T>,
): Promise<LockResult<T>> {
  if (!client || client.status !== 'ready') return { ran: false, reason: 'unavailable' };
  const token = `${process.pid}-${randomBytes(12).toString('hex')}`;
  let got: unknown;
  try {
    got = await client.set(key, token, 'PX', ttlMs, 'NX');
  } catch {
    return { ran: false, reason: 'unavailable' };
  }
  if (got !== 'OK') return { ran: false, reason: 'held' };
  try {
    return { ran: true, value: await fn() };
  } finally {
    await client.eval(RELEASE_LOCK_LUA, 1, key, token).catch(() => {});
  }
}
