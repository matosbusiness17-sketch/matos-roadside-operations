import { OperatorHeader } from '@/components/operator/operator-header';
import { OperatorNav } from '@/components/operator/operator-nav';
import { getCurrentUser } from '@/lib/auth/get-user';

export default async function OperatorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const authContext = await getCurrentUser();

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans text-slate-900">
      <OperatorHeader
        user={authContext?.user}
        profile={authContext?.profile}
        organization={authContext?.organization}
      />
      <OperatorNav userRole={authContext?.profile?.role} />
      <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto">
        {children}
      </main>
      <footer className="border-t border-slate-200 bg-white py-3 px-6 text-center text-xs text-slate-500">
        Matos Systems — Roadside Operations & Dispatch System • Phase 2 Auth & RLS Foundation
      </footer>
    </div>
  );
}
