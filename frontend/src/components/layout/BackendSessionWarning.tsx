const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

/**
 * The Google-token-for-backend-JWT exchange in the Auth.js signIn callback is
 * the one step that can fail silently. Surfacing it beats an endlessly loading
 * dashboard with no explanation.
 */
export function BackendSessionWarning() {
  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <div className="max-w-md rounded-card border border-scheduled-fg/25 bg-scheduled-soft p-5">
        <h2 className="text-[13px] font-semibold text-fg">Backend session not established</h2>
        <p className="mt-2 text-[13px] leading-relaxed text-muted">
          You signed in with Google, but the app could not exchange that login for a backend
          session. Check that the API is running on{' '}
          <code className="rounded bg-surface px-1.5 py-0.5 text-[11px]">{API_URL}</code> and that{' '}
          <code className="rounded bg-surface px-1.5 py-0.5 text-[11px]">GOOGLE_CLIENT_ID</code> in{' '}
          <code className="rounded bg-surface px-1.5 py-0.5 text-[11px]">backend/.env</code> matches{' '}
          <code className="rounded bg-surface px-1.5 py-0.5 text-[11px]">AUTH_GOOGLE_ID</code> in{' '}
          <code className="rounded bg-surface px-1.5 py-0.5 text-[11px]">frontend/.env.local</code>.
          Then sign out and back in.
        </p>
      </div>
    </div>
  );
}
