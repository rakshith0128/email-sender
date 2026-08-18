'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import toast from 'react-hot-toast';

/** Google mark, inlined so the page has no external asset dependency. */
function GoogleIcon() {
  return (
    <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.65l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.11a6.6 6.6 0 0 1 0-4.22V7.05H2.18a11 11 0 0 0 0 9.9l3.66-2.84z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1a11 11 0 0 0-9.82 6.05l3.66 2.84C6.71 7.29 9.14 5.38 12 5.38z"
      />
    </svg>
  );
}

export interface LoginCardProps {
  /** False when AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET are not set. */
  googleConfigured: boolean;
}

export function LoginCard({ googleConfigured }: LoginCardProps) {
  const [loading, setLoading] = useState(false);

  /**
   * The Figma includes email/password fields, so they are rendered to match.
   * Only Google OAuth is actually wired up - the brief asks for real Google
   * login and there is no password credential store behind this - so
   * submitting explains that rather than silently failing.
   */
  const handlePasswordLogin = (event: React.FormEvent) => {
    event.preventDefault();
    toast('Email sign-in is not enabled - please continue with Google.', { icon: 'i' });
  };

  return (
    <div className="w-full max-w-[380px] rounded-card border border-border bg-surface px-10 py-9 shadow-card">
      <h1 className="text-center text-[28px] font-semibold tracking-tight text-fg">Login</h1>

      <button
        onClick={() => {
          setLoading(true);
          void signIn('google', { callbackUrl: '/dashboard/scheduled' });
        }}
        disabled={loading || !googleConfigured}
        title={googleConfigured ? undefined : 'Google OAuth is not configured'}
        className="mt-6 flex h-11 w-full items-center justify-center gap-2.5 rounded-control bg-brand-soft text-sm font-medium text-fg transition-colors hover:bg-brand/15 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <GoogleIcon />
        {loading ? 'Redirecting...' : 'Login with Google'}
      </button>

      {!googleConfigured && (
        <div className="mt-4 rounded-control bg-scheduled-soft px-3.5 py-3 text-left">
          <p className="text-[12px] font-medium text-fg">Google sign-in is not configured yet</p>
          <p className="mt-1 text-[12px] leading-relaxed text-muted">
            Add <code className="rounded bg-surface px-1 py-0.5">AUTH_GOOGLE_ID</code> and{' '}
            <code className="rounded bg-surface px-1 py-0.5">AUTH_GOOGLE_SECRET</code> to{' '}
            <code className="rounded bg-surface px-1 py-0.5">frontend/.env.local</code>, put the
            same client id in <code className="rounded bg-surface px-1 py-0.5">backend/.env</code>{' '}
            as <code className="rounded bg-surface px-1 py-0.5">GOOGLE_CLIENT_ID</code>, then
            restart both dev servers. Step 5 of SETUP.md walks through it.
          </p>
        </div>
      )}

      <div className="my-5 flex items-center gap-3">
        <span className="h-px flex-1 bg-border" />
        <span className="text-xs text-subtle">or sign up through email</span>
        <span className="h-px flex-1 bg-border" />
      </div>

      <form onSubmit={handlePasswordLogin} className="space-y-3">
        <input
          type="email"
          placeholder="Email ID"
          autoComplete="email"
          className="h-11 w-full rounded-control bg-surface-muted px-4 text-sm text-fg placeholder:text-subtle focus:outline-none focus:ring-2 focus:ring-brand/30"
        />
        <input
          type="password"
          placeholder="Password"
          autoComplete="current-password"
          className="h-11 w-full rounded-control bg-surface-muted px-4 text-sm text-fg placeholder:text-subtle focus:outline-none focus:ring-2 focus:ring-brand/30"
        />

        <button
          type="submit"
          className="mt-2 h-11 w-full rounded-control bg-brand text-sm font-medium text-brand-fg transition-colors hover:bg-brand-hover"
        >
          Login
        </button>
      </form>
    </div>
  );
}
