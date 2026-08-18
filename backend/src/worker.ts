import { Worker, UnrecoverableError } from 'bullmq';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { createRedisConnection } from './lib/redis.js';
import { prisma } from './lib/prisma.js';
import { closeAllTransports } from './services/mailer.js';
import { QUEUE_NAME, SEND_EMAIL_JOB, type EmailJobPayload } from './queue/emailQueue.js';
import { markPermanentlyFailed, processJob } from './queue/processor.js';
import { bootstrapReconciler } from './queue/reconciler.js';

/**
 * Worker process. Runs separately from the API so that stopping the web server
 * does not stop delivery — and so the restart demo actually proves the queue,
 * not the HTTP layer, is driving the schedule.
 *
 * Two independent throttles are configured here:
 *
 *  - `concurrency`  — how many sends this process runs in parallel.
 *  - `limiter`      — how many jobs may start per unit time, tracked in Redis
 *                     and therefore shared by every worker process.
 *
 * With the defaults (max: 1 per 2000ms) the limiter is the binding constraint,
 * producing a hard 2-second minimum gap between any two emails system-wide.
 * Raising GLOBAL_LIMITER_MAX is what lets WORKER_CONCURRENCY actually
 * parallelize; this trade-off is documented in the README.
 */
const worker = new Worker<EmailJobPayload>(QUEUE_NAME, processJob, {
  connection: createRedisConnection('worker'),
  concurrency: env.WORKER_CONCURRENCY,
  limiter: {
    max: env.GLOBAL_LIMITER_MAX,
    duration: env.MIN_SEND_INTERVAL_MS,
  },
});

worker.on('ready', () => {
  logger.info(
    {
      queue: QUEUE_NAME,
      concurrency: env.WORKER_CONCURRENCY,
      limiter: `${env.GLOBAL_LIMITER_MAX} job(s) / ${env.MIN_SEND_INTERVAL_MS}ms`,
      hourlyCapPerSender: env.MAX_EMAILS_PER_HOUR_PER_SENDER,
    },
    'Worker ready',
  );
});

worker.on('completed', (job) => {
  logger.debug({ jobId: job.id, name: job.name }, 'Job completed');
});

/**
 * BullMQ is the authority on whether an attempt was the final one, so the
 * terminal `failed` transition is applied here rather than inside the
 * processor's catch block.
 */
worker.on('failed', (job, err) => {
  if (!job) {
    logger.error({ err }, 'Job failed with no job reference');
    return;
  }

  const attemptsAllowed = job.opts.attempts ?? 1;
  const exhausted = job.attemptsMade >= attemptsAllowed || err instanceof UnrecoverableError;

  logger.warn(
    { jobId: job.id, attemptsMade: job.attemptsMade, attemptsAllowed, err: err.message },
    'Job attempt failed',
  );

  if (exhausted && job.name === SEND_EMAIL_JOB) {
    const emailJobId = (job.data as { emailJobId?: string }).emailJobId;
    if (emailJobId) {
      void markPermanentlyFailed(emailJobId, err.message).catch((updateErr) =>
        logger.error({ updateErr, emailJobId }, 'Could not mark job failed'),
      );
    }
  }
});

worker.on('error', (err) => logger.error({ err }, 'Worker error'));

// The worker also participates in reconciliation, so a deployment running only
// workers (no API) still self-heals.
await bootstrapReconciler();

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'Shutting down worker');
  try {
    // `close()` waits for in-flight jobs to finish rather than killing them
    // mid-send, so a restart never leaves a half-sent email.
    await worker.close();
    await closeAllTransports();
    await prisma.$disconnect();
  } catch (err) {
    logger.error({ err }, 'Error during worker shutdown');
  } finally {
    process.exit(0);
  }
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
