import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { pingRedis } from '../lib/redis.js';
import { emailQueue } from '../queue/emailQueue.js';
import { env } from '../config/env.js';

export const healthRouter = Router();

/**
 * A dependency that is *down* often doesn't fail fast — it hangs while the
 * driver retries. Racing each check against a short timer means /health always
 * answers, which is the whole point of a health check.
 */
const CHECK_TIMEOUT_MS = 2000;

function withTimeout<T>(promise: Promise<T>, fallback: T): Promise<T> {
  return Promise.race([
    promise.catch(() => fallback),
    new Promise<T>((resolve) => {
      const timer = setTimeout(() => resolve(fallback), CHECK_TIMEOUT_MS);
      // Don't let a pending timer hold the process open on shutdown.
      if (typeof timer.unref === 'function') timer.unref();
    }),
  ]);
}

/**
 * Liveness + a snapshot of queue depth. Deliberately unauthenticated so it can
 * be checked before Google credentials are configured.
 */
healthRouter.get('/', async (_req, res) => {
  const [dbOk, redisOk] = await Promise.all([
    withTimeout(
      prisma.$queryRaw`SELECT 1`.then(() => true),
      false,
    ),
    withTimeout(pingRedis(), false),
  ]);

  const queue = redisOk
    ? await withTimeout(
        emailQueue.getJobCounts('waiting', 'active', 'delayed', 'completed', 'failed'),
        {} as Record<string, number>,
      )
    : {};

  const healthy = dbOk && redisOk;

  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'ok' : 'degraded',
    checks: { database: dbOk, redis: redisOk },
    queue,
    config: {
      workerConcurrency: env.WORKER_CONCURRENCY,
      minSendIntervalMs: env.MIN_SEND_INTERVAL_MS,
      globalLimiterMax: env.GLOBAL_LIMITER_MAX,
      maxEmailsPerHourPerSender: env.MAX_EMAILS_PER_HOUR_PER_SENDER,
      reconcileIntervalMs: env.RECONCILE_INTERVAL_MS,
    },
    timestamp: new Date().toISOString(),
  });
});
