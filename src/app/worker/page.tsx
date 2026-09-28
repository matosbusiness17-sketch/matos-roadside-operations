import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { getCurrentUser } from '@/lib/auth/get-user';

export default async function WorkerPage() {
  const authContext = await getCurrentUser();
  const profile = authContext?.profile;
  const organization = authContext?.organization;

  return (
    <div className="space-y-4">
      <div className="border-b border-slate-200 pb-3">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-bold text-slate-900 tracking-tight">Response Worker Surface</h1>
          <Badge variant="outline" className="text-[10px] font-mono">
            Mobile-First
          </Badge>
        </div>
        <p className="text-xs text-slate-500 mt-1">
          Architecturally separate surface tailored for in-vehicle mobile operation.
        </p>
      </div>

      <Card className="border-slate-200 bg-slate-50/50">
        <CardHeader className="p-4">
          <CardTitle className="text-xs font-semibold text-slate-800 uppercase tracking-wider">
            Worker Identity & Session
          </CardTitle>
          <CardDescription className="text-[11px]">
            Phase 2 authenticated profile state
          </CardDescription>
        </CardHeader>
        <CardContent className="p-4 pt-0 space-y-3">
          <div className="rounded border border-slate-200 bg-white p-3 text-xs text-slate-600 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-medium text-slate-700">Authenticated Name:</span>
              <span className="text-slate-900 font-semibold">
                {profile?.display_name ?? 'Standby Worker (Unauthenticated)'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="font-medium text-slate-700">Role:</span>
              <Badge variant="primary" className="text-[10px] font-mono">
                {profile?.role ?? 'worker'}
              </Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="font-medium text-slate-700">Organization:</span>
              <span className="text-slate-800 font-medium">
                {organization?.name ?? 'Dev Demonstration Org'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="font-medium text-slate-700">RLS Access Scope:</span>
              <Badge variant="success" className="text-[10px]">
                Restricted to Assigned Incidents
              </Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-slate-200">
        <CardHeader className="p-4">
          <CardTitle className="text-xs font-semibold text-slate-800">
            Planned Worker Capabilities
          </CardTitle>
          <CardDescription className="text-[11px]">
            Functionality authorized for subsequent implementation phases:
          </CardDescription>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          <ul className="space-y-2 text-xs text-slate-600">
            <li className="flex items-start gap-2">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-slate-400 mt-1.5 shrink-0" />
              <span>Progressive Web App (PWA) with offline incident cache</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-slate-400 mt-1.5 shrink-0" />
              <span>Genuine worker-device GPS telemetry broadcast</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-slate-400 mt-1.5 shrink-0" />
              <span>Realtime assignment alerts with accept / acknowledge controls</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-slate-400 mt-1.5 shrink-0" />
              <span>Structured incident status transitions: Dispatched → En Route → On Scene → Completed</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-slate-400 mt-1.5 shrink-0" />
              <span>Turn-by-turn navigation link-out and on-site photo/signature capture</span>
            </li>
          </ul>

          <div className="mt-4 rounded border border-slate-200 bg-slate-50 p-2.5 text-[11px] text-slate-500">
            <span className="font-semibold text-slate-700">Architectural Note: </span>
            This route is intentionally separated from the operator dashboard navigation to preserve ergonomic clarity on mobile screens.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
