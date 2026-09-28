import Link from 'next/link';
import { PlaceholderPanel } from '@/components/ui/placeholder-panel';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { getCurrentUser } from '@/lib/auth/get-user';

export const metadata = {
  title: 'Administration | Matos Systems Roadside',
  description: 'Organization administration, user roles, and system configuration.',
};

export default async function AdminPage() {
  const authContext = await getCurrentUser();
  const role = authContext?.profile?.role;

  // Server-side boundary check: non-admin operators are strictly denied
  if (authContext && role !== 'admin') {
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
              Per the Phase 2 security policy, operators are authorized to manage operations, incidents, and fleet units, but cannot access organization-level administration or alter user roles.
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

  return (
    <PlaceholderPanel
      title="System & Organization Administration"
      surface="Admin Only"
      plannedCapabilities={[
        'Organization profile, operating hours, and service boundary management',
        'User management: Invite, activate, and assign roles (Admin, Dispatcher, Worker)',
        'Capability and equipment taxonomy definition',
        'Telephony and intake webhook configuration (Twilio & Vapi credentials)',
        'Mapbox API and PostGIS spatial indexing management',
        'System health, database connection, and webhook delivery diagnostics',
      ]}
      notes="Administrative controls and role assignment require Admin authorization. Database RLS policies and privilege escalation triggers prevent unauthorized role alteration."
    />
  );
}
