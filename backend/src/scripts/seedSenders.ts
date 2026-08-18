/**
 * Creates Ethereal test SMTP accounts and stores them as senders.
 *
 * Ethereal requires no signup, so a reviewer can clone this repo and have
 * working "multiple senders" in one command. Credentials are also written to
 * .ethereal.json (gitignored) so you can log in at https://ethereal.email and
 * browse the mailbox during a demo.
 *
 * Note on nodemailer.createTestAccount(): it memoises the first account for the
 * lifetime of the process and returns that same account on every subsequent
 * call, so it cannot produce a pool of distinct senders. We therefore call the
 * Ethereal provisioning API directly, which is what createTestAccount wraps.
 */
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { env } from '../config/env.js';
import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';

const ETHEREAL_API = 'https://api.nodemailer.com/user';

interface EtherealAccount {
  user: string;
  pass: string;
  smtp: { host: string; port: number; secure: boolean };
}

async function createEtherealAccount(): Promise<EtherealAccount> {
  const response = await fetch(ETHEREAL_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestor: 'nodemailer', version: '6.9.16' }),
  });

  if (!response.ok) {
    throw new Error(`Ethereal provisioning failed: ${response.status} ${await response.text()}`);
  }

  return (await response.json()) as EtherealAccount;
}

async function main(): Promise<void> {
  const target = env.ETHEREAL_SENDER_COUNT;
  const existing = await prisma.sender.count();

  if (existing >= target) {
    logger.info({ existing, target }, 'Sender pool already provisioned - nothing to do');
    logger.info('To rebuild the pool: npx prisma studio, delete the senders, then re-run.');
    return;
  }

  // Top up rather than all-or-nothing, so a partially completed run resumes
  // instead of leaving the pool stuck below target.
  const toCreate = target - existing;
  logger.info({ existing, toCreate }, 'Provisioning Ethereal test accounts...');

  const created: Array<{ name: string; email: string; pass: string }> = [];

  for (let i = 0; i < toCreate; i += 1) {
    const account = await createEtherealAccount();

    const sender = await prisma.sender.create({
      data: {
        name: `Sender ${existing + i + 1}`,
        email: account.user,
        smtpHost: account.smtp.host,
        smtpPort: account.smtp.port,
        smtpSecure: account.smtp.secure,
        smtpUser: account.user,
        smtpPass: account.pass,
        maxEmailsPerHour: env.MAX_EMAILS_PER_HOUR_PER_SENDER,
        active: true,
      },
    });

    created.push({ name: sender.name, email: sender.email, pass: account.pass });
    logger.info({ name: sender.name, email: sender.email }, 'Sender created');
  }

  const all = await prisma.sender.findMany({ orderBy: { createdAt: 'asc' } });
  const outFile = path.resolve(process.cwd(), '.ethereal.json');
  await writeFile(
    outFile,
    JSON.stringify(
      all.map((s) => ({ name: s.name, user: s.smtpUser, pass: s.smtpPass, web: 'https://ethereal.email/login' })),
      null,
      2,
    ),
    'utf8',
  );

  console.log('\n-------------------------------------------------------------');
  console.log(` Sender pool: ${all.length} accounts, ${env.MAX_EMAILS_PER_HOUR_PER_SENDER}/hour each`);
  console.log('-------------------------------------------------------------');
  for (const sender of all) {
    console.log(`  ${sender.name}`);
    console.log(`    user: ${sender.smtpUser}`);
    console.log(`    pass: ${sender.smtpPass}`);
  }
  console.log('\n  Log in at https://ethereal.email/login to view sent mail.');
  console.log(`  Credentials also saved to ${outFile} (gitignored).\n`);
}

main()
  .catch((err) => {
    logger.error({ err }, 'Seeding failed');
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
