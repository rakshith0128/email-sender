'use client';

import { useEffect, useRef, useState } from 'react';
import { Calendar } from 'lucide-react';
import { toDateTimeLocalValue } from '@/lib/format';

export interface SendLaterPopoverProps {
  open: boolean;
  onClose: () => void;
  value: string;
  onConfirm: (value: string) => void;
}

/** Quick picks, matching the Figma - tomorrow, and three fixed times. */
function quickOptions(): Array<{ label: string; value: Date }> {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);

  const at = (hours: number) => {
    const date = new Date(tomorrow);
    date.setHours(hours, 0, 0, 0);
    return date;
  };

  return [
    { label: 'Tomorrow', value: at(9) },
    { label: 'Tomorrow, 10:00 AM', value: at(10) },
    { label: 'Tomorrow, 11:00 AM', value: at(11) },
    { label: 'Tomorrow, 3:00 PM', value: at(15) },
  ];
}

export function SendLaterPopover({ open, onClose, value, onConfirm }: SendLaterPopoverProps) {
  const [draft, setDraft] = useState(value);
  const containerRef = useRef<HTMLDivElement>(null);

  // Re-sync whenever the popover is reopened, so cancelling truly discards.
  useEffect(() => {
    if (open) setDraft(value);
  }, [open, value]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) onClose();
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      ref={containerRef}
      className="absolute right-0 top-full z-30 mt-2 w-[248px] animate-pop-in rounded-card border border-border bg-surface p-4 shadow-pop"
    >
      <h3 className="text-[13px] font-semibold text-fg">Send Later</h3>

      <label className="mt-3 flex items-center gap-2 border-b border-border pb-2">
        <input
          type="datetime-local"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          className="w-full bg-transparent text-[12px] text-fg focus:outline-none"
        />
        <Calendar className="h-3.5 w-3.5 shrink-0 text-subtle" />
      </label>

      <div className="mt-2 space-y-0.5">
        {quickOptions().map((option) => (
          <button
            key={option.label}
            onClick={() => setDraft(toDateTimeLocalValue(option.value))}
            className="block w-full rounded-[6px] px-2 py-1.5 text-left text-[12px] text-fg transition-colors hover:bg-surface-hover"
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className="mt-3 flex items-center justify-end gap-2">
        <button
          onClick={onClose}
          className="px-2 py-1 text-[12px] text-muted transition-colors hover:text-fg"
        >
          Cancel
        </button>
        <button
          onClick={() => {
            onConfirm(draft);
            onClose();
          }}
          className="rounded-pill border border-brand px-4 py-1 text-[12px] font-medium text-brand transition-colors hover:bg-brand-soft"
        >
          Done
        </button>
      </div>
    </div>
  );
}
