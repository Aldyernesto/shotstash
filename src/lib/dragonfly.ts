import Redis from 'ioredis';
import { withLockOn, type LockClient, type LockResult } from './lock';
import { config } from './config';
import { errMessage, logger } from './logger';

// Dragonfly (Redis-compatible) clients. Created on first use, never at
// import: importing this module reads no configuration and opens no socket.
const log = logger('dragonfly');

type Clients = { client: Redis; subscriber: Redis; publisher: Redis };

const globalForDragonfly = globalThis as unknown as { shotstashDragonfly?: Clients };

function create(): Clients {
  const c = config();
  const options = { host: c.DRAGONFLY_HOST, port: c.DRAGONFLY_PORT, password: c.DRAGONFLY_PASSWORD };
  const client = new Redis({
    ...options,
    // Reconnect with a growing delay, capped at 2 s.
    retryStrategy: (times) => Math.min(times * 50, 2000),
  });
  client.on('connect', () => log.info('connected', { host: options.host, port: options.port }));
  client.on('error', (err) => log.error('connection error', { err: errMessage(err) }));
  // Pub/Sub requires separate connections in Redis/Dragonfly. Their errors
  // repeat the main client's, so they log at debug level only.
  const subscriber = new Redis(options);
  const publisher = new Redis(options);
  for (const [name, conn] of [['subscriber', subscriber], ['publisher', publisher]] as const) {
    conn.on('error', (err) => log.debug('connection error', { connection: name, err: errMessage(err) }));
  }
  return { client, subscriber, publisher };
}

function clients(): Clients {
  if (!globalForDragonfly.shotstashDragonfly) globalForDragonfly.shotstashDragonfly = create();
  return globalForDragonfly.shotstashDragonfly;
}

/** Client for regular commands (get, set, eval). */
export function dfClient(): Redis {
  return clients().client;
}

/** Connection for subscriptions. */
export function dfSubscriber(): Redis {
  return clients().subscriber;
}

/** Connection for publishing. */
export function dfPublisher(): Redis {
  return clients().publisher;
}

/** Runs `fn` only on the instance holding `key` (see `src/lib/lock.ts`). */
export function withLock<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<LockResult<T>> {
  return withLockOn(dfClient() as unknown as LockClient, key, ttlMs, fn);
}

/** Shutdown: closes the connections when they were opened (never opens them). */
export async function closeDragonfly(): Promise<void> {
  const c = globalForDragonfly.shotstashDragonfly;
  if (!c) return;
  await Promise.allSettled([c.client.quit(), c.subscriber.quit(), c.publisher.quit()]);
}
