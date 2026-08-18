/** Mirrors the backend Prisma `EmailStatus` enum. */
export type EmailStatus = 'scheduled' | 'processing' | 'sent' | 'failed' | 'cancelled';

/** Which view is active; also the `status` query param the API takes. */
export type EmailListFilter = 'scheduled' | 'sent';

export interface SenderRef {
  email: string;
  name: string;
}

/** List-row shape: carries a short `preview` rather than the whole body. */
export interface EmailJob {
  id: string;
  recipient: string;
  subject: string;
  preview: string;
  status: EmailStatus;
  scheduledAt: string;
  sentAt: string | null;
  attempts: number;
  error: string | null;
  previewUrl: string | null;
  seq: number;
  sender: SenderRef;
}

/** Detail-view shape: the full record including the HTML body. */
export interface EmailDetailRecord {
  id: string;
  recipient: string;
  subject: string;
  body: string;
  status: EmailStatus;
  scheduledAt: string;
  sentAt: string | null;
  attempts: number;
  error: string | null;
  messageId: string | null;
  previewUrl: string | null;
  seq: number;
  createdAt: string;
  sender: SenderRef;
  campaign: {
    id: string;
    delayMs: number;
    hourlyLimit: number;
    totalRecipients: number;
  };
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface EmailListResponse {
  items: EmailJob[];
  pagination: Pagination;
}

export interface Stats {
  scheduled: number;
  processing: number;
  sent: number;
  failed: number;
  cancelled: number;
  pending: number;
  total: number;
}

export interface Sender {
  id: string;
  name: string;
  email: string;
  active: boolean;
  maxEmailsPerHour: number;
  usedThisHour: number;
  remainingThisHour: number;
}

export interface SendersResponse {
  senders: Sender[];
  window: { current: string; resetsAt: string };
}

export interface ScheduleCampaignRequest {
  subject: string;
  body: string;
  recipients: string[];
  startAt?: string;
  delaySeconds?: number;
  hourlyLimit?: number;
}

export interface ScheduleCampaignResponse {
  campaignId: string;
  totalScheduled: number;
  firstScheduledAt: string;
  lastScheduledAt: string;
  senderCount: number;
  duplicatesRemoved: number;
}
