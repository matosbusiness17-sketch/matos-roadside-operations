import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getCurrentUser } from '@/lib/auth/get-user';
import { getOperationsSnapshot } from '@/lib/operations/data';
import { env } from '@/lib/env';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Administration | Matos Systems Roadside',
  description: 'Organization administration, user roles, and system configuration overview.',
};

// Note: Replaces obsolete Phase 1 PlaceholderPanel for System & Organization Administration

export default async function AdminPage() {
  const authContext = await getCurrentUser();

  // Fail-closed: missing authentication must NEVER fall through to render admin content
  if (!authContext || !authContext.profile || !authContext.profile.is_active) {
    redirect('/login?redirectTo=/admin');
  }

  const role = authContext.profile.role;

  // Fail-closed: non-admin operators receive explicit Access Denied behavior
  if (role !== 'admin') {
    return (
      <div className="space-y-4 max-w-2xl mx-auto py-8">
        <Card className="border-rose-200 bg-rose-50/50">
          <CardHeader>
            <div className="flex items-center justify-between">
              <Badge variant="destructive" className="text-xs">
                Access Denied
              </Badge>
              <span className="font-mono text-xs text-rose-700">Role: {role}</span>
            </div>
            <CardTitle className="text-base text-rose-900 mt-2">
              Organization Administration Restricted
            </CardTitle>
            <CardDescription className="text-xs text-rose-700">
              Your account has an <strong>{role}</strong> role. The Administration surface requires an <strong>admin</strong> role within your organization.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 pt-0">
            <p className="text-xs text-slate-600">
              Per organizational security policy, operators are authorized to manage operations, incidents, and fleet units, but cannot access organization-level administration or alter user roles.
            </p>
            <div className="pt-2">
              <Link
                href="/operations"
                className="inline-flex items-center text-xs font-semibold text-slate-900 underline"
              >
                ← Return to Operations Workspace
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Authoritative queries for same-organization administrative overview
  let profilesFailed = false;
  let snapshotFailed = false;

  let adminCount: number | null = null;
  let operatorCount: number | null = null;
  let workerCount: number | null = null;
  let activeProfilesCount: number | null = null;
  let totalProfilesCount: number | null = null;

  let totalFleet: number | null = null;
  let activeFleet: number | null = null;
  let locatedFleet: number | null = null;

  try {
    const supabase = await createClient();

    const [profilesRes, snapshotRes] = await Promise.all([
      supabase
        .from('profiles')
        .select('id, role, is_active')
        .eq('organization_id', authContext.organization.id),
      getOperationsSnapshot(),
    ]);

    if (profilesRes.error) {
      console.error('Failed to load user profiles for admin:', profilesRes.error);
      profilesFailed = true;
    } else if (profilesRes.data) {
      const profiles = profilesRes.data;
      totalProfilesCount = profiles.length;
      adminCount = profiles.filter((p) => p.role === 'admin').length;
      operatorCount = profiles.filter((p) => p.role === 'operator').length;
      workerCount = profiles.filter((p) => p.role === 'worker').length;
      activeProfilesCount = profiles.filter((p) => p.is_active).length;
    }

    if (!snapshotRes.success) {
      console.error('Failed to load operations snapshot for admin:', snapshotRes.error);
      snapshotFailed = true;
    } else {
      const vehicles = snapshotRes.snapshot.vehicles;
      totalFleet = vehicles.length;
      activeFleet = vehicles.filter((v) => v.is_active).length;
      locatedFleet = vehicles.filter((v) => v.latitude !== null && v.longitude !== null).length;
    }
  } catch (err) {
    console.error('Failed to load administrative overview metrics:', err);
    profilesFailed = true;
    snapshotFailed = true;
  }

  // Safe server-side environment presence detection (values are NEVER exposed)
  const isSupabaseConfigured = env.supabase.isConfigured;
  const isMapboxConfigured = env.mapbox.isConfigured;
  const isVapiConfigured = Boolean(process.env.VAPI_WEBHOOK_SECRET?.trim());
  const isTwilioConfigured = Boolean(
    process.env.TWILIO_ACCOUNT_SID?.trim() &&
    process.env.TWILIO_AUTH_TOKEN?.trim() &&
    process.env.TWILIO_MESSAGING_SENDER?.trim()
  );

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              System &amp; Organization Administration
            </h1>
            <Badge variant="primary" className="font-mono text-xs">
              Admin Access
            </Badge>
          </div>
          <p className="text-sm text-slate-600 mt-1">
            Read-only administrative overview of organizational tenancy, user access, and system infrastructure.
          </p>
        </div>
      </div>

      {/* Grid of Administrative Sections */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        {/* Section A: Organization Details */}
        <Card className="border-slate-200 bg-white shadow-xs">
          <CardHeader className="py-4 px-5 border-b border-slate-100">
            <CardTitle className="text-sm font-bold uppercase tracking-wider text-slate-800">
              Organization Tenancy
            </CardTitle>
            <CardDescription className="text-xs text-slate-500">
              Authenticated organization and administrative authority.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-5 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <span className="text-[11px] font-semibold text-slate-500 uppercase block">
                  Organization Name
                </span>
                <p className="text-sm font-semibold text-slate-900 mt-1">
                  {authContext.organization.name}
                </p>
              </div>

              <div>
                <span className="text-[11px] font-semibold text-slate-500 uppercase block">
                  Active Administrator
                </span>
                <p className="text-sm font-semibold text-slate-900 mt-1">
                  {authContext.profile.display_name}
                </p>
              </div>

              <div>
                <span className="text-[11px] font-semibold text-slate-500 uppercase block">
                  Administrator Email
                </span>
                <p className="text-xs font-mono text-slate-700 mt-1">
                  {authContext.user.email}
                </p>
              </div>

              <div>
                <span className="text-[11px] font-semibold text-slate-500 uppercase block">
                  Organization Identifier
                </span>
                <p className="text-[11px] font-mono text-slate-500 mt-1 truncate" title={authContext.organization.id}>
                  {authContext.organization.id}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Section B: Access & Users */}
        <Card className="border-slate-200 bg-white shadow-xs">
          <CardHeader className="py-4 px-5 border-b border-slate-100">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-sm font-bold uppercase tracking-wider text-slate-800">
                  Access &amp; User Roster
                </CardTitle>
                <CardDescription className="text-xs text-slate-500">
                  Provisioned user profiles scoped to this organization.
                </CardDescription>
              </div>
              <span className="text-xs font-mono text-slate-400">
                {profilesFailed || totalProfilesCount === null ? '—' : `${totalProfilesCount} total`}
              </span>
            </div>
          </CardHeader>
          <CardContent className="p-5">
            {profilesFailed && (
              <p className="text-xs text-slate-400 italic mb-3">User metrics unavailable</p>
            )}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="p-3 rounded border border-slate-200 bg-slate-50 text-center">
                <span className="text-[11px] font-semibold text-slate-500 uppercase block">
                  Admins
                </span>
                <p className="text-xl font-bold font-mono text-slate-900 mt-1">
                  {profilesFailed || adminCount === null ? '—' : adminCount}
                </p>
              </div>

              <div className="p-3 rounded border border-slate-200 bg-slate-50 text-center">
                <span className="text-[11px] font-semibold text-slate-500 uppercase block">
                  Operators
                </span>
                <p className="text-xl font-bold font-mono text-slate-900 mt-1">
                  {profilesFailed || operatorCount === null ? '—' : operatorCount}
                </p>
              </div>

              <div className="p-3 rounded border border-slate-200 bg-slate-50 text-center">
                <span className="text-[11px] font-semibold text-slate-500 uppercase block">
                  Workers
                </span>
                <p className="text-xl font-bold font-mono text-slate-900 mt-1">
                  {profilesFailed || workerCount === null ? '—' : workerCount}
                </p>
              </div>

              <div className="p-3 rounded border border-slate-200 bg-slate-50 text-center">
                <span className="text-[11px] font-semibold text-slate-500 uppercase block">
                  Active
                </span>
                <p className="text-xl font-bold font-mono text-emerald-600 mt-1">
                  {profilesFailed || activeProfilesCount === null ? '—' : activeProfilesCount}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Section C: Operational Resources */}
        <Card className="border-slate-200 bg-white shadow-xs">
          <CardHeader className="py-4 px-5 border-b border-slate-100">
            <CardTitle className="text-sm font-bold uppercase tracking-wider text-slate-800">
              Operational Fleet Resources
            </CardTitle>
            <CardDescription className="text-xs text-slate-500">
              Mobile response units and spatial tracking readiness.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-5">
            {snapshotFailed && (
              <p className="text-xs text-slate-400 italic mb-3">Fleet metrics unavailable</p>
            )}
            <div className="grid grid-cols-3 gap-3">
              <div className="p-3 rounded border border-slate-200 bg-slate-50 text-center">
                <span className="text-[11px] font-semibold text-slate-500 uppercase block">
                  Total Units
                </span>
                <p className="text-xl font-bold font-mono text-slate-900 mt-1">
                  {snapshotFailed || totalFleet === null ? '—' : totalFleet}
                </p>
              </div>

              <div className="p-3 rounded border border-slate-200 bg-slate-50 text-center">
                <span className="text-[11px] font-semibold text-slate-500 uppercase block">
                  Active Units
                </span>
                <p className="text-xl font-bold font-mono text-emerald-600 mt-1">
                  {snapshotFailed || activeFleet === null ? '—' : activeFleet}
                </p>
              </div>

              <div className="p-3 rounded border border-slate-200 bg-slate-50 text-center">
                <span className="text-[11px] font-semibold text-slate-500 uppercase block">
                  Located Units
                </span>
                <p className="text-xl font-bold font-mono text-sky-600 mt-1">
                  {snapshotFailed || locatedFleet === null ? '—' : locatedFleet}
                </p>
              </div>
            </div>
            <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
              <span className="text-slate-500">Review vehicle capabilities:</span>
              <Link href="/fleet" className="font-semibold text-slate-900 hover:underline">
                View Fleet Registry →
              </Link>
            </div>
          </CardContent>
        </Card>

        {/* Section D: Application Configuration */}
        <Card className="border-slate-200 bg-white shadow-xs">
          <CardHeader className="py-4 px-5 border-b border-slate-100">
            <CardTitle className="text-sm font-bold uppercase tracking-wider text-slate-800">
              Application &amp; Service Integrations
            </CardTitle>
            <CardDescription className="text-xs text-slate-500">
              Safe detection of configured backend services (credentials are never displayed).
            </CardDescription>
          </CardHeader>
          <CardContent className="p-5 space-y-3">
            <div className="divide-y divide-slate-100 text-xs">
              {/* Supabase */}
              <div className="py-2.5 flex items-center justify-between">
                <div>
                  <div className="font-semibold text-slate-900">Supabase Backend &amp; Database</div>
                  <div className="text-[11px] text-slate-500">PostgreSQL, RLS security policies, and Auth</div>
                </div>
                {isSupabaseConfigured ? (
                  <Badge variant="success" className="font-mono text-xs">
                    Configuration detected
                  </Badge>
                ) : (
                  <Badge variant="outline" className="font-mono text-xs text-slate-500">
                    Not configured
                  </Badge>
                )}
              </div>

              {/* Mapbox */}
              <div className="py-2.5 flex items-center justify-between">
                <div>
                  <div className="font-semibold text-slate-900">Mapbox GL Spatial Engine</div>
                  <div className="text-[11px] text-slate-500">Interactive operational map and fleet rendering</div>
                </div>
                {isMapboxConfigured ? (
                  <Badge variant="success" className="font-mono text-xs">
                    Configuration detected
                  </Badge>
                ) : (
                  <Badge variant="outline" className="font-mono text-xs text-slate-500">
                    Not configured
                  </Badge>
                )}
              </div>

              {/* Vapi */}
              <div className="py-2.5 flex items-center justify-between">
                <div>
                  <div className="font-semibold text-slate-900">Vapi Voice Incident Intake</div>
                  <div className="text-[11px] text-slate-500">Automated telephony intake webhook receiver</div>
                </div>
                {isVapiConfigured ? (
                  <Badge variant="success" className="font-mono text-xs">
                    Configuration detected
                  </Badge>
                ) : (
                  <Badge variant="outline" className="font-mono text-xs text-slate-500">
                    Not configured
                  </Badge>
                )}
              </div>

              {/* Twilio */}
              <div className="py-2.5 flex items-center justify-between">
                <div>
                  <div className="font-semibold text-slate-900">Twilio Telephony &amp; SMS Gateway</div>
                  <div className="text-[11px] text-slate-500">Customer location dispatch SMS messaging</div>
                </div>
                {isTwilioConfigured ? (
                  <Badge variant="success" className="font-mono text-xs">
                    Configuration detected
                  </Badge>
                ) : (
                  <Badge variant="outline" className="font-mono text-xs text-slate-500">
                    Not configured
                  </Badge>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Section E: Security Boundary Architecture Summary */}
      <Card className="border-slate-200 bg-white shadow-xs">
        <CardHeader className="py-4 px-5 border-b border-slate-100">
          <CardTitle className="text-sm font-bold uppercase tracking-wider text-slate-800">
            Security Architecture &amp; Boundary Controls
          </CardTitle>
          <CardDescription className="text-xs text-slate-500">
            Multi-tenant isolation and security enforcement model.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-5">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
            <div className="p-3 rounded border border-slate-200 bg-slate-50 space-y-1">
              <span className="font-semibold text-slate-900 block">
                Multi-Tenant Isolation
              </span>
              <p className="text-slate-600 text-[11px]">
                Strict tenant scoping enforced at the database level with defense-in-depth application filtering on all incident, vehicle, and profile queries.
              </p>
            </div>

            <div className="p-3 rounded border border-slate-200 bg-slate-50 space-y-1">
              <span className="font-semibold text-slate-900 block">
                Role-Based Access
              </span>
              <p className="text-slate-600 text-[11px]">
                Authoritative three-tier role system (Admin, Operator, Worker) guarding server routes, operator shell, and mobile response surfaces.
              </p>
            </div>

            <div className="p-3 rounded border border-slate-200 bg-slate-50 space-y-1">
              <span className="font-semibold text-slate-900 block">
                Row Level Security
              </span>
              <p className="text-slate-600 text-[11px]">
                PostgreSQL RLS policies enabled across all operational tables preventing unauthorized cross-tenant data access or mutation.
              </p>
            </div>

            <div className="p-3 rounded border border-slate-200 bg-slate-50 space-y-1">
              <span className="font-semibold text-slate-900 block">
                Immutable Audit Trail
              </span>
              <p className="text-slate-600 text-[11px]">
                Comprehensive operational event log recording all state machine transitions, dispatch allocations, and operator actions with database-level immutability triggers.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
