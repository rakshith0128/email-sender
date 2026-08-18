import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { env } from '../config/env.js';
import { asyncHandler, badRequest } from '../middleware/error.js';
import { requireAuth } from '../middleware/auth.js';
import { scheduleCampaign } from '../queue/scheduler.js';

export const campaignsRouter = Router();

/** Upper bound on one submission — keeps a typo'd CSV from queueing a million rows. */
const MAX_RECIPIENTS = 10_000;

const scheduleSchema = z.object({
  subject: z.string().trim().min(1, 'Subject is required').max(500),
  body: z.string().trim().min(1, 'Body is required').max(100_000),
  recipients: z
    .array(z.string().trim().email('Invalid email address'))
    .min(1, 'At least one recipient is required')
    .max(MAX_RECIPIENTS, `At most ${MAX_RECIPIENTS} recipients per campaign`),
  /** ISO string. Defaults to "now" when omitted. */
  startAt: z.coerce.date().optional(),
  /** Delay between consecutive sends, in seconds (what the UI collects). */
  delaySeconds: z.coerce.number().int().min(0).max(3600).optional(),
  hourlyLimit: z.coerce.number().int().min(1).max(100_000).optional(),
});

campaignsRouter.post(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const input = scheduleSchema.parse(req.body);

    // Dedupe case-insensitively — CSV exports very often repeat addresses, and
    // sending the same person the same email twice is exactly what the
    // idempotency requirement is about.
    const seen = new Set<string>();
    const recipients: string[] = [];
    for (const raw of input.recipients) {
      const email = raw.toLowerCase();
      if (seen.has(email)) continue;
      seen.add(email);
      recipients.push(email);
    }

    if (recipients.length === 0) throw badRequest('No valid recipients after de-duplication');

    const startAt = input.startAt ?? new Date();
    const delayMs = (input.delaySeconds ?? env.MIN_SEND_INTERVAL_MS / 1000) * 1000;
    const hourlyLimit = input.hourlyLimit ?? env.MAX_EMAILS_PER_HOUR_PER_SENDER;

    const result = await scheduleCampaign({
      userId: req.user!.id,
      subject: input.subject,
      body: input.body,
      recipients,
      startAt,
      delayMs,
      hourlyLimit,
    });

    res.status(201).json({
      ...result,
      duplicatesRemoved: input.recipients.length - recipients.length,
    });
  }),
);

campaignsRouter.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const campaigns = await prisma.campaign.findMany({
      where: { userId: req.user!.id },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        _count: { select: { emailJobs: true } },
      },
    });

    // One grouped query for all campaigns rather than a per-campaign count.
    const counts = await prisma.emailJob.groupBy({
      by: ['campaignId', 'status'],
      where: { campaign: { userId: req.user!.id } },
      _count: { _all: true },
    });

    const byCampaign = new Map<string, Record<string, number>>();
    for (const row of counts) {
      const entry = byCampaign.get(row.campaignId) ?? {};
      entry[row.status] = row._count._all;
      byCampaign.set(row.campaignId, entry);
    }

    res.json({
      campaigns: campaigns.map((c) => ({
        id: c.id,
        subject: c.subject,
        startAt: c.startAt,
        delayMs: c.delayMs,
        hourlyLimit: c.hourlyLimit,
        totalRecipients: c.totalRecipients,
        createdAt: c.createdAt,
        statusCounts: byCampaign.get(c.id) ?? {},
      })),
    });
  }),
);
