import { Badge } from '@/components/ui/badge';
import { signOutAction } from '@/lib/auth/actions';
import { Profile, Organization } from '@/types';

interface WorkerHeaderProps {
  user: { email: string };
  profile: Profile;
  organization: Organization;
}

export function WorkerHeader({
  profile,
  organization,
}: WorkerHeaderProps) {
  return (
    <header className="border-b border-slate-200 bg-white px-4 py-3 sticky top-0 z-20">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <div className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
          <div>
            <span className="font-bold text-sm text-slate-900 tracking-tight block leading-tight">
              MATOS FIELD
            </span>
            <span className="text-[10px] text-slate-500 block leading-tight truncate max-w-[140px]">
              {organization.name}
            </span>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-slate-700 hidden sm:inline">
              {profile.display_name}
            </span>
            <Badge variant="primary" className="text-[10px] font-mono">
              {profile.role}
            </Badge>
            <form action={signOutAction} className="inline-block">
              <button
                type="submit"
                className="text-[11px] text-slate-600 hover:text-slate-900 px-2 py-1 rounded hover:bg-slate-100 transition-colors border border-slate-200 cursor-pointer"
              >
                Sign Out
              </button>
            </form>
          </div>
        </div>
      </div>
    </header>
  );
}
