/**
 * Story 8.2: the nightly demo reset, as a pure function the server calls
 * every minute. The reset is due in the 03:00 hour of the instance time zone
 * (`SHOTSTASH_DEFAULT_TIMEZONE`), once per local date:
 *
 *   - it runs under the demo lock (shared with `node dist/demo.js seed|reset`);
 *   - a per-date marker in Dragonfly (`SET NX EX`) is written only after a
 *     successful run, so a failed run retries on the next tick of the same
 *     hour, and every instance sees that the date is done;
 *   - without a ready lock store it skips with a warning: never "reset
 *     everywhere" on a multi-instance demo. A server down for the whole hour
 *     skips that night.
 *
 * Pure apart from the injected clock, store, lock runner and reset, and
 * alias-free for `node --test` (type imports are erased).
 */
import type { LockResult } from '@/lib/lock';

export const DEMO_RESET_HOUR = 3;
/** One lock for the nightly reset and the CLI seed and reset. */
export const DEMO_LOCK = 'shotstash:lock:demo-reset';
export const DEMO_LOCK_TTL_MS = 30 * 60 * 1000;
/** Marker key of a finished nightly reset, per local date. */
export const demoMarkerKey = (date: string) => `shotstash:demo-reset:done:${date}`;
const MARKER_TTL_SECONDS = 2 * 24 * 60 * 60;

/** Local date (YYYY-MM-DD) and hour of `now` in `timeZone`. */
export function localClock(now: Date, timeZone: string): { date: string; hour: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return { date: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')) };
}

/** The local date to reset for when `now` is in the reset hour, else null. */
export function demoResetDate(now: Date, timeZone: string): string | null {
  const { date, hour } = localClock(now, timeZone);
  return hour === DEMO_RESET_HOUR ? date : null;
}

/** The marker commands the tick needs (an ioredis client fits). */
export type MarkerStore = {
  status: string;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ex: 'EX', seconds: number, nx: 'NX'): Promise<unknown>;
};

export type NightlyOutcome = 'not-due' | 'done' | 'unavailable' | 'held' | 'ran' | 'failed';

export type NightlyDeps = {
  now: Date;
  timeZone: string;
  store: MarkerStore | null;
  /** Runs `fn` under DEMO_LOCK (withLock in the server, withLockOn in tests). */
  runLocked: <T>(fn: () => Promise<T>) => Promise<LockResult<T>>;
  reset: () => Promise<unknown>;
};

/** One tick of the nightly reset. Never throws; a failed reset answers `failed` with the error. */
export async function nightlyDemoTick(deps: NightlyDeps): Promise<{ outcome: NightlyOutcome; date?: string; error?: unknown }> {
  const date = demoResetDate(deps.now, deps.timeZone);
  if (!date) return { outcome: 'not-due' };
  const store = deps.store;
  if (!store || store.status !== 'ready') return { outcome: 'unavailable', date };
  try {
    if (await store.get(demoMarkerKey(date))) return { outcome: 'done', date };
  } catch {
    return { outcome: 'unavailable', date };
  }
  let error: unknown = null;
  const locked = await deps.runLocked(async () => {
    // Another instance may have finished while this one waited for the lock.
    if (await store.get(demoMarkerKey(date)).catch(() => null)) return 'done' as const;
    try {
      await deps.reset();
    } catch (err) {
      error = err;
      return 'failed' as const;
    }
    // A lost marker only means one more reset in the same hour.
    await store.set(demoMarkerKey(date), '1', 'EX', MARKER_TTL_SECONDS, 'NX').catch(() => undefined);
    return 'ran' as const;
  });
  if (!locked.ran) return { outcome: locked.reason, date };
  return locked.value === 'failed' ? { outcome: 'failed', date, error } : { outcome: locked.value, date };
}
