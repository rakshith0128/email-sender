import 'dotenv/config';
import { z } from 'zod';

/**
 * Every tunable in this service is read from here. Nothing that a reviewer
 * might want to change (concurrency, delays, hourly caps) is hardcoded at a
 * call site.
 */
const intFromEnv = (fallback: number, min = 0) =>
  z.coerce.number().int().min(min).default(fallback);

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: intFromEnv(4000, 1),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  CORS_ORIGIN: z.string().default('http://localhost:3000'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().default('redis://localhost:6379'),

  GOOGLE_CLIENT_ID: z.string().default(''),
  JWT_SECRET: z.string().min(8).default('dev-only-insecure-secret-change-me'),
  JWT_EXPIRES_IN: z.string().default('7d'),
  AUTH_DISABLED: z
    .string()
    .default('false')
    .transform((v) => v.toLowerCase() === 'true'),

  // Concurrency: how many sends a single worker process runs in parallel.
  WORKER_CONCURRENCY: intFromEnv(5, 1),

  // Minimum spacing between sends, enforced by the BullMQ worker limiter
  // (Redis-backed, therefore correct across multiple worker instances).
  MIN_SEND_INTERVAL_MS: intFromEnv(2000, 1),
  GLOBAL_LIMITER_MAX: intFromEnv(1, 1),
  /**
   * Whether the minimum send interval is enforced across the whole system
   * ('global') or independently per sender ('sender').
   *
   * 'global' is the strict reading of "a minimum delay between individual
   * email sends" and makes the whole system serial, which means worker
   * concurrency cannot do useful work. 'sender' mimics real per-provider
   * throttling: each SMTP identity is throttled on its own, so N senders
   * genuinely run in parallel and concurrency pays off.
   */
  SEND_INTERVAL_SCOPE: z.enum(['global', 'sender']).default('global'),

  // Hourly quota applied per sender.
  MAX_EMAILS_PER_HOUR_PER_SENDER: intFromEnv(200, 1),
  // Per-position offset used when rescheduling an overflow batch, so the
  // original ordering survives the jump into the next hour window.
  ORDER_STEP_MS: intFromEnv(50, 0),

  RECONCILE_INTERVAL_MS: intFromEnv(60_000, 1000),
  STALE_LOCK_MS: intFromEnv(120_000, 1000),
  JOB_ATTEMPTS: intFromEnv(3, 1),
  JOB_BACKOFF_MS: intFromEnv(5000, 0),

  ETHEREAL_SENDER_COUNT: intFromEnv(3, 1),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('\n');
  // Fail loudly at boot rather than mysteriously at the first send.
  console.error(`\nInvalid environment configuration:\n${issues}\n`);
  console.error('Copy backend/.env.example to backend/.env and fill it in.\n');
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;
