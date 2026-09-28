import Link from 'next/link';
import { Badge } from '@/components/ui/badge';

export function WorkerHeader() {
  return (
    <header className="border-b border-slate-200 bg-white px-4 py-3 sticky top-0 z-20">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <div className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
          <span className="font-bold text-sm text-slate-900 tracking-tight">
            MATOS FIELD
          </span>
          <Badge variant="outline" className="text-[10px] uppercase font-mono">
            Worker App
          </Badge>
        </div>
        <div className="flex items-center space-x-2">
          <Link
            href="/operations"
            className="text-[11px] text-slate-600 hover:text-slate-900 underline"
          >
            Operator Shell
          </Link>
        </div>
      </div>
    </header>
  );
}
