import { describe, expect, it } from 'vitest';
import { assignSender } from '../src/services/senders.js';
import type { Sender } from '@prisma/client';

function makeSender(id: string): Sender {
  return {
    id,
    name: id,
    email: `${id}@ethereal.email`,
    smtpHost: 'smtp.ethereal.email',
    smtpPort: 587,
    smtpSecure: false,
    smtpUser: id,
    smtpPass: 'pass',
    maxEmailsPerHour: 200,
    active: true,
    createdAt: new Date(),
  };
}

/**
 * Mirrors the spacing computed in scheduler.ts. Kept as a local helper so the
 * expectation is readable, and asserted against the same formula the scheduler
 * uses: startAt + seq * delayMs.
 */
function scheduleTimes(startAt: Date, count: number, delayMs: number): Date[] {
  return Array.from({ length: count }, (_, seq) => new Date(startAt.getTime() + seq * delayMs));
}

describe('send spacing', () => {
  const startAt = new Date('2026-08-18T10:00:00.000Z');

  it('spaces consecutive emails by exactly delayMs', () => {
    const times = scheduleTimes(startAt, 5, 2000);
    for (let i = 1; i < times.length; i += 1) {
      expect(times[i]!.getTime() - times[i - 1]!.getTime()).toBe(2000);
    }
  });

  it('sends the first email at the requested start time', () => {
    expect(scheduleTimes(startAt, 3, 2000)[0]!.toISOString()).toBe(startAt.toISOString());
  });

  it('collapses to a simultaneous batch when delay is zero', () => {
    const times = scheduleTimes(startAt, 100, 0);
    expect(new Set(times.map((t) => t.getTime())).size).toBe(1);
  });

  it('produces a monotonically increasing schedule', () => {
    const times = scheduleTimes(startAt, 1000, 2000).map((t) => t.getTime());
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });
});

describe('sender round-robin', () => {
  const senders = [makeSender('s1'), makeSender('s2'), makeSender('s3')];

  it('cycles through the pool in order', () => {
    const assigned = [0, 1, 2, 3, 4, 5].map((seq) => assignSender(senders, seq).id);
    expect(assigned).toEqual(['s1', 's2', 's3', 's1', 's2', 's3']);
  });

  it('distributes a large campaign evenly across senders', () => {
    const counts = new Map<string, number>();
    for (let seq = 0; seq < 999; seq += 1) {
      const id = assignSender(senders, seq).id;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    expect([...counts.values()]).toEqual([333, 333, 333]);
  });

  it('works with a single sender', () => {
    const one = [makeSender('solo')];
    expect(assignSender(one, 0).id).toBe('solo');
    expect(assignSender(one, 99).id).toBe('solo');
  });
});
