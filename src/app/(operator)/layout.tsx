import { OperatorHeader } from '@/components/operator/operator-header';
import { OperatorNav } from '@/components/operator/operator-nav';

export default function OperatorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans text-slate-900">
      <OperatorHeader />
      <OperatorNav />
      <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto">
        {children}
      </main>
      <footer className="border-t border-slate-200 bg-white py-3 px-6 text-center text-xs text-slate-500">
        Matos Systems — Roadside Operations & Dispatch System (Phase 1 Application Foundation)
      </footer>
    </div>
  );
}
