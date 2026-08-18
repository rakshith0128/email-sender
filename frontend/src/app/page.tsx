import { redirect } from 'next/navigation';
import { auth, googleConfigured } from '@/lib/auth';
import { LoginCard } from '@/components/layout/LoginCard';

/**
 * Landing / sign-in. Server component so an already-authenticated visitor is
 * redirected before any HTML reaches the browser.
 */
export default async function HomePage() {
  const session = await auth();
  if (session?.user) redirect('/dashboard/scheduled');

  return (
    <main className="flex min-h-screen items-center justify-center bg-bg px-4">
      <LoginCard googleConfigured={googleConfigured} />
    </main>
  );
}
