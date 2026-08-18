import { Redis } from 'ioredis';
import { env } from '../config/env.js';
import { logger } from './logger.js';

/**
 * BullMQ requires `maxRetriesPerRequest: null` — without it, ioredis aborts the
 * long-lived blocking commands BullMQ uses to wait for work.
 */
export function createRedisConnection(role: string): Redis {
  const client = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
  });

  client.on('error', (err) => logger.error({ err, role }, 'Redis connection error'));
  client.on('connect', () => logger.debug({ role }, 'Redis connected'));

  return client;
}

/** Shared connection for app-level Redis work (rate limiting), not for BullMQ. */
export const redis = createRedisConnection('app');

export async function pingRedis(): Promise<boolean> {
  try {
    return (await redis.ping()) === 'PONG';
  } catch {
    return false;
  }
}
