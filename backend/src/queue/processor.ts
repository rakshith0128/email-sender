import { DelayedError, type Job } from 'bullmq';
import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import { env } from '../config/env.js';
import { sendEmail } from '../services/mailer.js';
import {
  claimSendSlot,
  consumeToken,
  overflowRunAt,
  refundToken,
} from '../services/rateLimiter.js';
import { RECONCILE_JOB, type EmailJobPayload, type SendEmailJobData } from './emailQueue.js';
import { armReconciler, runReconcileSweep } from './reconciler.js';

/**
 * Atomically move a row from `scheduled` to `processing`.
 *
 * This single statement is the idempotency guarantee. Even if BullMQ delivers
 * the same job twice — a stalled-job recovery, a manual re-enqueue, a duplicate
 * from a reconciler race — only the first UPDATE matches, so only one worker
 * ever proceeds to the send.
 *
 * The second branch reclaims rows whose worker crashed mid-send: `processing`
 * with a lock older than STALE_LOCK_MS is treated as abandoned.
 *
 * @returns true if this caller now owns the row.
 */
async function claimEmailJob(emailJobId: string): Promise<boolean> {
  // All timestamps are supplied as JS Dates rather than SQL NOW().
  //
  // `locked_at` is `timestamp without time zone` (Prisma's default for
  // DateTime). Postgres NOW() is a timestamptz, so assigning it casts through
  // the session's TimeZone and stores *local* wall-clock time, which Prisma
  // then reads back as UTC. On a UTC+05:30 machine that put every lock 5.5
  // hours in the future, so `locked_at < cutoff` was never true and a worker
  // that died mid-send left its row stuck in `processing` permanently.
  // Passing Dates keeps this consistent with every other write in the app.
  const now = new Date();
  const staleCutoff = new Date(now.getTime() - env.STALE_LOCK_MS);

  const affected = await prisma.$executeRaw`
    UPDATE email_jobs
       SET status     = 'processing'::"EmailStatus",
           attempts   = attempts + 1,
           locked_at  = ${now},
           updated_at = ${now}
     WHERE id = ${emailJobId}
       AND (
             status = 'scheduled'::"EmailStatus"
          OR (    status = 'processing'::"EmailStatus"
              AND locked_at < ${staleCutoff})
       )
  `;

  return affected === 1;
}

/**
 * The worker processor.
 *
 * Order of operations is deliberate:
 *   1. load + short-circuit on terminal status
 *   2. rate-limit check   (cheap, and must not mutate the row if it fails)
 *   3. atomic claim       (the idempotency gate)
 *   4. send
 * Checking the rate limit before claiming keeps a throttled job in `scheduled`,
 * so its status never flickers to `processing` and back.
 */
export async function processJob(job: Job<EmailJobPayload>, token?: string): Promise<void> {
  if (job.name === RECONCILE_JOB) {
    await runReconcileSweep();
    await armReconciler();
    return;
  }

  const { emailJobId } = job.data as SendEmailJobData;

  const row = await prisma.emailJob.findUnique({
    where: { id: emailJobId },
    include: { sender: true, campaign: true },
  });

  if (!row) {
    logger.warn({ emailJobId }, 'Job references a row that no longer exists — dropping');
    return;
  }

  if (row.status === 'sent' || row.status === 'cancelled' || row.status === 'failed') {
    logger.debug({ emailJobId, status: row.status }, 'Already terminal — skipping');
    return;
  }

  // ── Minimum interval between sends ────────────────────────────────────────
  // Checked before the hourly quota so an early job defers without consuming
  // any of the sender's allowance.
  const waitMs = await claimSendSlot(row.senderId, Date.now());
  if (waitMs > 0) {
    // Defer by the outstanding wait plus a sequence-derived offset, so a burst
    // of jobs comes back in its original order rather than racing.
    const runAt = new Date(Date.now() + waitMs + (row.seq % 50) * env.ORDER_STEP_MS);

    await prisma.emailJob.update({
      where: { id: emailJobId },
      data: { scheduledAt: runAt },
    });

    logger.debug({ emailJobId, waitMs }, 'Too soon since last send - deferring');

    await job.moveToDelayed(runAt.getTime(), token);
    throw new DelayedError();
  }

  // ── Rate limit: per sender, per hour ──────────────────────────────────────
  // The effective cap is the tighter of the sender's own quota and whatever the
  // user asked for on this campaign.
  const effectiveLimit = Math.min(row.sender.maxEmailsPerHour, row.campaign.hourlyLimit);
  const now = new Date();
  const allowed = await consumeToken(row.senderId, effectiveLimit, now);

  if (!allowed) {
    // Over the cap. The job is NOT dropped and NOT failed — it is pushed into
    // the next hour window, offset by its sequence number so the batch comes
    // back in its original order.
    const runAt = overflowRunAt(row.seq, now);

    await prisma.emailJob.update({
      where: { id: emailJobId },
      data: { status: 'scheduled', scheduledAt: runAt, lockedAt: null },
    });

    logger.info(
      { emailJobId, senderId: row.senderId, effectiveLimit, runAt },
      'Hourly limit reached — rescheduled into next window',
    );

    await job.moveToDelayed(runAt.getTime(), token);
    // Tells BullMQ this job was deferred, not completed and not failed.
    throw new DelayedError();
  }

  // ── Claim ─────────────────────────────────────────────────────────────────
  const claimed = await claimEmailJob(emailJobId);
  if (!claimed) {
    // Someone else owns it. Hand the rate-limit token back so the loser of the
    // race doesn't silently burn a slot out of the hour's quota.
    await refundToken(row.senderId, now);
    logger.debug({ emailJobId }, 'Lost claim race — skipping');
    return;
  }

  // ── Send ──────────────────────────────────────────────────────────────────
  // Logged at the moment the SMTP call starts. Send *initiation* is what the
  // minimum-interval gate controls; completion time also carries variable
  // network latency, so it is not the right thing to measure spacing against.
  logger.debug({ emailJobId, seq: row.seq, at: Date.now() }, 'Send initiated');

  try {
    const result = await sendEmail({
      sender: row.sender,
      to: row.recipient,
      subject: row.subject,
      body: row.body,
    });

    await prisma.emailJob.update({
      where: { id: emailJobId },
      data: {
        status: 'sent',
        sentAt: new Date(),
        messageId: result.messageId,
        previewUrl: result.previewUrl,
        lockedAt: null,
        error: null,
      },
    });

    logger.info({ emailJobId, to: row.recipient, sender: row.sender.email }, 'Email sent');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    // Back to `scheduled` so a BullMQ retry can re-claim it. If BullMQ has no
    // attempts left, the worker's `failed` handler marks it terminally failed.
    await prisma.emailJob.update({
      where: { id: emailJobId },
      data: { status: 'scheduled', lockedAt: null, error: message },
    });

    logger.error({ emailJobId, err: message }, 'Send failed — will retry if attempts remain');
    throw err;
  }
}

/**
 * Called from the worker's `failed` event once BullMQ has exhausted retries.
 * Separated from the catch above because only BullMQ knows authoritatively that
 * an attempt was the last one.
 */
export async function markPermanentlyFailed(emailJobId: string, reason: string): Promise<void> {
  await prisma.emailJob.updateMany({
    where: { id: emailJobId, status: { in: ['scheduled', 'processing'] } },
    data: { status: 'failed', error: reason, lockedAt: null },
  });
  logger.error({ emailJobId, reason }, 'Email permanently failed — retries exhausted');
}
