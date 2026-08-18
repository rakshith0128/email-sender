'use client';

import { useState } from 'react';
import { X } from 'lucide-react';

export interface RecipientChipsProps {
  recipients: string[];
  onChange: (recipients: string[]) => void;
  /** How many chips to render before collapsing the rest into "+N". */
  visible?: number;
}

const EMAIL_PATTERN = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

/**
 * The To field. Addresses typed by hand and addresses parsed from an uploaded
 * list land in the same array, so both paths behave identically.
 */
export function RecipientChips({ recipients, onChange, visible = 3 }: RecipientChipsProps) {
  const [draft, setDraft] = useState('');
  const [expanded, setExpanded] = useState(false);

  const commitDraft = () => {
    const email = draft.trim().toLowerCase().replace(/,$/, '');
    if (!email) return;

    if (!EMAIL_PATTERN.test(email)) return;
    if (!recipients.includes(email)) onChange([...recipients, email]);
    setDraft('');
  };

  const shown = expanded ? recipients : recipients.slice(0, visible);
  const hidden = recipients.length - shown.length;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {shown.map((email) => (
        <span
          key={email}
          className="inline-flex items-center gap-1 rounded-pill border border-brand/45 bg-brand-soft/60 py-0.5 pl-2.5 pr-1 text-[12px] text-fg"
        >
          {email}
          <button
            onClick={() => onChange(recipients.filter((value) => value !== email))}
            aria-label={`Remove ${email}`}
            className="rounded-full p-0.5 text-subtle transition-colors hover:bg-brand/15 hover:text-fg"
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}

      {hidden > 0 && (
        <button
          onClick={() => setExpanded(true)}
          className="rounded-pill border border-brand/45 bg-brand-soft/60 px-2.5 py-0.5 text-[12px] font-medium text-fg transition-colors hover:bg-brand/15"
        >
          +{hidden}
        </button>
      )}

      {expanded && recipients.length > visible && (
        <button
          onClick={() => setExpanded(false)}
          className="px-1 text-[12px] text-muted underline-offset-2 hover:underline"
        >
          show less
        </button>
      )}

      <input
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ',' || event.key === ' ') {
            event.preventDefault();
            commitDraft();
          }
          if (event.key === 'Backspace' && !draft && recipients.length > 0) {
            onChange(recipients.slice(0, -1));
          }
        }}
        onBlur={commitDraft}
        placeholder={recipients.length === 0 ? 'recipient@example.com' : ''}
        className="min-w-[180px] flex-1 bg-transparent py-1 text-[13px] text-fg placeholder:text-subtle focus:outline-none"
      />
    </div>
  );
}
