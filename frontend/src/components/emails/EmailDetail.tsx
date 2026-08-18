'use client';

import { useRouter } from 'next/navigation';
import { ArrowLeft, Archive, ExternalLink, Star, Trash2 } from 'lucide-react';
import clsx from 'clsx';
import toast from 'react-hot-toast';
import { useCancelEmail, useEmail } from '@/hooks/useApi';
import { ErrorState, ListSkeleton } from '@/components/ui/States';
import { formatDateTime, formatRelative, initialsOf } from '@/lib/format';
import type { EmailStatus } from '@/lib/types';

const STATUS_PILL: Record<EmailStatus, { label: string; className: string }> = {
  scheduled: { label: 'Scheduled', className: 'bg-scheduled-soft text-scheduled-fg' },
  processing: { label: 'Sending', className: 'bg-scheduled-soft text-scheduled-fg' },
  sent: { label: 'Sent', className: 'bg-sent-soft text-sent-fg' },
  failed: { label: 'Failed', className: 'bg-danger-soft text-danger' },
  cancelled: { label: 'Cancelled', className: 'bg-sent-soft text-sent-fg' },
};

export function EmailDetail({ id }: { id: string }) {
  const router = useRouter();
  const { data, isLoading, error, refetch } = useEmail(id);
  const cancelEmail = useCancelEmail();

  if (isLoading && !data) return <ListSkeleton rows={4} />;
  if (error) return <ErrorState message={(error as Error).message} onRetry={() => void refetch()} />;
  if (!data) return null;

  const email = data.email;
  const pill = STATUS_PILL[email.status];
  const isPending = email.status === 'scheduled' || email.status === 'processing';

  const handleCancel = () => {
    cancelEmail.mutate(email.id, {
      onSuccess: () => {
        toast.success('Email cancelled');
        void refetch();
      },
      onError: (err: Error) => toast.error(err.message),
    });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <header className="flex items-center gap-3 px-6 py-4">
        <button
          onClick={() => router.back()}
          aria-label="Back"
          className="rounded-control p-1 text-fg transition-colors hover:bg-surface-hover"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>

        <h1 className="min-w-0 flex-1 truncate text-[19px] font-medium text-fg">{email.subject}</h1>

        <div className="flex items-center gap-1 text-subtle">
          <button aria-label="Star" className="rounded-control p-1.5 hover:bg-surface-hover">
            <Star className="h-4 w-4" />
          </button>
          <button aria-label="Archive" className="rounded-control p-1.5 hover:bg-surface-hover">
            <Archive className="h-4 w-4" />
          </button>
          <button
            onClick={handleCancel}
            disabled={!isPending || cancelEmail.isPending}
            aria-label={isPending ? 'Cancel this email' : 'Cannot cancel a delivered email'}
            title={isPending ? 'Cancel this email' : 'Only pending emails can be cancelled'}
            className="rounded-control p-1.5 transition-colors hover:bg-danger-soft hover:text-danger disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-subtle"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </header>

      <div className="px-6 pb-10">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand text-[13px] font-semibold text-brand-fg">
            {initialsOf(email.sender.name)}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="text-[13px] font-semibold text-fg">{email.sender.name}</span>
              <span className="text-[12px] text-muted">&lt;{email.sender.email}&gt;</span>
              <span
                className={clsx(
                  'ml-1 rounded-pill px-2 py-0.5 text-[11px] font-medium',
                  pill.className,
                )}
              >
                {pill.label}
              </span>
            </div>
            <p className="mt-0.5 text-[12px] text-muted">to {email.recipient}</p>
          </div>

          <div className="shrink-0 text-right">
            <p className="text-[12px] text-muted">
              {formatDateTime(email.sentAt ?? email.scheduledAt)}
            </p>
            <p className="text-[11px] text-subtle">
              {email.sentAt ? 'sent' : 'scheduled'} {formatRelative(email.sentAt ?? email.scheduledAt)}
            </p>
          </div>
        </div>

        {email.status === 'failed' && email.error && (
          <div className="mt-5 rounded-control bg-danger-soft px-4 py-3 text-[13px] text-danger">
            <span className="font-medium">Delivery failed</span> after {email.attempts} attempt
            {email.attempts === 1 ? '' : 's'}: {email.error}
          </div>
        )}

        {/* Body is stored as an HTML fragment and sanitised on the backend
            before it is ever persisted or emailed. */}
        <div
          className="prose-sm mt-6 max-w-none text-[14px] leading-relaxed text-fg [&_a]:text-brand [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted [&_li]:ml-5 [&_ol]:list-decimal [&_p]:mb-3 [&_ul]:list-disc"
          dangerouslySetInnerHTML={{ __html: email.body }}
        />

        {email.previewUrl && (
          <a
            href={email.previewUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-8 inline-flex items-center gap-1.5 rounded-control border border-border px-3 py-2 text-[12px] font-medium text-fg transition-colors hover:bg-surface-hover"
          >
            View delivered message on Ethereal
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}

        <dl className="mt-8 grid grid-cols-2 gap-x-8 gap-y-3 border-t border-border pt-6 text-[12px] sm:grid-cols-4">
          <Meta label="Position in campaign" value={`#${email.seq + 1} of ${email.campaign.totalRecipients}`} />
          <Meta label="Delay between sends" value={`${email.campaign.delayMs / 1000}s`} />
          <Meta label="Hourly limit" value={`${email.campaign.hourlyLimit}/sender`} />
          <Meta label="Attempts" value={String(email.attempts)} />
        </dl>
      </div>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-subtle">{label}</dt>
      <dd className="mt-0.5 font-medium text-fg">{value}</dd>
    </div>
  );
}
