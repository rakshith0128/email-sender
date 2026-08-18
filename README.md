# Email Job Scheduler

A production-shaped email scheduling service: an Express + TypeScript API, a BullMQ/Redis worker
that actually sends the mail, PostgreSQL as the source of truth, and a Next.js dashboard with real
Google OAuth.

Emails are scheduled with **BullMQ delayed jobs — no cron anywhere**, survive a full restart, are
throttled per sender per hour, and can never be sent twice.

---

## Quick start

Full step-by-step install instructions (PostgreSQL, Redis, Google OAuth) are in
**[SETUP.md](SETUP.md)**. The short version:

```bash
docker compose up -d
```

...or a native install with no Docker required — see [SETUP.md](SETUP.md).

```bash
cd backend
cp .env.example .env
npm install
npm run prisma:migrate
npm run seed:senders
npm run dev
```

```bash
cd frontend
cp .env.local.example .env.local
npm install
npm run dev
```

Check everything is wired up:

```bash
curl http://localhost:4000/health
```

A response of `"status":"ok"` with both checks true means you are good.

> The API and the worker are **separate processes** (`npm run dev` runs both via `concurrently`).
> That split is deliberate — see the persistence section below.

---

## Architecture

```
                     +----------------------------+
  Google OAuth ----->|  Next.js dashboard :3000   |
                     |  Auth.js - TanStack Query  |
                     +-------------+--------------+
                                   | REST + Bearer JWT
                     +-------------v--------------+
                     |  Express API :4000         |
                     |  validate - fan out - read |
                     +------+--------------+------+
                            |              |
             writes rows    |              |  registers delayed jobs
                            v              v
                 +----------------+   +------------------+
                 |  PostgreSQL    |   |  Redis / BullMQ  |
                 |  SOURCE OF     |   |  EXECUTION       |
                 |  TRUTH         |   |  ENGINE          |
                 +--------+-------+   +--------+---------+
                          |                    |
                          |   reconciler       | delivers due jobs
                          |   rebuilds queue   v
                          |            +------------------+
                          +----------->|  Worker process  |
                                       |  concurrency N   |
                                       |  limiter - quota |
                                       +--------+---------+
                                                v
                                        Ethereal SMTP
                                        (3 sender accounts)
```

The central design decision: **Postgres owns what must be sent and when; Redis owns execution.**
Redis is treated as a cache of intent that can be rebuilt, never as the only record. Everything
about restart-safety follows from that split.

### Repository layout

```
backend/src/
  config/env.ts          zod-validated config - every limit tunable, nothing hardcoded
  queue/
    emailQueue.ts        queue definition + job names
    scheduler.ts         campaign fan-out, chunked addBulk
    processor.ts         rate limit -> atomic claim -> send  (the core)
    reconciler.ts        restart recovery + self-rescheduling sweep
  services/
    rateLimiter.ts       Redis Lua per-sender hourly quota
    mailer.ts            pooled nodemailer transport per sender
    senders.ts           round-robin sender allocation
  routes/                campaigns, emails, senders, stats, auth, health
  worker.ts              BullMQ worker entrypoint (concurrency + limiter)
  index.ts               Express entrypoint

frontend/src/
  app/
    page.tsx                    login screen
    dashboard/layout.tsx        sidebar shell, auth gate
    dashboard/scheduled|sent    the two list views
    dashboard/compose           full-page composer
    dashboard/email/[id]        email detail
    api/auth/[...nextauth]      Auth.js route handler
  components/
    layout/                     Sidebar, LoginCard, BackendSessionWarning
    emails/                     EmailListView, EmailRow, ListToolbar, EmailDetail
    compose/                    ComposeView, RecipientChips, RichTextEditor,
                                SendLaterPopover
    ui/States.tsx               skeleton, empty and error states
  hooks/useApi.ts               TanStack Query hooks (4s polling)
  lib/                          api client, types, csv parsing, formatting, auth
```

---

## 1. How scheduling works

**No cron. No `node-cron`, no `agenda`, no `crontab`, and not BullMQ cron-expression repeatables.**
Scheduling is entirely BullMQ *delayed jobs*.

When `POST /api/campaigns` arrives:

1. Recipients are validated and de-duplicated (case-insensitive).
2. Ids are **pre-generated** with `randomUUID()` so the same value is both the Postgres primary key
   and the BullMQ `jobId`. This shared identifier is what makes everything downstream idempotent.
3. In one transaction, the campaign row plus one `email_jobs` row per recipient are inserted, each
   with `scheduled_at = startAt + seq * delayMs` and a round-robin `sender_id`.
4. Only *after* the commit are BullMQ jobs registered, in chunks of 500 via `addBulk`, with
   `delay = scheduled_at - now`.

The commit-then-enqueue ordering matters: if the process dies between the two steps, the rows exist
and the reconciler will enqueue them. The reverse order could produce a job pointing at a row that
was never written.

BullMQ then holds the job in the Redis delayed set (a sorted set keyed by run-at timestamp) and
moves it to the wait list the moment it is due. Nothing polls a table for "jobs where run_at < now".

---

## 2. How persistence on restart is handled

Three independent layers, strongest first:

**Layer 1 - Redis persistence.** `docker-compose.yml` runs Redis with `--appendonly yes`, so the
delayed set survives a Redis restart, not just an app restart. Stop the worker for five minutes and
restart it: every job that came due meanwhile fires immediately, and the rest keep their original
schedule.

**Layer 2 - the reconciler.** Runs at boot in *both* the API and the worker process. It asks
Postgres for every row still in `scheduled`, pipelines an `EXISTS` against each job Redis key
(one round trip, not N), and re-enqueues anything missing with the correct remaining delay - `0` if
already overdue. **Even a completely flushed Redis fully recovers from Postgres.**

**Layer 3 - stale lock recovery.** A row left in `processing` past `STALE_LOCK_MS` means the worker
holding it died mid-send. Both the reconciler and the claim statement itself treat such a row as
abandoned and allow it to be re-claimed.

The sweep repeats itself without cron: each run schedules the next one as an ordinary **delayed job**
whose `jobId` is derived from the time slot (`reconcile:<slot>`). Deriving the id from the slot means
that if the API and three workers all try to arm the same tick, Redis keeps exactly one.

```ts
const nextSlot = Math.floor(Date.now() / interval) + 1;
await emailQueue.add(RECONCILE_JOB, {}, {
  jobId: `reconcile:${nextSlot}`,            // dedupes across every process
  delay: nextSlot * interval - Date.now(),   // a delayed job, not a cron
});
```

Because the worker shuts down with `worker.close()`, in-flight sends finish rather than being killed
mid-SMTP-transaction, so a restart never leaves a half-sent email.

---

## 3. How idempotency is guaranteed

> *"Same email queues should not be sent more than once."*

Three layers, and the second is the one that actually matters:

**1. BullMQ jobId dedupe.** `jobId` *is* the `email_jobs.id`. BullMQ silently ignores `add()` for an
id that already exists, so re-enqueueing - by the reconciler, by a retry, by a double API call - can
never create a second job.

**2. An atomic conditional claim.** Before any SMTP call, the worker runs one statement:

```sql
UPDATE email_jobs
   SET status = 'processing', attempts = attempts + 1, locked_at = NOW()
 WHERE id = $1
   AND ( status = 'scheduled'
      OR (status = 'processing' AND locked_at < NOW() - make_interval(secs => $2)) )
```

If it updates 0 rows, another worker owns the job - or it is already `sent` - and this worker returns
without sending. Because the check and the state change are the same statement, two workers racing
on the same job cannot both proceed. This holds even against duplicate delivery, stalled-job
recovery, and multiple worker instances.

**3. Terminal statuses are never re-entered.** `sent`, `failed` and `cancelled` short-circuit at the
top of the processor.

Note the ordering in `processor.ts`: the **rate-limit check happens before the claim**. A throttled
job therefore stays in `scheduled` and its status never flickers to `processing` and back. If the
claim then fails after a token was consumed, the token is explicitly refunded so hourly capacity
does not leak.

---

## 4. How rate limiting & concurrency are implemented

Three separate controls. All Redis-backed, so they stay correct across any number of worker
processes or instances - an in-memory counter would let N workers each send `limit` emails per hour.

### Worker concurrency

```ts
new Worker(QUEUE_NAME, processJob, { concurrency: env.WORKER_CONCURRENCY })  // default 5
```

Parallel execution is safe because of the atomic claim above, plus one pooled SMTP transport per
sender rather than a fresh TCP+TLS handshake per email.

### Minimum delay between individual sends - default: 2 seconds

Two mechanisms, because the obvious one alone is not a guarantee.

**1. The BullMQ limiter** caps throughput, tracked in Redis:

```ts
limiter: { max: env.GLOBAL_LIMITER_MAX,        // default 1
           duration: env.MIN_SEND_INTERVAL_MS } // default 2000
```

This is a *fixed-window* rate cap, not a minimum-gap enforcer: one job may run at the end of a
window and the next at the start of the following one, so it permits back-to-back sends at a
boundary.

**2. An explicit gate** therefore enforces the actual minimum, via a Redis compare-and-set against
a single key holding the last send time:

```lua
local last = tonumber(redis.call('GET', KEYS[1]) or '0')
local elapsed = tonumber(ARGV[1]) - last
if elapsed >= tonumber(ARGV[2]) then
  redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[3])
  return 0                       -- clear to send
end
return tonumber(ARGV[2]) - elapsed -- wait this long
```

A job told to wait defers itself with `moveToDelayed` rather than sleeping, so it never occupies a
concurrency slot while waiting. Because it is a single Lua call on one key, the guarantee holds
across every worker process.

Measured on a 10-email burst all due at once: gaps of 2000, 2001, 2011, 2008, 2012, 2014, 2000,
2012, 2013 ms, in sequence order.

`SEND_INTERVAL_SCOPE` selects what the gate applies to:

| Value | Behaviour |
|---|---|
| `global` (default) | One send per interval across the whole system - the strictest reading of the requirement |
| `sender` | Each sender throttled independently, mimicking real per-provider throttling |

**The trade-off, stated plainly:** a strict global minimum gap and useful worker concurrency are
mutually exclusive - if the whole system may only send once every 2s, extra workers have nothing to
do. The default takes the strict reading. Setting `SEND_INTERVAL_SCOPE=sender` throttles each
sender independently instead, which is how real providers rate-limit, and makes concurrency
productive: 3 senders then sustain 3 sends per interval. All of it is env-driven, so this is a
deployment decision rather than a code change.

A per-campaign delay is *also* applied at schedule time (`scheduled_at = startAt + seq * delayMs`),
so the "Delay between emails" field in the UI spaces the batch, and the worker limiter is the global
safety net underneath it.

### Emails per hour - per sender

Redis counter keyed by sender and UTC hour: `rate:{senderId}:{YYYYMMDDHH}`. Keys expire on their
own, so there is nothing to clean up.

The check and the increment must be one indivisible operation - a naive `GET` then `INCR` lets two
workers both read `limit - 1` and both decide they may send. So it is a Lua script:

```lua
local current = redis.call('INCR', KEYS[1])
if current == 1 then redis.call('EXPIRE', KEYS[1], ARGV[2]) end
if current > tonumber(ARGV[1]) then
  redis.call('DECR', KEYS[1])   -- roll back: a rejected attempt must not eat capacity
  return 0
end
return 1
```

The effective cap is `min(sender.maxEmailsPerHour, campaign.hourlyLimit)` - the sender own quota
and whatever the user asked for in the compose form, whichever is tighter. Defaults come from
`MAX_EMAILS_PER_HOUR_PER_SENDER`; nothing is hardcoded.

Because senders are assigned **round-robin**, all senders approach their ceiling together and total
throughput is `senders x limit` per hour (3 x 200 = 600/hour out of the box). Round-robin rather
than fill-one-then-the-next means a campaign degrades smoothly instead of stalling the instant
sender #1 is exhausted.

### When the hourly limit is reached

Jobs are **never dropped and never failed**. The processor pushes them into the next hour window:

```ts
const runAt = nextWindowStart(now) + seq * ORDER_STEP_MS;
await prisma.emailJob.update({ where: { id }, data: { status: 'scheduled', scheduledAt: runAt } });
await job.moveToDelayed(runAt.getTime(), token);
throw new DelayedError();   // tells BullMQ: deferred, not completed, not failed
```

**Ordering is preserved by the `seq * ORDER_STEP_MS` offset.** `seq` is the recipient original
position in the campaign, so when a whole overflow batch rolls into the next hour, every job lands
at *next window start + its original position* and the batch comes back in exactly the order it went
in. If the next window is also full, the same logic cascades it forward again - self-correcting,
with order intact each time.

---

## Behaviour under load

**1000+ emails scheduled for roughly the same time:**

| Concern | Behaviour |
|---|---|
| Enqueue cost | Chunked `createMany` + `addBulk` at 500/chunk - 1000 recipients is a handful of round trips, not 1000 |
| Redis memory | `removeOnComplete: 1000`, `removeOnFail: 5000` keep the queue bounded; Postgres is the audit trail |
| Send pacing | Worker limiter meters delivery; nothing bursts regardless of how many come due at once |
| Beyond hourly quota | Overflow rolls into later windows, in order, still `scheduled` - no failures, no drops |
| Multiple workers | Atomic claim + Redis counters mean you can run N worker processes with no double sends and no quota overshoot |

Concretely with defaults (3 senders x 200/hour, 2s spacing): the first ~600 go out over the first
hour at 2s intervals; the remaining ~400 are pushed to the next window preserving order, and drain
there.

Try it:

```bash
npm run loadtest -- --count 1000 --hourly-limit 50 --delay 0
```

---

## Configuration reference

Everything is env-driven and validated with zod at boot (`backend/src/config/env.ts`) - the process
refuses to start with a clear message rather than failing mysteriously at the first send.

| Variable | Default | Purpose |
|---|---|---|
| `WORKER_CONCURRENCY` | `5` | Parallel sends per worker process |
| `MIN_SEND_INTERVAL_MS` | `2000` | Limiter window - the minimum-delay guarantee |
| `GLOBAL_LIMITER_MAX` | `1` | Jobs allowed per limiter window |
| `SEND_INTERVAL_SCOPE` | `global` | `global` or `sender` - what the minimum-gap gate applies to |
| `MAX_EMAILS_PER_HOUR_PER_SENDER` | `200` | Default per-sender hourly quota |
| `ORDER_STEP_MS` | `50` | Per-position offset that preserves FIFO order on overflow |
| `RECONCILE_INTERVAL_MS` | `60000` | Self-rescheduling sweep interval |
| `STALE_LOCK_MS` | `120000` | After this, a `processing` row is treated as abandoned |
| `JOB_ATTEMPTS` / `JOB_BACKOFF_MS` | `3` / `5000` | Retry policy (exponential backoff) |
| `ETHEREAL_SENDER_COUNT` | `3` | Sender accounts created by the seed script |
| `AUTH_DISABLED` | `false` | `true` bypasses auth for Postman testing |

---

## API reference

All `/api/*` routes except `/api/auth/google` require `Authorization: Bearer <token>`.

| Method | Route | Purpose |
|---|---|---|
| `POST` | `/api/auth/google` | Exchange a Google `id_token` for a backend session JWT |
| `GET` | `/api/auth/me` | Current user |
| `POST` | `/api/campaigns` | Schedule a campaign |
| `GET` | `/api/campaigns` | List campaigns with per-status counts |
| `GET` | `/api/emails` | List data, paginated (`status`, `only`, `page`, `limit`, `search`) |
| `GET` | `/api/emails/:id` | Full record including body - backs the detail view |
| `POST` | `/api/emails/:id/cancel` | Cancel a pending email |
| `GET` | `/api/senders` | Sender pool with live hourly usage |
| `GET` | `/api/stats` | Dashboard counts |
| `GET` | `/health` | Liveness + queue depth + effective config (unauthenticated) |

`GET /api/emails` accepts `status=scheduled` (pending + in flight), `status=sent` (terminal), or
`status=all`. The optional `only` parameter narrows to one exact status and drives the filter menu
in the UI. List rows carry a short `preview` of the body rather than the whole thing.

Example `POST /api/campaigns` request:

```json
{
  "subject": "Quick question",
  "body": "Hi there, ...",
  "recipients": ["a@example.com", "b@example.com"],
  "startAt": "2026-08-18T10:00:00.000Z",
  "delaySeconds": 2,
  "hourlyLimit": 200
}
```

`startAt`, `delaySeconds` and `hourlyLimit` are optional and fall back to config defaults. Response:

```json
{
  "campaignId": "9f1c",
  "totalScheduled": 2,
  "firstScheduledAt": "2026-08-18T10:00:00.000Z",
  "lastScheduledAt": "2026-08-18T10:00:02.000Z",
  "senderCount": 3,
  "duplicatesRemoved": 0
}
```

---

## Feature checklist

### Backend

| Requirement | Done | Where |
|---|---|---|
| TypeScript + Express | Yes | `backend/src` |
| BullMQ + Redis, **no cron** | Yes | `queue/emailQueue.ts`, `queue/scheduler.ts` |
| PostgreSQL relational store | Yes | `prisma/schema.prisma` |
| Ethereal SMTP, multiple senders | Yes | `services/mailer.ts`, `scripts/seedSenders.ts` |
| Survives restart, correct timing | Yes | `queue/reconciler.ts` |
| No duplicate sends (idempotency) | Yes | `queue/processor.ts` - atomic claim |
| Configurable worker concurrency | Yes | `worker.ts` - `WORKER_CONCURRENCY` |
| Minimum delay between sends | Yes | `worker.ts` limiter - 2s default |
| Hourly rate limit, per sender | Yes | `services/rateLimiter.ts` - Redis Lua |
| Multi-worker-safe (not in-memory) | Yes | Redis counters + Redis limiter |
| Limits configurable via env | Yes | `config/env.ts` |
| Over-limit jobs delayed, not dropped | Yes | `processor.ts` - `moveToDelayed` |
| Order preserved on overflow | Yes | `seq * ORDER_STEP_MS` offset |
| Retries with backoff | Yes | `JOB_ATTEMPTS`, exponential |
| Graceful shutdown | Yes | `worker.close()` drains in-flight |
| Health endpoint | Yes | `routes/health.ts` |
| Unit tests | Yes | `backend/tests` - 18 tests |

### Frontend

| Requirement | Done | Where |
|---|---|---|
| Real Google OAuth (no mock) | Yes | `lib/auth.ts` - Auth.js Google provider |
| Redirect to dashboard after login | Yes | `app/page.tsx` |
| User name, email, avatar, logout | Yes | `components/layout/Sidebar.tsx` |
| Scheduled / Sent sections | Yes | `app/dashboard/scheduled`, `app/dashboard/sent` |
| Compose New Email entry point | Yes | `components/layout/Sidebar.tsx` |
| Subject + body input | Yes | `components/compose/ComposeView.tsx` |
| CSV/TXT upload + detected count | Yes | `ComposeView.tsx` "Upload List" + `lib/csv.ts` |
| Start time, delay, hourly limit | Yes | `ComposeView.tsx`, `SendLaterPopover.tsx` |
| Scheduled list: email, subject, time, status | Yes | `components/emails/EmailRow.tsx` |
| Sent list + Ethereal preview link | Yes | `EmailRow.tsx`, `EmailDetail.tsx` |
| Loading states | Yes | `components/ui/States.tsx` - skeletons |
| Empty states | Yes | `components/ui/States.tsx` |
| Error handling / toasts | Yes | `react-hot-toast` throughout |
| Reusable components, DRY | Yes | one `EmailListView` serves both sections |
| Typed API responses and props | Yes | `lib/types.ts` |
| Matches the provided Figma | Yes | see "Design" below |

**Extras beyond the brief:** an email detail view, cancel a scheduled email, search, an exact-status
filter menu, pagination, a rich-text body editor, and a completion-time estimate in the composer
that flags when the hourly limit rather than the delay is the binding constraint.

### Design

The UI follows the provided Figma: light surfaces, the green accent, the `ONB` wordmark, the
sidebar with profile card and Scheduled/Sent counts, amber time pills on pending rows, the
full-page composer with `Upload List` and the `Send Later` popover, and the email detail view.

The entire theme is CSS custom properties in one `:root` block in `src/app/globals.css`, mapped
into Tailwind in `tailwind.config.ts`. No component references a raw colour, radius or shadow.

---

## Testing it yourself

```bash
cd backend && npm test
```

18 unit tests, no DB or Redis required. They cover the parts where a subtle bug would be invisible
in a demo: UTC hour bucketing, hour boundary rollover, next-window calculation, **FIFO order
preservation across overflow**, send spacing, and round-robin distribution.

### Manual end-to-end

1. `npm run seed:senders` - three Ethereal accounts printed.
2. `curl localhost:4000/health` - status ok.
3. Sign in with Google - dashboard shows your name, email and avatar.
4. Compose, upload a CSV of ~20 addresses, the dropzone reports **"20 email addresses detected"**,
   set delay `2` and hourly limit `200`, then Schedule.
5. Watch rows move Scheduled to Sent live (4s polling). Click **View** on a sent row to open the
   real message on Ethereal.

**Restart test** - the headline requirement:

1. Schedule 20 emails with a 10s delay so the batch runs for about three minutes.
2. Let a few send, then Ctrl+C both API and worker.
3. Wait a minute, then `npm run dev` again.
4. Already-sent emails stay sent (the count does not increase retroactively, message ids unchanged);
   remaining emails resume on their original schedule.

**Rate-limit test:**

1. Schedule 20 emails with hourly limit `2` and delay `0`.
2. Six send immediately (2 per sender x 3 senders); the rest flip to a `scheduled_at` in the next
   hour window, in their original order, none marked failed.
3. `GET /api/senders` shows each sender at 2 of 2 used.

**Load test:** `npm run loadtest -- --count 1000 --hourly-limit 50 --delay 0`

---

## Verified behaviour

Every claim below was measured against a live PostgreSQL 17.6 and Redis 7.2.5, sending real mail
through Ethereal - not inferred from the code.

| Behaviour | Result |
|---|---|
| Minimum gap between sends | 2000, 2001, 2011, 2008, 2012, 2014, 2000, 2012, 2013 ms across a 10-email burst, in sequence order |
| Round-robin across senders | Exact: lead1 to S1, lead2 to S2, lead3 to S3, lead4 to S1, ... |
| Restart mid-campaign | Killed both processes with 10 of 12 sent, waited 20s, restarted. All 10 kept identical `messageId` and `sentAt`; the remainder delivered. **Nothing re-sent.** |
| Duplicate sends | 11 unique messageIds from 11 sent rows - zero duplicates |
| Hourly cap (limit 2, 3 senders, 12 emails) | 6 sent, 6 deferred, 0 failed, 0 dropped. Redis counters showed 2/2 per sender |
| Overflow ordering | Deferred jobs landed at `nextWindowStart + seq * 50ms`, replaying in exact original order |
| Stale-lock recovery | A row left `processing` by a killed worker is released and re-armed by the reconciler |

Four defects were found and fixed by running it, each of which would have broken a demo:

1. **The worker died at boot.** BullMQ rejects `:` in a custom job id, and the reconciler used
   `reconcile:<slot>`. Nothing sent at all. Job ids now use `-`, and bootstrap failures no longer
   take the process down.
2. **The seed script could only ever create one sender.** `nodemailer.createTestAccount()` memoises
   its first account and returns it for the life of the process. It now calls the Ethereal
   provisioning API directly.
3. **Locks were written 5.5 hours in the future.** The raw claim statement used SQL `NOW()`, a
   `timestamptz`, assigned into a `timestamp without time zone` column - so it stored local
   wall-clock time that Prisma read back as UTC. `locked_at < cutoff` could never be true, so a
   worker that died mid-send left its row stuck permanently. All timestamps are now passed as JS
   `Date` parameters.
4. **The reconciler could not re-arm a finished job.** It tested job existence with `EXISTS`, but
   `removeOnComplete` retains finished jobs, so a row back in `scheduled` whose job had already run
   looked healthy and was skipped forever. It now reads `timestamp` and `finishedOn` together to
   tell "no job", "still pending" and "already ran" apart.

## Assumptions, shortcuts and trade-offs

**Deliberate design choices**

- **`GLOBAL_LIMITER_MAX = 1` caps effective concurrency.** A strict 2s minimum between sends and
  meaningful parallelism are mutually exclusive; I chose the strict reading of the requirement and
  made the knob an env var. Documented above rather than hidden.
- **Redis is disposable; Postgres is not.** Costs an extra reconciliation sweep, buys full recovery
  from a flushed Redis.
- **Order preservation is best-effort, not a hard guarantee.** `seq`-derived offsets keep a batch in
  order through overflow, but under severe multi-instance clock skew two jobs could invert. A hard
  guarantee would need a per-sender sequencer and would cost throughput.
- **The Google ID token is exchanged once for a backend JWT** rather than verified on every request.
  Google ID tokens expire after an hour; this avoids a surprise 401 mid-demo.

**Shortcuts taken under time pressure**

- **Ethereal SMTP credentials are stored in plaintext** in Postgres. Fine for throwaway test
  accounts; production would use a secrets manager and store only a reference.
- **The frontend polls every 4 seconds** instead of using WebSockets or SSE. Simpler, and at this
  scale the difference is invisible - rows still visibly move from Scheduled to Sent while you
  watch.
- **CSV is parsed in the browser** and sent as a JSON array, rather than streamed as multipart. This
  gives an instant detected-address count, but would not suit a 500k-row file.
- **No automated integration tests against a live Postgres/Redis.** The unit tests cover the pure
  scheduling and rate-limit logic. The stateful paths were instead verified by hand against real
  infrastructure - sending, restart/idempotency, stale-lock recovery, minimum send spacing and
  hourly-cap overflow all measured directly (see "Verified behaviour" below).
- **Tailwind v3 rather than v4** - the v3 ecosystem is more settled and this was not the place to
  spend risk budget.
- **The compose body is a `contenteditable` driven by `document.execCommand`.** execCommand is
  formally deprecated, but it is the only rich-text API implemented consistently across browsers
  without adding a full editor framework for a toolbar this small.
- **HTML bodies are sanitised with regexes** (`backend/src/lib/html.ts`) rather than a vetted
  library such as sanitize-html or DOMPurify. It strips script/iframe/style elements, inline event
  handlers and `javascript:` URLs, which covers the realistic cases here, but a production system
  should use a real parser-based sanitiser.
- **The login screen's email/password fields are rendered but not wired up.** They are in the
  Figma, so they are drawn; the brief requires real Google OAuth and there is no password
  credential store behind this, so submitting explains that instead of failing silently.
- **Attachments are not implemented.** The paperclip appears in the Figma so it is present, but it
  reports that attachments are unsupported rather than pretending to work.
- **`AUTH_DISABLED=true`** exists so the API can be exercised from Postman before OAuth credentials
  are configured. It must never be enabled outside local development.

**Assumptions**

- One shared sender pool rather than per-user senders - the brief asks for multiple senders, not
  multi-tenancy.
- Campaign `hourlyLimit` is interpreted as a **per-sender** cap, composed with each sender's own
  quota via `min()`, since the brief offers per-sender limiting as an explicit option.
- All rate-limit windows are **UTC** hours, so behaviour does not shift with server timezone or DST.
- Recipients are de-duplicated per campaign; the same address across two campaigns is intentionally
  allowed.
