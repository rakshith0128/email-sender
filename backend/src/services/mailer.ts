import nodemailer, { type Transporter } from 'nodemailer';
import type { Sender } from '@prisma/client';
import { logger } from '../lib/logger.js';
import { htmlToText, sanitizeHtml } from '../lib/html.js';

/**
 * One pooled SMTP transport per sender, cached for the life of the process.
 * Building a transport per email would open a fresh TCP+TLS handshake for every
 * send, which is exactly the cost pooling exists to avoid.
 */
const transports = new Map<string, Transporter>();

function getTransport(sender: Sender): Transporter {
  const cached = transports.get(sender.id);
  if (cached) return cached;

  const transport = nodemailer.createTransport({
    host: sender.smtpHost,
    port: sender.smtpPort,
    secure: sender.smtpSecure,
    auth: { user: sender.smtpUser, pass: sender.smtpPass },
    pool: true,
    maxConnections: 3,
    maxMessages: 100,
  });

  transports.set(sender.id, transport);
  return transport;
}

export interface SendResult {
  messageId: string;
  /** Ethereal-hosted link to view the message — surfaced in the Sent table. */
  previewUrl: string | null;
}

export async function sendEmail(params: {
  sender: Sender;
  to: string;
  subject: string;
  body: string;
}): Promise<SendResult> {
  const { sender, to, subject, body } = params;
  const transport = getTransport(sender);

  // `body` arrives as an HTML fragment from the compose editor. Send both
  // parts so clients that refuse HTML still get a readable message.
  const info = await transport.sendMail({
    from: `"${sender.name}" <${sender.email}>`,
    to,
    subject,
    text: htmlToText(body),
    html: wrapHtml(sanitizeHtml(body)),
  });

  const previewUrl = nodemailer.getTestMessageUrl(info);

  return {
    messageId: info.messageId,
    previewUrl: typeof previewUrl === 'string' ? previewUrl : null,
  };
}

/** Wrap the sanitised fragment so the message renders with sane defaults. */
function wrapHtml(html: string): string {
  return `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.6;color:#1a1c21;">${html}</div>`;
}

/** Verify a sender's SMTP credentials actually work (used by the seed script). */
export async function verifySender(sender: Sender): Promise<boolean> {
  try {
    await getTransport(sender).verify();
    return true;
  } catch (err) {
    logger.warn({ err, sender: sender.email }, 'SMTP verification failed');
    return false;
  }
}

export async function closeAllTransports(): Promise<void> {
  for (const transport of transports.values()) transport.close();
  transports.clear();
}
