import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { signOutAction } from '@/lib/auth/actions';
import { Profile, Organization } from '@/types';

interface OperatorHeaderProps {
  user: { email: string };
  profile: Profile;
  organization: Organization;
}

export function OperatorHeader({
  user,
  profile,
  organization,
}: OperatorHeaderProps) {
  const role = profile.role;
  const displayName = profile.display_name;
  const orgName = organization.name;

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
          <Badge
            variant="outline"
            className="border-slate-700 bg-slate-800 text-slate-300 text-[10px] hidden md:inline-flex"
          >
            {orgName}
          </Badge>
        </div>

        <div className="flex items-center space-x-3">
          <div className="flex items-center gap-2">
            <div className="text-right hidden sm:block">
              <div className="text-xs font-semibold text-white leading-none">
                {displayName}
              </div>
              <div className="text-[10px] text-slate-400 leading-none mt-0.5">
                {user.email}
              </div>
            </div>
            <Badge
              variant={role === 'admin' ? 'primary' : 'default'}
              className="text-[10px] uppercase font-mono tracking-wider font-semibold"
            >
              {role}
            </Badge>
            <form action={signOutAction} className="inline-block">
              <button
                type="submit"
                className="text-xs text-slate-300 hover:text-white px-2.5 py-1 rounded hover:bg-slate-800 transition-colors border border-slate-700 cursor-pointer"
              >
                Sign Out
              </button>
            </form>
          </div>

          <div className="h-4 w-px bg-slate-700 mx-1 hidden sm:block" />

          <Link
            href="/worker"
            className="text-xs text-slate-300 hover:text-white px-2 py-1 rounded hover:bg-slate-800 transition-colors"
            title="Open Worker View"
          >
            Worker View
          </Link>
        </div>
      </div>
    </header>
  );
}
