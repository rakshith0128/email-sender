'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { signOut } from 'next-auth/react';
import { useEffect, useRef, useState } from 'react';
import { Clock, ChevronDown, LogOut, Send } from 'lucide-react';
import clsx from 'clsx';
import { useStats } from '@/hooks/useApi';

export interface SidebarProps {
  name: string;
  email: string;
  image: string | null;
}

function Avatar({ name, image, size = 32 }: { name: string; image: string | null; size?: number }) {
  if (image) {
    return (
      <Image
        src={image}
        alt={name}
        width={size}
        height={size}
        className="shrink-0 rounded-full object-cover"
      />
    );
  }

  const initials = name
    .split(' ')
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <div
      style={{ width: size, height: size }}
      className="flex shrink-0 items-center justify-center rounded-full bg-brand text-xs font-semibold text-brand-fg"
    >
      {initials || '?'}
    </div>
  );
}

/** Profile card with the logout menu behind the chevron. */
function ProfileMenu({ name, email, image }: SidebarProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 rounded-control px-2 py-2 text-left transition-colors hover:bg-surface-hover"
      >
        <Avatar name={name} image={image} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium leading-tight text-fg">
            {name}
          </span>
          <span className="block truncate text-[11px] leading-tight text-subtle">{email}</span>
        </span>
        <ChevronDown
          className={clsx('h-4 w-4 shrink-0 text-subtle transition-transform', open && 'rotate-180')}
        />
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-full z-20 mt-1 animate-pop-in rounded-control border border-border bg-surface p-1 shadow-pop">
          <button
            onClick={() => void signOut({ callbackUrl: '/' })}
            className="flex w-full items-center gap-2 rounded-[6px] px-2.5 py-2 text-left text-[13px] text-fg transition-colors hover:bg-surface-hover"
          >
            <LogOut className="h-3.5 w-3.5 text-muted" />
            Logout
          </button>
        </div>
      )}
    </div>
  );
}

interface NavItemProps {
  href: string;
  label: string;
  count: number | undefined;
  icon: typeof Clock;
  active: boolean;
}

function NavItem({ href, label, count, icon: Icon, active }: NavItemProps) {
  return (
    <Link
      href={href}
      className={clsx(
        'flex items-center gap-2.5 rounded-control px-2.5 py-2 text-[13px] transition-colors',
        active ? 'bg-brand-soft font-medium text-fg' : 'text-muted hover:bg-surface-hover',
      )}
    >
      <Icon className={clsx('h-4 w-4 shrink-0', active ? 'text-brand' : 'text-subtle')} />
      <span className="flex-1">{label}</span>
      <span className="text-[11px] tabular-nums text-subtle">
        {count === undefined ? '' : count.toLocaleString()}
      </span>
    </Link>
  );
}

export function Sidebar({ name, email, image }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { data: stats } = useStats();

  return (
    <aside className="flex w-[232px] shrink-0 flex-col gap-4 border-r border-border bg-surface px-4 py-5">
      <span className="wordmark px-1 text-fg">ONB</span>

      <ProfileMenu name={name} email={email} image={image} />

      <button
        onClick={() => router.push('/dashboard/compose')}
        className="h-9 w-full rounded-pill border border-brand text-[13px] font-medium text-brand transition-colors hover:bg-brand-soft"
      >
        Compose
      </button>

      <nav className="space-y-0.5">
        <p className="px-2.5 pb-1.5 text-[10px] font-medium uppercase tracking-wider text-subtle">
          Core
        </p>

        <NavItem
          href="/dashboard/scheduled"
          label="Scheduled"
          count={stats?.pending}
          icon={Clock}
          active={pathname.startsWith('/dashboard/scheduled')}
        />
        <NavItem
          href="/dashboard/sent"
          label="Sent"
          count={stats ? stats.sent + stats.failed : undefined}
          icon={Send}
          active={pathname.startsWith('/dashboard/sent')}
        />
      </nav>
    </aside>
  );
}
