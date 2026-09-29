import { RedisPubSub } from 'graphql-redis-subscriptions';
import { dfPublisher, dfSubscriber } from './dragonfly';

// Created on first use so importing this module opens no connection.
let instance: RedisPubSub | null = null;

function get(): RedisPubSub {
  if (!instance) {
    instance = new RedisPubSub({
      publisher: dfPublisher() as any,
      subscriber: dfSubscriber() as any,
    });
  }
  return instance;
}

export const pubsub = {
  publish: (trigger: string, payload: unknown) => get().publish(trigger, payload),
  asyncIterator: <T>(triggers: string | string[]) => get().asyncIterator<T>(triggers),
};
