# Demo Video Script

Target: **under 5 minutes**. Record with the Windows Game Bar (Win+G) or OBS.

**Before you hit record**

- `npm run dev` in `backend/` and `npm run dev` in `frontend/` are both running.
- You are already signed in at http://localhost:3000/dashboard - do the Google login once
  beforehand so you are not fighting the consent screen on camera.
- A terminal is visible next to the browser. Reviewers want to see the worker log.
- `sample-leads.csv` is somewhere easy to drag from.
- Open a second browser tab logged into https://ethereal.email with one of the seeded accounts.

Suggested lower-thirds text is in **bold** below - say it, do not read it verbatim.

---

## 0:00 - 0:25  Overview

Show the dashboard.

> "This is an email scheduler built on Express, BullMQ and Postgres. The sidebar shows my Google
> account - real OAuth, not a mock - and the two sections, Scheduled and Sent, with live counts."

Mention **three Ethereal senders, 200 emails per hour each**.

---

## 0:25 - 1:20  Schedule a campaign

Click **Compose** in the sidebar.

- Click **Upload List** and pick `sample-leads.csv`.

> "It parses the CSV in the browser and reports **25 email addresses detected**, filling the To
> field. It scans every column, so any export layout works, and duplicates are removed."

- Type a subject and body.
- Delay between 2 emails: `2`. Hourly Limit: `200`.
- Click the clock icon to show the Send Later options, then pick a start time.

Point at the estimate line under the editor.

> "It tells me how long the batch will take, and warns me when the hourly limit rather than the
> delay is the binding constraint."

Click **Send Later**. A toast confirms how many were scheduled.

---

## 1:20 - 2:05  Watch it run

Scheduled tab is full. Let it sit.

> "Each row has its own scheduled time, two seconds apart. The worker is picking them up as they
> come due - no cron, no polling loop. These are BullMQ delayed jobs sitting in Redis."

Show rows moving to **Sent**. Click the Sent section, then open a row.

> "Each email has its own detail view, and once delivered it links straight to the real message on
> Ethereal."

Show the worker terminal logging `Email sent` lines roughly two seconds apart.

---

## 2:05 - 3:10  The restart test

**This is the most important part. Do not rush it.**

Note the Sent count out loud, e.g. "eight sent so far".

Ctrl+C **both** the API and the worker.

> "Server's down. Killing it mid-campaign."

Show the dashboard failing to reach the API. Wait ~20 seconds so several more emails come due while
everything is dead.

Restart with `npm run dev`.

> "On boot the reconciler queries Postgres for everything still pending and re-arms it in Redis.
> Postgres is the source of truth; Redis is just the execution engine."

Point at the startup log line showing the reconciliation result.

> "The emails that came due while it was down go out immediately. The rest keep their original
> schedule. And critically - the eight that already sent are still eight. Nothing re-sends."

Show the Sent count climbing from where it was, not from zero.

---

## 3:10 - 4:15  Rate limiting and delay under load

New terminal:

```bash
cd backend
npm run loadtest -- --count 1000 --hourly-limit 5 --delay 0
```

> "A thousand emails, all due right now, with the hourly limit dropped to five per sender."

Show the script reporting the enqueue time.

> "A thousand rows inserted and queued in well under a second - chunked bulk insert and bulk
> enqueue."

Switch to the dashboard, and hit `GET /api/senders` in a terminal to show the live counters.

> "Fifteen go out - five per sender, three senders. The other 985 are **not dropped and not
> failed**. They stay Scheduled, pushed into the next hour window, and they keep their original
> order because each one is offset by its position in the campaign."

Scan the Scheduled section - the time pills show the pushed-out slots, still in sequence.

> "The counters are Redis-backed with a Lua script, so the check and increment are atomic. Run ten
> workers and the limit still holds."

Also point out the send spacing in the worker log.

> "And there's a hard two-second minimum between any two sends, enforced by the BullMQ limiter -
> also in Redis, so it's global, not per-process."

---

## 4:15 - 4:45  Idempotency and wrap-up

> "Every email row's primary key is also its BullMQ job id, so re-enqueueing is a no-op. And before
> any send the worker does a conditional UPDATE that only succeeds if the row is still scheduled.
> Two workers racing on the same job, a stalled-job redelivery, a reconciler double-add - only one
> ever sends."

Optionally show `curl http://localhost:4000/health` with the queue counts and config.

> "README covers the architecture, the rate limiting, the restart handling, and the trade-offs I
> made. Thanks for watching."

---

## Checklist - the brief asks for these explicitly

- [ ] Creating scheduled emails (frontend or Postman)
- [ ] Dashboard showing Scheduled and Sent
- [ ] Restart scenario: stop server, start again, future emails still send
- [ ] Bonus: rate limiting / delay behaviour under load
