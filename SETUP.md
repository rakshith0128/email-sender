# Setup Guide

Everything you need to do by hand, in order. Budget about 20 minutes.

Nothing here needs Docker. Steps 1 and 2 install PostgreSQL and a Redis-compatible server natively
on Windows. If you would rather use Docker, see the Docker alternative at the bottom.

---

## Step 1 - Install PostgreSQL

Open **PowerShell** and run:

```powershell
winget install PostgreSQL.PostgreSQL.17
```

The installer asks for a **superuser password**. Pick something you will remember and write it
down - you need it in step 3. Accept the defaults for everything else (port 5432, locale).

Close and reopen PowerShell so PATH updates, then create the database:

```powershell
& "C:\Program Files\PostgreSQL\17\bin\createdb.exe" -U postgres -h localhost email_scheduler
```

It prompts for the password you just set. No output means it worked.

Verify:

```powershell
& "C:\Program Files\PostgreSQL\17\bin\psql.exe" -U postgres -h localhost -l
```

You should see `email_scheduler` in the list.

---

## Step 2 - Install Redis

Windows has no official Redis build. **Memurai** is the Redis-recommended Windows-native port,
API-compatible with Redis 7.4 - well past the 6.2 that BullMQ requires. Developer edition is free.

```powershell
winget install Memurai.MemuraiDeveloper
```

It installs as a Windows **service** and starts automatically on port 6379, so there is nothing to
keep running in a terminal.

Verify:

```powershell
memurai-cli ping
```

Expected output: `PONG`

If `memurai-cli` is not recognised, reopen PowerShell, or call it directly:

```powershell
& "C:\Program Files\Memurai\memurai-cli.exe" ping
```

Check the service state with `Get-Service Memurai`.

---

## Step 3 - Configure and initialise the backend

`backend/.env` already exists. Open it and set **one** value - your Postgres password from step 1:

```ini
DATABASE_URL=postgresql://postgres:YOUR_PASSWORD_HERE@localhost:5432/email_scheduler
```

If your password contains an at-sign, colon, slash or hash, percent-encode it (an at-sign becomes
%40).

Leave everything else for now - you come back for `GOOGLE_CLIENT_ID` in step 5.

Create the schema:

```bash
cd backend
npm run prisma:migrate
```

When it asks for a migration name, type `init` and press Enter.

Then provision the SMTP senders:

```bash
npm run seed:senders
```

This prints three Ethereal accounts. **No signup needed** - nodemailer provisions them over the
Ethereal API. Credentials are also written to `backend/.ethereal.json` (gitignored) so you can log
in at https://ethereal.email/login during the demo and show the received mail.

---

## Step 4 - Start the Backend

```bash
cd backend
npm run dev
```

This runs the API (port 4000) **and** the BullMQ worker together, with colour-coded logs.

In another terminal:

```bash
curl http://localhost:4000/health
```

You want `"status":"ok"` with `"database":true` and `"redis":true`. If either is false, revisit
step 1 or 2.

---

## Step 5 - Google OAuth credentials

This is the fiddliest step. Take it slowly; the redirect URI has to match exactly.

Google recently replaced the old "OAuth consent screen" page with the **Google Auth Platform**,
so the External option now lives inside a setup wizard rather than on its own screen.

1. Go to https://console.cloud.google.com/ and create a project (top-left project dropdown, then
   **New Project**). Wait for it to be created and make sure it is selected.

2. Left menu, **Google Auth Platform** -> **Overview**. If you see "Google auth platform not
   configured yet", click **Get started** and work through the wizard:
   - **App Information** - App name: `Email Scheduler`. User support email: your own.  Next.
   - **Audience** - choose **External**. (This is where the old "External" option moved to.)  Next.
   - **Contact Information** - your email.  Next.
   - Tick the User Data Policy checkbox, then **Create**.

3. Left menu, **Clients** -> **+ Create client**:
   - Application type: **Web application**
   - Name: `Email Scheduler Web`
   - Under **Authorised JavaScript origins**, Add URI:
     ```
     http://localhost:3000
     ```
   - Under **Authorised redirect URIs**, Add URI - this must be character-for-character exact:
     ```
     http://localhost:3000/api/auth/callback/google
     ```
   - **Create**. Copy the **Client ID** and **Client secret**.

4. Left menu, **Audience** -> scroll to **Test users** -> **+ Add users** -> add your own Gmail
   address -> **Save**.

   Do not skip this. While the app is unpublished, Google blocks any account that is not listed as
   a test user, and the error it returns does not explain why.

5. Generate a session secret (only if `AUTH_SECRET` is empty in `frontend/.env.local`):

   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

6. Open `frontend/.env.local` and fill in three values:

   ```ini
   AUTH_GOOGLE_ID=<the Client ID from step 4>
   AUTH_GOOGLE_SECRET=<the Client secret from step 4>
   AUTH_SECRET=<the random string from step 5>
   ```

7. Open `backend/.env` and set `GOOGLE_CLIENT_ID` to the **same Client ID**:

   ```ini
   GOOGLE_CLIENT_ID=<the Client ID from step 4>
   ```

   The backend uses it to verify the Google ID token the frontend sends. If the two do not match,
   login appears to succeed but the dashboard shows a "Backend session not established" warning.

8. Restart the backend so it picks up the new value.

---

## Step 6 - Start the frontend

```bash
cd frontend
npm run dev
```

Open http://localhost:3000, click **Continue with Google**, and sign in with the account you added
as a test user.

Google will warn that the app is not verified - that is expected for an unpublished OAuth app.
Click **Advanced**, then **Go to Email Scheduler (unsafe)**.

You should land on the dashboard with your name, email and avatar in the header.

---

## Step 7 - Try it

A sample leads file is provided at `sample-leads.csv` (25 addresses).

1. Click **Compose** in the sidebar.
2. Click **Upload List** on the To row and pick `sample-leads.csv`. It reports
   **25 email addresses detected** and fills the To field with chips.
3. Enter a subject, and type a body in the editor.
4. Delay between 2 emails: `2`. Hourly Limit: `200`.
5. Optionally click the clock icon to pick a start time - otherwise it starts now.
6. Click **Send** (the button reads **Send Later** once you have picked a time).

**Scheduled** fills immediately. Rows move to **Sent** as the worker delivers them, about one every
two seconds. Click any row to open the email, where a **View delivered message on Ethereal** link
appears once it has been sent.

---

## Docker alternative

If you have Docker Desktop, skip steps 1 and 2 entirely:

```bash
docker compose up -d
```

Then set `backend/.env` to:

```ini
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/email_scheduler
REDIS_URL=redis://localhost:6379
```

and continue from step 3.

---

## Publishing to GitHub

The repository is already initialised and committed locally. Create a **private** repo on GitHub,
then:

```bash
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git branch -M main
git push -u origin main
```

Then add the reviewers: repo **Settings**, then **Collaborators**, then **Add people**, and invite
`Mitrajit` and `Yadav036`.

Nothing sensitive is committed - `.env`, `.env.local` and `.ethereal.json` are all gitignored. Only
the `.example` files are tracked.

---

## Troubleshooting

**`/health` shows `"database": false`**
Postgres is not running or `DATABASE_URL` is wrong. Check the service:
`Get-Service postgresql*`. Confirm the password, and percent-encode special characters.

**`/health` shows `"redis": false`**
`Get-Service Memurai` should be Running. Start it with `Start-Service Memurai`.

**Login works but the dashboard warns "Backend session not established"**
`GOOGLE_CLIENT_ID` in `backend/.env` does not match `AUTH_GOOGLE_ID` in `frontend/.env.local`, or
the backend was not restarted. Fix, restart the backend, then sign out and back in.

**Google says `redirect_uri_mismatch`**
The redirect URI must be exactly `http://localhost:3000/api/auth/callback/google` - http not https,
no trailing slash, port 3000.

**Google says "access blocked" / "app not verified"**
Your Gmail address is not in the OAuth consent screen **Test users** list. Add it.

**Nothing sends and the worker log is quiet**
No senders exist. Run `npm run seed:senders`. `GET /api/senders` should list three.

**Emails stay Scheduled long past their time**
The hourly quota is spent - by design they roll into the next window. Check `GET /api/senders`
for `usedThisHour` against `maxEmailsPerHour`.

**Port 4000 or 3000 already in use**
Find and stop the process:
```powershell
Get-NetTCPConnection -LocalPort 4000 -State Listen | Select-Object OwningProcess
Stop-Process -Id <PID> -Force
```
