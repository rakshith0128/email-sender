import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { asyncHandler } from '../middleware/error.js';
import { requireAuth } from '../middleware/auth.js';

export const statsRouter = Router();

/** Counts for the dashboard cards. One grouped query, not five. */
statsRouter.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const grouped = await prisma.emailJob.groupBy({
      by: ['status'],
      where: { campaign: { userId: req.user!.id } },
      _count: { _all: true },
    });

    const counts = { scheduled: 0, processing: 0, sent: 0, failed: 0, cancelled: 0 };
    for (const row of grouped) counts[row.status] = row._count._all;

    res.json({
      ...counts,
      // What the "Scheduled" tab shows: anything not yet resolved.
      pending: counts.scheduled + counts.processing,
      total: Object.values(counts).reduce((a, b) => a + b, 0),
    });
  }),
);
