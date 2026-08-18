'use client';

import { useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Clock, Paperclip, Upload } from 'lucide-react';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import { RecipientChips } from './RecipientChips';
import { RichTextEditor } from './RichTextEditor';
import { SendLaterPopover } from './SendLaterPopover';
import { useScheduleCampaign, useSenders } from '@/hooks/useApi';
import { parseLeadFile } from '@/lib/csv';
import { plainTextPreview, toDateTimeLocalValue } from '@/lib/format';

/** Label + control on one baseline, as in the Figma. */
function Field({
  label,
  children,
  action,
}: {
  label: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-4 border-b border-border py-2.5">
      <span className="w-[52px] shrink-0 text-[13px] text-muted">{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
      {action}
    </div>
  );
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
}

export function ComposeView() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [recipients, setRecipients] = useState<string[]>([]);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [delaySeconds, setDelaySeconds] = useState('2');
  const [hourlyLimit, setHourlyLimit] = useState('200');
  const [startAt, setStartAt] = useState('');
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [uploadNote, setUploadNote] = useState<string | null>(null);

  const schedule = useScheduleCampaign();
  const { data: sendersData } = useSenders();
  const senderPool = sendersData?.senders.filter((sender) => sender.active) ?? [];

  const handleUpload = async (file: File) => {
    try {
      const result = await parseLeadFile(file);
      if (result.emails.length === 0) {
        toast.error('No email addresses found in that file.');
        setUploadNote(null);
        return;
      }

      // Merge rather than replace, so an uploaded list adds to anything typed.
      const merged = Array.from(new Set([...recipients, ...result.emails]));
      setRecipients(merged);

      const dupes = result.duplicatesRemoved;
      const duplicateNote =
        dupes > 0 ? `, ${dupes.toLocaleString()} duplicate${dupes === 1 ? '' : 's'} removed` : '';

      setUploadNote(
        `${file.name}: ${result.emails.length.toLocaleString()} email ${
          result.emails.length === 1 ? 'address' : 'addresses'
        } detected${duplicateNote}`,
      );
      toast.success(`${result.emails.length.toLocaleString()} addresses detected`);
    } catch {
      toast.error('Could not read that file.');
    }
  };

  /**
   * Live estimate of how long the batch takes. Two ceilings apply - the
   * per-email delay, and the combined hourly quota across every sender - and
   * the batch finishes no sooner than the slower of the two.
   */
  const estimate = useMemo(() => {
    const count = recipients.length;
    if (count === 0) return null;

    const delay = Number(delaySeconds) || 0;
    const limit = Number(hourlyLimit) || 1;

    const spacingSeconds = Math.max(0, (count - 1) * delay);
    const capacityPerHour = Math.max(1, limit * Math.max(1, senderPool.length));
    const hoursNeeded = count / capacityPerHour;
    const quotaSeconds = hoursNeeded > 1 ? (hoursNeeded - 1) * 3600 : 0;

    return {
      count,
      capacityPerHour,
      totalSeconds: Math.max(spacingSeconds, quotaSeconds),
      throttledByQuota: quotaSeconds > spacingSeconds,
    };
  }, [recipients.length, delaySeconds, hourlyLimit, senderPool.length]);

  const handleSend = () => {
    if (recipients.length === 0) return toast.error('Add at least one recipient');
    if (!subject.trim()) return toast.error('Subject is required');
    if (!plainTextPreview(body)) return toast.error('Body is required');

    schedule.mutate(
      {
        subject: subject.trim(),
        body,
        recipients,
        startAt: startAt ? new Date(startAt).toISOString() : new Date().toISOString(),
        delaySeconds: Number(delaySeconds) || 0,
        hourlyLimit: Number(hourlyLimit) || 200,
      },
      {
        onSuccess: (result) => {
          toast.success(`${result.totalScheduled.toLocaleString()} emails scheduled`);
          router.push('/dashboard/scheduled');
        },
        onError: (err: Error) => toast.error(err.message),
      },
    );
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

        <h1 className="flex-1 text-[19px] font-medium text-fg">Compose New Email</h1>

        <div className="relative flex items-center gap-1">
          <button
            onClick={() => toast('Attachments are not supported in this build.')}
            aria-label="Attach file"
            className="rounded-control p-1.5 text-brand transition-colors hover:bg-surface-hover"
          >
            <Paperclip className="h-4 w-4" />
          </button>

          <button
            onClick={() => setPopoverOpen((open) => !open)}
            aria-label="Schedule for later"
            className={clsx(
              'rounded-control p-1.5 transition-colors hover:bg-surface-hover',
              startAt ? 'text-brand' : 'text-muted',
            )}
          >
            <Clock className="h-4 w-4" />
          </button>

          <button
            onClick={handleSend}
            disabled={schedule.isPending}
            className="ml-1 h-8 rounded-pill border border-brand px-4 text-[13px] font-medium text-brand transition-colors hover:bg-brand-soft disabled:opacity-50"
          >
            {schedule.isPending ? 'Scheduling...' : startAt ? 'Send Later' : 'Send'}
          </button>

          <SendLaterPopover
            open={popoverOpen}
            onClose={() => setPopoverOpen(false)}
            value={startAt || toDateTimeLocalValue(new Date(Date.now() + 60_000))}
            onConfirm={setStartAt}
          />
        </div>
      </header>

      <div className="px-6 pb-10">
        <Field label="From">
          <span className="inline-flex items-center rounded-control bg-surface-muted px-3 py-1.5 text-[13px] font-medium text-fg">
            {senderPool.length > 0 ? senderPool[0]!.email : 'No senders configured'}
          </span>
          {senderPool.length > 1 && (
            <span className="ml-2 text-[11px] text-subtle">
              round-robin across {senderPool.length} senders
            </span>
          )}
        </Field>

        <Field
          label="To"
          action={
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex shrink-0 items-center gap-1.5 text-[13px] font-medium text-brand transition-colors hover:text-brand-hover"
            >
              <Upload className="h-3.5 w-3.5" />
              Upload List
            </button>
          }
        >
          <RecipientChips recipients={recipients} onChange={setRecipients} />
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.txt,text/csv,text/plain"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void handleUpload(file);
              event.target.value = '';
            }}
          />
        </Field>

        {uploadNote && <p className="pt-2 text-[12px] text-brand">{uploadNote}</p>}

        <Field label="Subject">
          <input
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
            placeholder="Subject"
            className="w-full bg-transparent text-[13px] text-fg placeholder:text-subtle focus:outline-none"
          />
        </Field>

        <div className="flex flex-wrap items-center gap-6 py-3.5">
          <label className="flex items-center gap-3">
            <span className="text-[13px] text-muted">Delay between 2 emails</span>
            <input
              type="number"
              min={0}
              max={3600}
              value={delaySeconds}
              onChange={(event) => setDelaySeconds(event.target.value)}
              className="h-8 w-[68px] rounded-control border border-border px-2.5 text-center text-[13px] text-fg focus:border-brand focus:outline-none"
            />
            <span className="-ml-1 text-[11px] text-subtle">sec</span>
          </label>

          <label className="flex items-center gap-3">
            <span className="text-[13px] text-muted">Hourly Limit</span>
            <input
              type="number"
              min={1}
              value={hourlyLimit}
              onChange={(event) => setHourlyLimit(event.target.value)}
              className="h-8 w-[68px] rounded-control border border-border px-2.5 text-center text-[13px] text-fg focus:border-brand focus:outline-none"
            />
            <span className="-ml-1 text-[11px] text-subtle">per sender</span>
          </label>
        </div>

        {startAt && (
          <p className="pb-3 text-[12px] text-muted">
            Scheduled to start{' '}
            <span className="font-medium text-fg">{new Date(startAt).toLocaleString()}</span>
          </p>
        )}

        <RichTextEditor value={body} onChange={setBody} />

        {estimate && (
          <p className="mt-3 text-[12px] text-muted">
            <span className="font-medium text-fg">{estimate.count.toLocaleString()}</span>{' '}
            recipients - capacity{' '}
            <span className="font-medium text-fg">
              {estimate.capacityPerHour.toLocaleString()}/hour
            </span>{' '}
            - finishes in{' '}
            <span className="font-medium text-fg">{formatDuration(estimate.totalSeconds)}</span>
            {estimate.throttledByQuota && (
              <span className="text-scheduled-fg">
                {' '}
                - the hourly limit is the binding constraint, so the overflow rolls into later hours
                in order.
              </span>
            )}
          </p>
        )}
      </div>
    </div>
  );
}
