import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { asyncHandler, notFound } from '../middleware/error.js';
import { requireAuth } from '../middleware/auth.js';
import { emailQueue } from '../queue/emailQueue.js';
import { toPreview } from '../lib/html.js';

export const emailsRouter = Router();

const EMAIL_STATUSES = ['scheduled', 'processing', 'sent', 'failed', 'cancelled'] as const;

const listSchema = z.object({
  /**
   * `scheduled` = the Scheduled view (still pending, includes in-flight).
   * `sent`      = the Sent view (terminal: sent, failed or cancelled).
   */
  status: z.enum(['scheduled', 'sent', 'all']).default('all'),
  /** Narrows to one exact status - drives the filter menu in the UI. */
  only: z.enum(EMAIL_STATUSES).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(25),
  search: z.string().trim().max(200).optional(),
});

emailsRouter.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { status, only, page, limit, search } = listSchema.parse(req.query);

    const where: Prisma.EmailJobWhereInput = { campaign: { userId: req.user!.id } };

    if (only) where.status = only;
    else if (status === 'scheduled') where.status = { in: ['scheduled', 'processing'] };
    else if (status === 'sent') where.status = { in: ['sent', 'failed', 'cancelled'] };

    if (search) {
      where.OR = [
        { recipient: { contains: search, mode: 'insensitive' } },
        { subject: { contains: search, mode: 'insensitive' } },
      ];
    }

    // Scheduled sorts by when it will go out; Sent shows most recent first.
    const orderBy: Prisma.EmailJobOrderByWithRelationInput =
      status === 'sent' ? { sentAt: 'desc' } : { scheduledAt: 'asc' };

    const [rows, total] = await Promise.all([
      prisma.emailJob.findMany({
        where,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          recipient: true,
          subject: true,
          body: true,
          status: true,
          scheduledAt: true,
          sentAt: true,
          attempts: true,
          error: true,
          previewUrl: true,
          seq: true,
          sender: { select: { email: true, name: true } },
        },
      }),
      prisma.emailJob.count({ where }),
    ]);

    // Send a short preview rather than the whole body - the list shows one line
    // of it, and 25 full campaign bodies per page would be wasteful.
    const items = rows.map(({ body, ...rest }) => ({ ...rest, preview: toPreview(body) }));

    res.json({
      items,
      pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
    });
  }),
);

/** Full record including the body - backs the email detail view. */
emailsRouter.get(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = String(req.params.id ?? '');

    const email = await prisma.emailJob.findFirst({
      where: { id, campaign: { userId: req.user!.id } },
      select: {
        id: true,
        recipient: true,
        subject: true,
        body: true,
        status: true,
        scheduledAt: true,
        sentAt: true,
        attempts: true,
        error: true,
        messageId: true,
        previewUrl: true,
        seq: true,
        createdAt: true,
        sender: { select: { email: true, name: true } },
        campaign: { select: { id: true, delayMs: true, hourlyLimit: true, totalRecipients: true } },
      },
    });

    if (!email) throw notFound('Email not found');

    res.json({ email });
  }),
);

/**
 * Cancel a still-pending email. Removes the BullMQ job as a courtesy, but the
 * `cancelled` status is what actually prevents the send - the processor
 * short-circuits on terminal statuses.
 */
emailsRouter.post(
  '/:id/cancel',
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = String(req.params.id ?? '');

    const existing = await prisma.emailJob.findFirst({
      where: { id, campaign: { userId: req.user!.id } },
    });
    if (!existing) throw notFound('Email job not found');

    const { count } = await prisma.emailJob.updateMany({
      where: { id, status: { in: ['scheduled', 'processing'] } },
      data: { status: 'cancelled', lockedAt: null },
    });

    if (count === 0) {
      res.status(409).json({ error: `Cannot cancel an email that is already ${existing.status}` });
      return;
    }

    await emailQueue.remove(id).catch(() => undefined);

    res.json({ id, status: 'cancelled' });
  }),
);
