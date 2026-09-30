import { redirect } from 'next/navigation';
import { WorkerHeader } from '@/components/worker/worker-header';
import { WorkerPwaRegistration } from '@/components/worker/worker-pwa-registration';
import { getCurrentUser } from '@/lib/auth/get-user';

export const metadata = {
  title: 'Worker Portal | Matos Systems Roadside',
  description: 'Mobile-first field worker operational interface.',
};

export default async function WorkerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const authContext = await getCurrentUser();

  // Fail-closed: worker surface requires a genuine authenticated active session
  if (!authContext || !authContext.profile || !authContext.profile.is_active) {
    redirect('/login?redirectTo=/worker');
  }

  // Operators and admins accessing /worker are routed to the operator workspace
  if (authContext.profile.role !== 'worker') {
    redirect('/operations');
  }

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col justify-start">
      {/* Mobile-first centered container */}
      <div className="w-full max-w-md mx-auto min-h-screen bg-white border-x border-slate-200 flex flex-col shadow-sm">
        <WorkerPwaRegistration />
        <WorkerHeader
          user={authContext.user}
          profile={authContext.profile}
          organization={authContext.organization}
        />
        <main className="flex-1 p-4 sm:p-5 flex flex-col">
          {children}
        </main>
        <footer className="border-t border-slate-100 p-3 text-center text-[11px] text-slate-400">
          Matos Systems Field Worker • Mobile Interface Shell
        </footer>
      </div>
    </div>
  );
}
