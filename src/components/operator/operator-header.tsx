import Link from 'next/link';
import { Badge } from '@/components/ui/badge';

export function OperatorHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-slate-900 text-white">
      <div className="flex h-14 items-center justify-between px-4 sm:px-6">
        <div className="flex items-center space-x-3">
          <Link href="/operations" className="flex items-center space-x-2">
            <span className="font-bold tracking-tight text-white text-sm sm:text-base">
              MATOS SYSTEMS
            </span>
            <span className="text-slate-400 text-xs hidden sm:inline">|</span>
            <span className="text-slate-300 text-xs font-medium hidden sm:inline">
              Roadside Operations & Dispatch
            </span>
          </Link>
          <Badge variant="outline" className="border-slate-700 bg-slate-800 text-slate-300 text-[10px] hidden md:inline-flex">
            Operator Shell
          </Badge>
        </div>

        <div className="flex items-center space-x-3">
          <div className="flex items-center gap-1.5 text-xs text-slate-300">
            <span className="inline-block h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="hidden sm:inline">Phase 1 Foundation</span>
          </div>

          <div className="h-4 w-px bg-slate-700 mx-1 hidden sm:block" />

          <div className="flex items-center space-x-1">
            <Link
              href="/worker"
              className="text-xs text-slate-300 hover:text-white px-2 py-1 rounded hover:bg-slate-800 transition-colors"
              title="Switch to Mobile Worker Shell"
            >
              Worker View
            </Link>
            <Link
              href="/login"
              className="text-xs text-slate-300 hover:text-white px-2 py-1 rounded hover:bg-slate-800 transition-colors"
            >
              Log Out
            </Link>
          </div>
        </div>
      </div>
    </header>
  );
}
