import { randomUUID } from 'node:crypto';
import type { EmailJob } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import { env } from '../config/env.js';
import { emailQueue, SEND_EMAIL_JOB } from './emailQueue.js';
import { assignSender, getActiveSenders, NoSendersError } from '../services/senders.js';

/**
 * Chunk size for both the DB insert and the Redis enqueue. Large enough that
 * 1000 recipients is a couple of round trips, small enough to stay well under
 * Postgres parameter limits and to avoid one giant Redis pipeline.
 */
const CHUNK_SIZE = 500;

export interface ScheduleCampaignInput {
  userId: string;
  subject: string;
  body: string;
  recipients: string[];
  startAt: Date;
  delayMs: number;
  hourlyLimit: number;
}

export interface ScheduleCampaignResult {
  campaignId: string;
  totalScheduled: number;
  firstScheduledAt: Date;
  lastScheduledAt: Date;
  senderCount: number;
}

/**
 * Fan a campaign out into one EmailJob row per recipient and register a BullMQ
 * delayed job for each.
 *
 * Ordering matters here: rows are committed to Postgres *before* anything is
 * enqueued. If the process dies between the two, the reconciler finds the rows
 * on next boot and enqueues them. The reverse order would risk a job pointing
 * at a row that never existed.
 */
export async function scheduleCampaign(
  input: ScheduleCampaignInput,
): Promise<ScheduleCampaignResult> {
  const { userId, subject, body, recipients, startAt, delayMs, hourlyLimit } = input;

  const senders = await getActiveSenders();
  if (senders.length === 0) throw new NoSendersError();

  // Pre-generate ids so the same value is the primary key AND the BullMQ jobId.
  // That single shared identifier is what makes enqueueing idempotent.
  const rows = recipients.map((recipient, seq) => ({
    id: randomUUID(),
    campaignId: '', // filled in below
    senderId: assignSender(senders, seq).id,
    recipient,
    subject,
    body,
    seq,
    scheduledAt: new Date(startAt.getTime() + seq * delayMs),
  }));

  const campaign = await prisma.$transaction(async (tx) => {
    const created = await tx.campaign.create({
      data: {
        userId,
        subject,
        body,
        startAt,
        delayMs,
        hourlyLimit,
        totalRecipients: recipients.length,
      },
    });

    for (const row of rows) row.campaignId = created.id;

    for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
      await tx.emailJob.createMany({ data: rows.slice(i, i + CHUNK_SIZE) });
    }

    return created;
  });

  await enqueueEmailJobs(rows);

  const firstScheduledAt = rows[0]?.scheduledAt ?? startAt;
  const lastScheduledAt = rows[rows.length - 1]?.scheduledAt ?? startAt;

  logger.info(
    {
      campaignId: campaign.id,
      total: rows.length,
      senders: senders.length,
      firstScheduledAt,
      lastScheduledAt,
    },
    'Campaign scheduled',
  );

  return {
    campaignId: campaign.id,
    totalScheduled: rows.length,
    firstScheduledAt,
    lastScheduledAt,
    senderCount: senders.length,
  };
}

type EnqueueableJob = Pick<EmailJob, 'id' | 'scheduledAt'>;

/**
 * Register delayed jobs. Used by both the scheduler and the reconciler — which
 * is safe precisely because `jobId` is the row id: BullMQ ignores an add() for
 * an id that already exists, so a double call cannot produce a double send.
 */
export async function enqueueEmailJobs(jobs: EnqueueableJob[]): Promise<number> {
  const now = Date.now();
  let enqueued = 0;

  for (let i = 0; i < jobs.length; i += CHUNK_SIZE) {
    const chunk = jobs.slice(i, i + CHUNK_SIZE);
    await emailQueue.addBulk(
      chunk.map((job) => ({
        name: SEND_EMAIL_JOB,
        data: { emailJobId: job.id },
        opts: {
          jobId: job.id,
          // Overdue jobs get delay 0 and run immediately.
          delay: Math.max(0, job.scheduledAt.getTime() - now),
          attempts: env.JOB_ATTEMPTS,
          backoff: { type: 'exponential' as const, delay: env.JOB_BACKOFF_MS },
          removeOnComplete: { count: 1000 },
          removeOnFail: { count: 5000 },
        },
      })),
    );
    enqueued += chunk.length;
  }

  return enqueued;
}
