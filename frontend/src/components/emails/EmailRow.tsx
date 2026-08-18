'use client';

import { useRouter } from 'next/navigation';
import { Clock, Star } from 'lucide-react';
import clsx from 'clsx';
import { formatRowTime } from '@/lib/format';
import type { EmailJob } from '@/lib/types';

/**
 * One row in the list. Scheduled rows lead with an amber time pill; terminal
 * rows lead with a neutral status pill, matching the two states in the Figma.
 */
export function EmailRow({ email }: { email: EmailJob }) {
  const router = useRouter();
  const isPending = email.status === 'scheduled' || email.status === 'processing';

  return (
    <button
      onClick={() => router.push(`/dashboard/email/${email.id}`)}
      className="flex w-full items-center gap-4 border-b border-border px-6 py-3.5 text-left transition-colors hover:bg-surface-hover"
    >
      <span className="w-[150px] shrink-0 truncate text-[13px] text-fg">
        To: {email.recipient}
      </span>

      {isPending ? (
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-pill bg-scheduled-soft px-2.5 py-1 text-[11px] font-medium text-scheduled-fg">
          <Clock className="h-3 w-3" />
          {formatRowTime(email.scheduledAt)}
        </span>
      ) : (
        <span
          className={clsx(
            'inline-flex shrink-0 items-center rounded-pill px-2.5 py-1 text-[11px] font-medium',
            email.status === 'failed'
              ? 'bg-danger-soft text-danger'
              : 'bg-sent-soft text-sent-fg',
          )}
        >
          {email.status === 'failed' ? 'Failed' : email.status === 'sent' ? 'Sent' : 'Cancelled'}
        </span>
      )}

      <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
        <span className="shrink-0 text-[13px] font-semibold text-fg">{email.subject}</span>
        <span className="truncate text-[13px] text-subtle">- {email.preview}</span>
      </span>

      <Star className="h-4 w-4 shrink-0 text-border-strong" />
    </button>
  );
}
