import Redis from 'ioredis';

// Create a Dragonfly (Redis-compatible) client
// Dragonfly is a drop-in replacement for Redis with much higher throughput
const dragonflyHost = process.env.DRAGONFLY_HOST || '127.0.0.1';
const dragonflyPort = parseInt(process.env.DRAGONFLY_PORT || '6379', 10);
const dragonflyPassword = process.env.DRAGONFLY_PASSWORD || undefined;

// Create main client for regular commands (set, get, del)
export const dfClient = new Redis({
  host: dragonflyHost,
  port: dragonflyPort,
  password: dragonflyPassword,
  retryStrategy: (times) => {
    // Retry connection logic
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
});

dfClient.on('connect', () => {
  console.log(`[Dragonfly] Connected successfully to ${dragonflyHost}:${dragonflyPort}`);
});

dfClient.on('error', (err) => {
  console.error('[Dragonfly] Connection error:', err);
});

// Pub/Sub requires separate connections in Redis/Dragonfly
export const dfSubscriber = new Redis({
  host: dragonflyHost,
  port: dragonflyPort,
  password: dragonflyPassword,
});

export const dfPublisher = new Redis({
  host: dragonflyHost,
  port: dragonflyPort,
  password: dragonflyPassword,
});
