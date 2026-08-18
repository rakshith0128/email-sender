import { Queue } from 'bullmq';
import { createRedisConnection } from '../lib/redis.js';
import { env } from '../config/env.js';

export const QUEUE_NAME = 'email-queue';

/** Normal send job: one email to one recipient. */
export const SEND_EMAIL_JOB = 'send-email';
/**
 * Maintenance tick. NOT a cron and NOT a BullMQ repeatable/cron job — it is an
 * ordinary delayed job that re-enqueues the next one when it runs. See
 * reconciler.ts.
 */
export const RECONCILE_JOB = 'reconcile-sweep';

export interface SendEmailJobData {
  emailJobId: string;
}

export type EmailJobPayload = SendEmailJobData | Record<string, never>;

export const emailQueue = new Queue<EmailJobPayload>(QUEUE_NAME, {
  connection: createRedisConnection('queue'),
  defaultJobOptions: {
    attempts: env.JOB_ATTEMPTS,
    backoff: { type: 'exponential', delay: env.JOB_BACKOFF_MS },
    // Keep Redis bounded — the DB, not Redis, is the audit trail.
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 5000 },
  },
});

export async function closeQueue(): Promise<void> {
  await emailQueue.close();
}
