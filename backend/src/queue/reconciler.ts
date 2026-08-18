import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import { env } from '../config/env.js';
import { redis } from '../lib/redis.js';
import { emailQueue, RECONCILE_JOB } from './emailQueue.js';
import { enqueueEmailJobs } from './scheduler.js';

/**
 * Restart survival.
 *
 * Redis with AOF already persists the delayed set, so an ordinary process
 * restart resumes on its own. This exists for the harder cases: Redis was
 * flushed or started empty, the process died between the DB commit and the
 * enqueue, or a worker crashed mid-send and left a row locked.
 *
 * Postgres is the source of truth. The sweep asks: for every row that still
 * needs sending, does a BullMQ job exist? If not, recreate it with the correct
 * remaining delay. Because the jobId is the row id, re-adding something that
 * *does* exist is a no-op — so this can never cause a double send.
 */

/** How many pending rows to examine per sweep. */
const SWEEP_BATCH = 2000;

export interface ReconcileResult {
  staleLocksReleased: number;
  missingJobsRequeued: number;
  pendingChecked: number;
}

export async function runReconcileSweep(): Promise<ReconcileResult> {
  const staleLocksReleased = await releaseStaleLocks();

  // Overdue rows first — those are the ones a user is actively waiting on.
  const pending = await prisma.emailJob.findMany({
    where: { status: 'scheduled' },
    select: { id: true, scheduledAt: true },
    orderBy: { scheduledAt: 'asc' },
    take: SWEEP_BATCH,
  });

  if (pending.length === 0) {
    return { staleLocksReleased, missingJobsRequeued: 0, pendingChecked: 0 };
  }

  // For each pending row, ask Redis about its job in a single pipelined pass.
  //
  // A plain EXISTS is not enough: `removeOnComplete` retains finished jobs, so
  // a job that already ran to completion still has a hash. If the row is back
  // in `scheduled` (a lost claim race, or a lock released after a crash) that
  // retained hash would make the sweep believe the job is still pending and
  // skip it forever.
  //
  // `timestamp` is written when a job is created and `finishedOn` when it
  // settles, so the pair distinguishes all three cases:
  //   [null, null] -> no job at all      -> re-arm
  //   [ts,   null] -> job still pending  -> leave alone
  //   [ts,   fin ] -> job already ran    -> drop the husk and re-arm
  const pipeline = redis.pipeline();
  for (const row of pending) pipeline.hmget(emailQueue.toKey(row.id), 'timestamp', 'finishedOn');
  const results = await pipeline.exec();

  const missing: typeof pending = [];
  const finished: typeof pending = [];

  pending.forEach((row, index) => {
    const entry = results?.[index];
    if (!entry) return;
    const [err, value] = entry;
    if (err) return;

    const [timestamp, finishedOn] = (value as Array<string | null>) ?? [null, null];
    if (timestamp === null) missing.push(row);
    else if (finishedOn !== null) finished.push(row);
  });

  // A retained job hash blocks re-adding the same id, so clear it first.
  for (const row of finished) {
    await emailQueue.remove(row.id).catch(() => undefined);
  }

  const toRearm = [...missing, ...finished].sort(
    (a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime(),
  );

  let missingJobsRequeued = 0;
  if (toRearm.length > 0) {
    missingJobsRequeued = await enqueueEmailJobs(toRearm);
    logger.warn(
      { requeued: missingJobsRequeued, noJob: missing.length, alreadyFinished: finished.length },
      'Reconciler re-armed scheduled emails that had no live queue entry',
    );
  }

  const result = {
    staleLocksReleased,
    missingJobsRequeued,
    pendingChecked: pending.length,
  };

  if (missingJobsRequeued > 0 || staleLocksReleased > 0) {
    logger.info(result, 'Reconcile sweep repaired queue state');
  } else {
    logger.debug(result, 'Reconcile sweep complete');
  }

  return result;
}

/**
 * A row left in `processing` past STALE_LOCK_MS means the worker holding it
 * died. Return it to `scheduled` so it can be picked up again. The processor's
 * claim statement independently enforces the same rule, so this is belt and
 * braces — it just makes recovery prompt rather than waiting for a redelivery.
 */
async function releaseStaleLocks(): Promise<number> {
  const cutoff = new Date(Date.now() - env.STALE_LOCK_MS);

  const { count } = await prisma.emailJob.updateMany({
    where: { status: 'processing', lockedAt: { lt: cutoff } },
    data: { status: 'scheduled', lockedAt: null },
  });

  if (count > 0) logger.warn({ count }, 'Released stale locks from crashed workers');
  return count;
}

/**
 * Schedule the next sweep as an ordinary BullMQ *delayed* job that will, when
 * it runs, schedule the one after it.
 *
 * This is intentionally not cron and not BullMQ's repeatable/cron-expression
 * feature — the assignment forbids cron, and a self-rescheduling delayed job
 * gets the same result using only the delayed-job primitive.
 *
 * The jobId is derived from the time slot, so if the API process and three
 * worker processes all try to arm the same tick, Redis keeps exactly one.
 */
export async function armReconciler(): Promise<void> {
  const interval = env.RECONCILE_INTERVAL_MS;
  const nextSlot = Math.floor(Date.now() / interval) + 1;
  const runAt = nextSlot * interval;

  // BullMQ rejects ':' in a custom job id (it is the internal key separator),
  // so the slot is joined with a dash.
  await emailQueue.add(
    RECONCILE_JOB,
    {},
    {
      jobId: `reconcile-${nextSlot}`,
      delay: Math.max(0, runAt - Date.now()),
      attempts: 1,
      removeOnComplete: true,
      removeOnFail: { count: 20 },
    },
  );
}

/**
 * Run once at process boot, then keep the self-rescheduling chain alive.
 *
 * Never throws: reconciliation is a safety net, and a failure here must not
 * stop a worker from processing the jobs that are already queued.
 */
export async function bootstrapReconciler(): Promise<void> {
  try {
    const result = await runReconcileSweep();
    logger.info(result, 'Startup reconciliation complete');
    await armReconciler();
  } catch (err) {
    logger.error({ err }, 'Startup reconciliation failed - continuing without it');
  }
}
