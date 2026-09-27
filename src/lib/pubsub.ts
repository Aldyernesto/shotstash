import { RedisPubSub } from 'graphql-redis-subscriptions';
import { dfPublisher, dfSubscriber } from './dragonfly';

export const pubsub = new RedisPubSub({
  publisher: dfPublisher as any,
  subscriber: dfSubscriber as any,
});
