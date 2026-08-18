import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { asyncHandler } from '../middleware/error.js';
import { requireAuth } from '../middleware/auth.js';
import { currentUsage, hourWindow, nextWindowStart } from '../services/rateLimiter.js';

export const sendersRouter = Router();

/**
 * Sender pool with live hourly-quota usage read straight from the Redis
 * counters the limiter uses — so what this endpoint reports is exactly what
 * the worker will enforce.
 */
sendersRouter.get(
  '/',
  requireAuth,
  asyncHandler(async (_req, res) => {
    const senders = await prisma.sender.findMany({ orderBy: { createdAt: 'asc' } });
    const now = new Date();

    const usage = await Promise.all(senders.map((s) => currentUsage(s.id, now)));

    res.json({
      senders: senders.map((sender, i) => {
        const used = usage[i] ?? 0;
        return {
          id: sender.id,
          name: sender.name,
          email: sender.email,
          active: sender.active,
          maxEmailsPerHour: sender.maxEmailsPerHour,
          usedThisHour: used,
          remainingThisHour: Math.max(0, sender.maxEmailsPerHour - used),
        };
      }),
      window: { current: hourWindow(now), resetsAt: nextWindowStart(now) },
    });
  }),
);
