import type { Sender } from '@prisma/client';
import { prisma } from '../lib/prisma.js';

/**
 * Sender pool. Multiple senders exist so hourly quota is multiplied and no
 * single SMTP identity carries the whole campaign: with 3 senders at 200/hour
 * the system sustains 600/hour without any one sender exceeding its cap.
 */
export async function getActiveSenders(): Promise<Sender[]> {
  return prisma.sender.findMany({
    where: { active: true },
    orderBy: { createdAt: 'asc' },
  });
}

export class NoSendersError extends Error {
  constructor() {
    super('No active senders configured. Run `npm run seed:senders` first.');
    this.name = 'NoSendersError';
  }
}

/**
 * Round-robin assignment across the pool.
 *
 * Round-robin (rather than fill-one-then-the-next) means all senders hit their
 * hourly ceiling at roughly the same time, so a campaign degrades smoothly
 * instead of stalling the moment sender #1 is exhausted.
 */
export function assignSender(senders: Sender[], seq: number): Sender {
  const sender = senders[seq % senders.length];
  if (!sender) throw new NoSendersError();
  return sender;
}
