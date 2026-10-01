/**
 * Realtime transport (Story 5.5): Dragonfly pub/sub through the existing
 * `graphql-redis-subscriptions` instance. Every app process has its own
 * subscriber connection, so an event published by one process reaches the
 * subscribers of every process.
 */
import { pubsub } from '@/lib/pubsub';
import { errMessage, logger } from '@/lib/logger';
import { afterCommitWith, publishAll, type Outgoing, type RealtimeEvent } from './events.ts';

const log = logger('realtime');

const onError = (err: unknown) => log.warn('publish failed', { err: errMessage(err) });

function send(channel: string, event: RealtimeEvent) {
  return pubsub.publish(channel, event);
}

/**
 * Publishes events of a write that has ALREADY committed. Call it only after
 * the statement or `$transaction` resolved; prefer `afterCommit` around the
 * write. Never throws.
 */
export function publishAfterCommit(items: Outgoing | Outgoing[]): Promise<void> {
  return publishAll(send, Array.isArray(items) ? items : [items], onError);
}

/** Runs the write, then (only when it resolved) publishes the events built from its result. */
export function afterCommit<T>(
  write: Promise<T> | (() => Promise<T>),
  events: (result: T) => Outgoing | Outgoing[] | null | undefined | Promise<Outgoing | Outgoing[] | null | undefined>,
): Promise<T> {
  return afterCommitWith(send, write, events, onError);
}

/** Raw messages of one channel (thin events); wrap them with `authorizedStream`. */
export function channelMessages(channel: string): AsyncIterator<unknown> {
  return pubsub.asyncIterator<unknown>(channel);
}
