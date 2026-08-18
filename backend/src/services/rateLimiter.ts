import { redis } from '../lib/redis.js';
import { env } from '../config/env.js';

/**
 * Per-sender, per-hour rate limiting backed by Redis counters.
 *
 * Why Redis and not an in-memory counter: the limit has to hold across every
 * worker process and every instance. A local counter would let N workers each
 * send `limit` emails per hour.
 *
 * Key shape: `rate:{senderId}:{YYYYMMDDHH}` (UTC). Keys expire on their own, so
 * there is nothing to clean up and no unbounded growth.
 */

const WINDOW_MS = 60 * 60 * 1000;
/** Keep the key a little past its window so late arrivals still see the count. */
const KEY_TTL_SECONDS = 2 * 60 * 60;

/** UTC hour bucket, e.g. 2026081814. */
export function hourWindow(at: Date = new Date()): string {
  const y = at.getUTCFullYear();
  const m = String(at.getUTCMonth() + 1).padStart(2, '0');
  const d = String(at.getUTCDate()).padStart(2, '0');
  const h = String(at.getUTCHours()).padStart(2, '0');
  return `${y}${m}${d}${h}`;
}

export function rateKey(senderId: string, at: Date = new Date()): string {
  return `rate:${senderId}:${hourWindow(at)}`;
}

/** Start of the next hour window — where over-limit jobs get pushed to. */
export function nextWindowStart(at: Date = new Date()): Date {
  return new Date(Math.floor(at.getTime() / WINDOW_MS) * WINDOW_MS + WINDOW_MS);
}

/**
 * Check-and-consume in one atomic step.
 *
 * A naive GET-then-INCR would let two workers both read `limit - 1` and both
 * decide they may send. This Lua script runs INCR and the comparison inside a
 * single Redis execution, and rolls the counter back when the increment would
 * have exceeded the cap — so a rejected attempt never eats capacity.
 */
const CONSUME_SCRIPT = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[2])
end
if current > tonumber(ARGV[1]) then
  redis.call('DECR', KEYS[1])
  return 0
end
return 1
`;

redis.defineCommand('consumeRateToken', { numberOfKeys: 1, lua: CONSUME_SCRIPT });

interface RedisWithConsume {
  consumeRateToken(key: string, limit: string, ttl: string): Promise<number>;
}

/** @returns true if the caller may send now, false if the hourly cap is full. */
export async function consumeToken(
  senderId: string,
  limit: number,
  at: Date = new Date(),
): Promise<boolean> {
  const client = redis as unknown as RedisWithConsume;
  const allowed = await client.consumeRateToken(
    rateKey(senderId, at),
    String(limit),
    String(KEY_TTL_SECONDS),
  );
  return allowed === 1;
}

/**
 * Give a consumed token back. Used when we pass the rate check but then fail to
 * claim the DB row (another worker got there first) — without this, capacity
 * would leak out of the hour window.
 */
export async function refundToken(senderId: string, at: Date = new Date()): Promise<void> {
  const key = rateKey(senderId, at);
  const value = await redis.decr(key);
  if (value < 0) await redis.set(key, '0', 'EX', KEY_TTL_SECONDS);
}

/** Current usage for a sender in the given window — surfaced on GET /api/senders. */
export async function currentUsage(senderId: string, at: Date = new Date()): Promise<number> {
  const value = await redis.get(rateKey(senderId, at));
  return value ? Number(value) : 0;
}

/**
 * Where an over-limit job should be retried.
 *
 * The `seq * ORDER_STEP_MS` offset is what preserves ordering: when a whole
 * batch overflows, every job lands at the next window start plus its original
 * position, so they come back in the same order they went in.
 */
export function overflowRunAt(seq: number, at: Date = new Date()): Date {
  return new Date(nextWindowStart(at).getTime() + seq * env.ORDER_STEP_MS);
}

/**
 * ── Minimum interval between individual sends ────────────────────────────────
 *
 * BullMQ's worker `limiter` is a *fixed-window* rate cap: with
 * `{ max: 1, duration: 2000 }` it permits one job per 2s window, which lets two
 * jobs run back-to-back either side of a boundary. Measured on a burst of
 * overdue jobs, that produced gaps as short as 340ms.
 *
 * The brief asks for a genuine minimum delay between sends, so this gate
 * enforces it explicitly against a single Redis key holding the last send time.
 * The compare-and-set is one Lua call, so it holds across every worker.
 *
 * A caller that is too early is told how long to wait and defers itself rather
 * than sleeping, so it never occupies a concurrency slot while waiting.
 */
function minIntervalKey(senderId: string): string {
  return env.SEND_INTERVAL_SCOPE === 'sender' ? `send:lastAt:${senderId}` : 'send:lastAt';
}

const MIN_INTERVAL_SCRIPT = `
local last = tonumber(redis.call('GET', KEYS[1]) or '0')
local now = tonumber(ARGV[1])
local interval = tonumber(ARGV[2])
local elapsed = now - last
if elapsed >= interval then
  redis.call('SET', KEYS[1], now, 'PX', ARGV[3])
  return 0
end
return interval - elapsed
`;

redis.defineCommand('claimSendSlot', { numberOfKeys: 1, lua: MIN_INTERVAL_SCRIPT });

interface RedisWithSlot {
  claimSendSlot(key: string, now: string, interval: string, ttl: string): Promise<number>;
}

/**
 * @returns 0 when the caller may send immediately (and the slot is now taken),
 *          otherwise the number of milliseconds still to wait.
 */
export async function claimSendSlot(senderId: string, now: number = Date.now()): Promise<number> {
  const client = redis as unknown as RedisWithSlot;
  return client.claimSendSlot(
    minIntervalKey(senderId),
    String(now),
    String(env.MIN_SEND_INTERVAL_MS),
    String(Math.max(env.MIN_SEND_INTERVAL_MS * 4, 60_000)),
  );
}
