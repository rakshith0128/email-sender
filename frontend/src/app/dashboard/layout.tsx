import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { Sidebar } from '@/components/layout/Sidebar';
import { BackendSessionWarning } from '@/components/layout/BackendSessionWarning';

/**
 * Shell for every authenticated view: persistent sidebar on the left, routed
 * content on the right. Auth is checked once here rather than in each page.
 */
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect('/');

  return (
    <div className="flex h-screen overflow-hidden bg-surface">
      <Sidebar
        name={session.user.name ?? 'User'}
        email={session.user.email ?? ''}
        image={session.user.image ?? null}
      />

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {session.backendToken ? children : <BackendSessionWarning />}
      </main>
    </div>
  );
}
