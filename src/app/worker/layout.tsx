import { WorkerHeader } from '@/components/worker/worker-header';

export const metadata = {
  title: 'Worker Portal | Matos Systems Roadside',
  description: 'Mobile-first field worker operational interface.',
};

export default function WorkerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-slate-100 flex flex-col justify-start">
      {/* Mobile-first centered container */}
      <div className="w-full max-w-md mx-auto min-h-screen bg-white border-x border-slate-200 flex flex-col shadow-sm">
        <WorkerHeader />
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
