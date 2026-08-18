import type { LucideIcon } from 'lucide-react';
import { AlertCircle } from 'lucide-react';

/** Skeleton rows shown while the first page loads. */
export function ListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div>
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="flex items-center gap-4 border-b border-border px-6 py-4">
          <Shimmer className="h-3.5 w-[130px]" />
          <Shimmer className="h-5 w-24 rounded-pill" />
          <Shimmer className="h-3.5 flex-1" />
        </div>
      ))}
    </div>
  );
}

function Shimmer({ className }: { className?: string }) {
  return (
    <div className={`relative overflow-hidden rounded bg-surface-muted ${className ?? ''}`}>
      <div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-black/[0.04] to-transparent" />
    </div>
  );
}

export interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: { label: string; onClick: () => void };
}

export function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-20 text-center">
      <div className="mb-4 rounded-full bg-surface-muted p-3.5">
        <Icon className="h-5 w-5 text-subtle" />
      </div>
      <h3 className="text-[13px] font-medium text-fg">{title}</h3>
      <p className="mt-1 max-w-xs text-[13px] text-muted">{description}</p>
      {action && (
        <button
          onClick={action.onClick}
          className="mt-5 h-9 rounded-pill border border-brand px-4 text-[13px] font-medium text-brand transition-colors hover:bg-brand-soft"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-20 text-center">
      <div className="mb-4 rounded-full bg-danger-soft p-3.5">
        <AlertCircle className="h-5 w-5 text-danger" />
      </div>
      <h3 className="text-[13px] font-medium text-fg">Something went wrong</h3>
      <p className="mt-1 max-w-sm text-[13px] text-muted">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-5 h-9 rounded-control border border-border px-4 text-[13px] font-medium text-fg transition-colors hover:bg-surface-hover"
        >
          Try again
        </button>
      )}
    </div>
  );
}
