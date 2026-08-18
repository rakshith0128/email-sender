'use client';

import { useEffect, useRef, useState } from 'react';
import { ListFilter, RotateCw, Search } from 'lucide-react';
import clsx from 'clsx';
import type { EmailStatus } from '@/lib/types';

export interface FilterOption {
  value: EmailStatus | 'all';
  label: string;
}

export interface ListToolbarProps {
  search: string;
  onSearchChange: (value: string) => void;
  filter: EmailStatus | 'all';
  onFilterChange: (value: EmailStatus | 'all') => void;
  options: ReadonlyArray<FilterOption>;
  onRefresh: () => void;
  refreshing: boolean;
}

export function ListToolbar({
  search,
  onSearchChange,
  filter,
  onFilterChange,
  options,
  onRefresh,
  refreshing,
}: ListToolbarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [menuOpen]);

  return (
    <div className="flex items-center gap-2 px-6 py-3.5">
      <div className="relative flex-1">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" />
        <input
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Search"
          className="h-9 w-full rounded-pill bg-surface-muted pl-10 pr-4 text-[13px] text-fg placeholder:text-subtle focus:outline-none focus:ring-2 focus:ring-brand/25"
        />
      </div>

      <div ref={menuRef} className="relative">
        <button
          onClick={() => setMenuOpen((value) => !value)}
          aria-label="Filter"
          className={clsx(
            'flex h-9 w-9 items-center justify-center rounded-control transition-colors',
            filter === 'all' ? 'text-subtle hover:bg-surface-muted' : 'bg-brand-soft text-brand',
          )}
        >
          <ListFilter className="h-4 w-4" />
        </button>

        {menuOpen && (
          <div className="absolute right-0 top-full z-20 mt-1 w-40 animate-pop-in rounded-control border border-border bg-surface p-1 shadow-pop">
            {options.map((option) => (
              <button
                key={option.value}
                onClick={() => {
                  onFilterChange(option.value);
                  setMenuOpen(false);
                }}
                className={clsx(
                  'block w-full rounded-[6px] px-2.5 py-1.5 text-left text-[13px] transition-colors hover:bg-surface-hover',
                  option.value === filter ? 'font-medium text-brand' : 'text-fg',
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <button
        onClick={onRefresh}
        aria-label="Refresh"
        className="flex h-9 w-9 items-center justify-center rounded-control text-subtle transition-colors hover:bg-surface-muted"
      >
        <RotateCw className={clsx('h-4 w-4', refreshing && 'animate-spin')} />
      </button>
    </div>
  );
}
