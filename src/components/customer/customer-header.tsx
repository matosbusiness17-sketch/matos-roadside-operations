import { Badge } from '@/components/ui/badge';

export function CustomerHeader() {
  return (
    <header className="border-b border-slate-200 bg-white px-4 py-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <span className="font-bold text-sm text-slate-900 tracking-tight">
            MATOS ASSISTANCE
          </span>
          <span className="text-slate-400 text-xs">|</span>
          <span className="text-xs text-slate-600 font-medium">
            Location Confirmation
          </span>
        </div>
        <Badge variant="outline" className="text-[10px] uppercase font-mono">
          Secure Link
        </Badge>
      </div>
    </header>
  );
}
