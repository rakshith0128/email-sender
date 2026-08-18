'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Clock, Send } from 'lucide-react';
import { EmailRow } from './EmailRow';
import { ListToolbar, type FilterOption } from './ListToolbar';
import { EmptyState, ErrorState, ListSkeleton } from '@/components/ui/States';
import { useEmails } from '@/hooks/useApi';
import type { EmailListFilter, EmailStatus } from '@/lib/types';

/** Filter-menu options per view - only statuses that view can contain. */
const FILTERS: Record<EmailListFilter, ReadonlyArray<FilterOption>> = {
  scheduled: [
    { value: 'all', label: 'All' },
    { value: 'scheduled', label: 'Scheduled' },
    { value: 'processing', label: 'Sending' },
  ],
  sent: [
    { value: 'all', label: 'All' },
    { value: 'sent', label: 'Sent' },
    { value: 'failed', label: 'Failed' },
    { value: 'cancelled', label: 'Cancelled' },
  ],
};

/**
 * Both the Scheduled and Sent routes render this. The only differences are the
 * available filters and the empty state, so keeping it as one component stops
 * the two views drifting apart.
 */
export function EmailListView({ filter }: { filter: EmailListFilter }) {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [only, setOnly] = useState<EmailStatus | 'all'>('all');

  const emails = useEmails(filter, page, search || undefined, only === 'all' ? undefined : only);
  const items = emails.data?.items;
  const pagination = emails.data?.pagination;

  const resetTo = (updater: () => void) => {
    updater();
    setPage(1);
  };

  return (
    <>
      <ListToolbar
        search={search}
        onSearchChange={(value) => resetTo(() => setSearch(value))}
        filter={only}
        onFilterChange={(value) => resetTo(() => setOnly(value))}
        options={FILTERS[filter]}
        onRefresh={() => void emails.refetch()}
        refreshing={emails.isFetching}
      />

      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* Skeleton only on first load - a polling refetch must not blank out
            a list the user is reading. */}
        {emails.isLoading && !items ? (
          <ListSkeleton />
        ) : emails.error ? (
          <ErrorState
            message={(emails.error as Error).message}
            onRetry={() => void emails.refetch()}
          />
        ) : !items || items.length === 0 ? (
          filter === 'scheduled' ? (
            <EmptyState
              icon={Clock}
              title="No scheduled emails"
              description="Compose a campaign and upload a list of leads to queue your first batch."
              action={{ label: 'Compose', onClick: () => router.push('/dashboard/compose') }}
            />
          ) : (
            <EmptyState
              icon={Send}
              title="No sent emails yet"
              description="Once your scheduled emails go out, they will appear here with their delivery status."
            />
          )
        ) : (
          items.map((email) => <EmailRow key={email.id} email={email} />)
        )}
      </div>

      {pagination && pagination.totalPages > 1 && (
        <div className="flex items-center justify-between border-t border-border px-6 py-3">
          <p className="text-[11px] text-muted">
            Page {pagination.page} of {pagination.totalPages} - {pagination.total.toLocaleString()}{' '}
            total
          </p>
          <div className="flex gap-2">
            <button
              disabled={page <= 1}
              onClick={() => setPage((value) => value - 1)}
              className="h-8 rounded-control border border-border px-3 text-[12px] text-fg transition-colors hover:bg-surface-hover disabled:opacity-40"
            >
              Previous
            </button>
            <button
              disabled={page >= pagination.totalPages}
              onClick={() => setPage((value) => value + 1)}
              className="h-8 rounded-control border border-border px-3 text-[12px] text-fg transition-colors hover:bg-surface-hover disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </>
  );
}
