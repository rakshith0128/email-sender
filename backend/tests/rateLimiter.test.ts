import { describe, expect, it } from 'vitest';
import { hourWindow, nextWindowStart, overflowRunAt, rateKey } from '../src/services/rateLimiter.js';

/**
 * The window maths is what decides *when* an over-limit email actually goes
 * out, so it is worth pinning down independently of Redis.
 */
describe('hour window bucketing', () => {
  it('buckets by UTC hour', () => {
    expect(hourWindow(new Date('2026-08-18T14:37:29.000Z'))).toBe('2026081814');
  });

  it('pads single-digit month, day and hour', () => {
    expect(hourWindow(new Date('2026-01-02T03:04:05.000Z'))).toBe('2026010203');
  });

  it('keeps every instant inside the same hour in one bucket', () => {
    const start = hourWindow(new Date('2026-08-18T14:00:00.000Z'));
    const end = hourWindow(new Date('2026-08-18T14:59:59.999Z'));
    expect(start).toBe(end);
  });

  it('rolls over at the hour boundary', () => {
    const before = hourWindow(new Date('2026-08-18T14:59:59.999Z'));
    const after = hourWindow(new Date('2026-08-18T15:00:00.000Z'));
    expect(before).not.toBe(after);
  });

  it('namespaces the key by sender so quotas are independent', () => {
    const at = new Date('2026-08-18T14:30:00.000Z');
    expect(rateKey('sender-a', at)).toBe('rate:sender-a:2026081814');
    expect(rateKey('sender-b', at)).not.toBe(rateKey('sender-a', at));
  });
});

describe('nextWindowStart', () => {
  it('returns the top of the following hour', () => {
    const at = new Date('2026-08-18T14:37:29.123Z');
    expect(nextWindowStart(at).toISOString()).toBe('2026-08-18T15:00:00.000Z');
  });

  it('advances a full hour when already exactly on the boundary', () => {
    const at = new Date('2026-08-18T14:00:00.000Z');
    expect(nextWindowStart(at).toISOString()).toBe('2026-08-18T15:00:00.000Z');
  });

  it('is always in the future', () => {
    const at = new Date('2026-08-18T14:59:59.999Z');
    expect(nextWindowStart(at).getTime()).toBeGreaterThan(at.getTime());
  });
});

describe('overflow ordering', () => {
  const at = new Date('2026-08-18T14:30:00.000Z');

  it('places overflow at the start of the next window', () => {
    expect(overflowRunAt(0, at).toISOString()).toBe('2026-08-18T15:00:00.000Z');
  });

  it('preserves FIFO order — later positions run strictly later', () => {
    const times = [5, 6, 7, 200].map((seq) => overflowRunAt(seq, at).getTime());
    const sorted = [...times].sort((a, b) => a - b);
    expect(times).toEqual(sorted);
  });

  it('keeps a whole overflow batch in its original relative order', () => {
    const batch = Array.from({ length: 50 }, (_, seq) => ({
      seq,
      runAt: overflowRunAt(seq, at).getTime(),
    }));

    const reordered = [...batch].sort((a, b) => a.runAt - b.runAt);
    expect(reordered.map((entry) => entry.seq)).toEqual(batch.map((entry) => entry.seq));
  });
});
