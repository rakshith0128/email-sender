'use client';

import { useRef } from 'react';
import {
  AlignLeft,
  Bold,
  ChevronsUpDown,
  Italic,
  List,
  ListOrdered,
  Quote,
  Redo2,
  Strikethrough,
  Type,
  Underline,
  Undo2,
} from 'lucide-react';

export interface RichTextEditorProps {
  /** Current HTML fragment. Only used to seed the editor - see below. */
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
}

type Command = { icon: typeof Bold; label: string; command: string; arg?: string };

const COMMAND_GROUPS: Command[][] = [
  [
    { icon: Undo2, label: 'Undo', command: 'undo' },
    { icon: Redo2, label: 'Redo', command: 'redo' },
  ],
  [
    { icon: Type, label: 'Heading', command: 'formatBlock', arg: 'h3' },
    { icon: ChevronsUpDown, label: 'Paragraph', command: 'formatBlock', arg: 'p' },
  ],
  [
    { icon: Bold, label: 'Bold', command: 'bold' },
    { icon: Italic, label: 'Italic', command: 'italic' },
    { icon: Underline, label: 'Underline', command: 'underline' },
  ],
  [{ icon: AlignLeft, label: 'Align left', command: 'justifyLeft' }],
  [
    { icon: ListOrdered, label: 'Numbered list', command: 'insertOrderedList' },
    { icon: List, label: 'Bulleted list', command: 'insertUnorderedList' },
  ],
  [
    { icon: Quote, label: 'Quote', command: 'formatBlock', arg: 'blockquote' },
    { icon: Strikethrough, label: 'Strikethrough', command: 'strikeThrough' },
  ],
];

/**
 * Compose body editor.
 *
 * Uses a contenteditable driven by document.execCommand. execCommand is
 * formally deprecated but remains the only API implemented consistently across
 * browsers without pulling in a full editor framework, which would be a heavy
 * dependency for a toolbar this size.
 *
 * The element is deliberately uncontrolled: writing `value` back into
 * innerHTML on every keystroke would reset the caret to the start. The parent
 * is notified on input instead, and the editor owns its own DOM.
 */
export function RichTextEditor({ value, onChange, placeholder }: RichTextEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const seeded = useRef(false);

  const run = (command: string, arg?: string) => {
    editorRef.current?.focus();
    document.execCommand(command, false, arg);
    onChange(editorRef.current?.innerHTML ?? '');
  };

  return (
    <div className="rounded-card bg-surface-muted p-4">
      <div
        ref={(node) => {
          editorRef.current = node;
          // Seed once on mount so a draft restored from state shows up,
          // without clobbering the caret on subsequent renders.
          if (node && !seeded.current) {
            seeded.current = true;
            if (value) node.innerHTML = value;
          }
        }}
        contentEditable
        role="textbox"
        aria-multiline="true"
        aria-label="Email body"
        data-placeholder={placeholder ?? 'Type Your Reply...'}
        onInput={(event) => onChange(event.currentTarget.innerHTML)}
        className="min-h-[220px] text-[13px] leading-relaxed text-fg focus:outline-none [&_blockquote]:border-l-2 [&_blockquote]:border-border-strong [&_blockquote]:pl-3 [&_blockquote]:text-muted [&_h3]:text-base [&_h3]:font-semibold [&_li]:ml-5 [&_ol]:list-decimal [&_ul]:list-disc"
      />

      <div className="mt-3 flex flex-wrap items-center gap-0.5 rounded-pill bg-surface px-2 py-1.5">
        {COMMAND_GROUPS.map((group, groupIndex) => (
          <div key={groupIndex} className="flex items-center gap-0.5">
            {groupIndex > 0 && <span className="mx-1.5 h-4 w-px bg-border" />}
            {group.map((item) => (
              <button
                key={item.label}
                type="button"
                title={item.label}
                aria-label={item.label}
                // onMouseDown, not onClick: the default mousedown would blur
                // the editor and destroy the selection before the command runs.
                onMouseDown={(event) => {
                  event.preventDefault();
                  run(item.command, item.arg);
                }}
                className="rounded p-1.5 text-muted transition-colors hover:bg-surface-muted hover:text-fg"
              >
                <item.icon className="h-3.5 w-3.5" />
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
