import { redirect } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { getCurrentUser } from '@/lib/auth/get-user';
import { getCurrentWorkerAssignment } from '@/lib/worker/assignment-data';
import { WorkerAssignmentPanel } from '@/components/worker/worker-assignment-panel';

export default async function WorkerPage() {
  const authContext = await getCurrentUser();

  // Fail-closed: missing authentication context redirects to /login
  if (!authContext || !authContext.profile || !authContext.profile.is_active) {
    redirect('/login?redirectTo=/worker');
  }

  // Operators and admins are routed to the operator workspace
  if (authContext.profile.role !== 'worker') {
    redirect('/operations');
  }

  const { profile, organization } = authContext;

  // Authoritative server-side loader for the current active assignment
  const assignment = await getCurrentWorkerAssignment();

  return (
    <div className="space-y-4 max-w-full min-w-0">
      <div className="border-b border-slate-200 pb-3">
        <div className="flex items-center justify-between gap-2 min-w-0">
          <h1 className="text-lg font-bold text-slate-900 tracking-tight break-words min-w-0">
            Response Worker Surface
          </h1>
        </div>
        <p className="text-xs text-slate-500 mt-1 break-words">
          Active roadside dispatch &amp; operational lifecycle controls.
        </p>
      </div>

      {/* Primary operational assignment surface — rendered unconditionally regardless of assignment nullability */}
      <WorkerAssignmentPanel assignment={assignment} />

      {/* Authenticated session & identity card */}
      <Card className="border-slate-200 bg-slate-50/50">
        <CardHeader className="p-4">
          <CardTitle className="text-xs font-semibold text-slate-800 uppercase tracking-wider">
            Worker Identity &amp; Session
          </CardTitle>
          <CardDescription className="text-[11px]">
            Authenticated operational profile
          </CardDescription>
        </CardHeader>
        <CardContent className="p-4 pt-0 space-y-3">
          <div className="rounded border border-slate-200 bg-white p-3 text-xs text-slate-600 space-y-3 min-w-0">
            {/* Authenticated Name */}
            <div className="flex flex-col items-start gap-1 min-w-0 sm:flex-row sm:items-center sm:justify-between sm:gap-2">
              <span className="font-medium text-slate-700 shrink-0">Authenticated Name:</span>
              <span className="text-slate-900 font-semibold break-words whitespace-normal min-w-0 sm:text-right">
                {profile.display_name}
              </span>
            </div>

            {/* Role */}
            <div className="flex flex-col items-start gap-1 min-w-0 sm:flex-row sm:items-center sm:justify-between sm:gap-2">
              <span className="font-medium text-slate-700 shrink-0">Role:</span>
              <Badge variant="primary" className="text-[10px] font-mono">
                {profile.role}
              </Badge>
            </div>

            {/* Organization */}
            <div className="flex flex-col items-start gap-1 min-w-0 sm:flex-row sm:items-center sm:justify-between sm:gap-2">
              <span className="font-medium text-slate-700 shrink-0">Organization:</span>
              <span className="text-slate-800 font-medium break-words whitespace-normal min-w-0 sm:text-right">
                {organization.name}
              </span>
            </div>

            {/* RLS Access Scope */}
            <div className="flex flex-col items-start gap-1 min-w-0 sm:flex-row sm:items-center sm:justify-between sm:gap-2">
              <span className="font-medium text-slate-700 shrink-0">RLS Access Scope:</span>
              <Badge
                variant="success"
                className="text-[10px] whitespace-normal break-words max-w-full text-left sm:text-right"
              >
                Restricted to Assigned Incidents
              </Badge>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
