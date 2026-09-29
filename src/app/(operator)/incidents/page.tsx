import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getCurrentUser } from '@/lib/auth/get-user';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  Incident,
  IncidentStatus,
  ACTIVE_INCIDENT_STATUSES,
  TERMINAL_INCIDENT_STATUSES,
} from '@/types';

export const metadata = {
  title: 'Incidents Queue | Matos Systems Roadside',
  description: 'Database-backed roadside operations queue and incident lifecycle management.',
};

interface IncidentsPageProps {
  searchParams: Promise<{ tab?: string; status?: string }>;
}

export default async function IncidentsPage({ searchParams }: IncidentsPageProps) {
  const authContext = await getCurrentUser();

  if (!authContext || !authContext.profile || !authContext.profile.is_active) {
    redirect('/login?redirectTo=/incidents');
  }

  const { tab = 'active', status: statusFilter } = await searchParams;

  let incidents: Incident[] = [];
  let queryError: string | null = null;

  try {
    const supabase = await createClient();
    // Real database query, scoped with authenticated server context (defense-in-depth on top of RLS)
    const query = supabase
      .from('incidents')
      .select('*, required_capability:service_capabilities(*)')
      .eq('organization_id', authContext.organization.id)
      .order('created_at', { ascending: false });

    const { data, error } = await query;

    if (error) {
      console.error('Failed to load incidents queue:', error);
      queryError = 'Unable to load the incident queue. Please try again.';
    } else {
      incidents = (data as unknown as Incident[]) || [];
    }
  } catch (err) {
    console.error('Exception loading incidents queue:', err);
    queryError = 'Unable to load the incident queue. Please try again.';
  }

  // Count tallies
  const activeCount = incidents.filter((i) =>
    ACTIVE_INCIDENT_STATUSES.includes(i.status)
  ).length;
  const terminalCount = incidents.filter((i) =>
    TERMINAL_INCIDENT_STATUSES.includes(i.status)
  ).length;
  const totalCount = incidents.length;

  // Filter based on active tab / status query
  const filteredIncidents = incidents.filter((incident) => {
    if (statusFilter) {
      return incident.status === statusFilter;
    }
    if (tab === 'closed') {
      return TERMINAL_INCIDENT_STATUSES.includes(incident.status);
    }
    if (tab === 'all') {
      return true;
    }
    // Default 'active'
    return ACTIVE_INCIDENT_STATUSES.includes(incident.status);
  });

  return (
    <div className="space-y-6">
      {/* Queue Header & Primary Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              Operational Incidents Queue
            </h1>
            <Badge variant="outline" className="font-mono text-xs">
              {authContext.organization.name}
            </Badge>
          </div>
          <p className="text-sm text-slate-600 mt-1">
            Dispatch triage, lifecycle tracking, and roadside response management.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/incidents/new"
            className="inline-flex items-center justify-center rounded-md bg-slate-900 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-slate-800 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
          >
            + New Incident
          </Link>
        </div>
      </div>

      {/* Query Error Notice */}
      {queryError && (
        <div className="rounded-md border border-rose-200 bg-rose-50 p-4 text-xs text-rose-800">
          <strong>Database Notice:</strong> {queryError}
        </div>
      )}

      {/* Queue Filters / Tab Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs border-b border-slate-200 pb-3">
        <div className="flex items-center gap-1.5 bg-slate-100 p-1 rounded-lg">
          <Link
            href="/incidents?tab=active"
            className={`px-3 py-1.5 rounded-md font-medium transition-colors ${
              tab === 'active' && !statusFilter
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Active Incidents ({activeCount})
          </Link>
          <Link
            href="/incidents?tab=closed"
            className={`px-3 py-1.5 rounded-md font-medium transition-colors ${
              tab === 'closed' && !statusFilter
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Completed / Closed ({terminalCount})
          </Link>
          <Link
            href="/incidents?tab=all"
            className={`px-3 py-1.5 rounded-md font-medium transition-colors ${
              tab === 'all' && !statusFilter
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            All Incidents ({totalCount})
          </Link>
        </div>

        {/* Status Breakdown Pill Bar */}
        <div className="flex items-center gap-1 overflow-x-auto text-[11px] text-slate-500 py-1">
          <span className="font-semibold text-slate-700 mr-1">Status:</span>
          {[
            'new',
            'triaged',
            'ready_for_dispatch',
            'dispatched',
            'en_route',
            'on_scene',
            'in_progress',
            'completed',
            'cancelled',
            'unable_to_complete',
          ].map((st) => (
            <Link
              key={st}
              href={`/incidents?status=${st}`}
              className={`px-2 py-0.5 rounded font-mono transition-colors ${
                statusFilter === st
                  ? 'bg-slate-900 text-white font-semibold'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {st}
            </Link>
          ))}
          {statusFilter && (
            <Link
              href="/incidents?tab=active"
              className="text-slate-500 hover:text-slate-900 underline ml-1"
            >
              clear
            </Link>
          )}
        </div>
      </div>

      {/* Incidents Table / Queue Content */}
      {filteredIncidents.length === 0 ? (
        <Card className="border-slate-200 bg-white">
          <CardContent className="p-12 text-center space-y-3">
            <div className="mx-auto w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 font-bold text-lg">
              Ø
            </div>
            <h3 className="text-sm font-semibold text-slate-900">
              No incidents match this operational view
            </h3>
            <p className="text-xs text-slate-500 max-w-sm mx-auto">
              {tab === 'active'
                ? 'There are currently no active incidents awaiting dispatch or response in this organization.'
                : 'No incident records were found matching the selected filter criteria.'}
            </p>
            <div className="pt-2">
              <Link
                href="/incidents/new"
                className="inline-flex items-center text-xs font-semibold text-slate-900 hover:underline"
              >
                + Create new roadside incident →
              </Link>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-xs">
          <table className="w-full text-left text-xs text-slate-600 border-collapse">
            <thead className="bg-slate-50 text-[11px] font-semibold text-slate-500 uppercase tracking-wider border-b border-slate-200">
              <tr>
                <th scope="col" className="py-3 px-4">Reference</th>
                <th scope="col" className="py-3 px-4">Status</th>
                <th scope="col" className="py-3 px-4">Priority</th>
                <th scope="col" className="py-3 px-4">Customer</th>
                <th scope="col" className="py-3 px-4">Service & Capability</th>
                <th scope="col" className="py-3 px-4">Vehicle</th>
                <th scope="col" className="py-3 px-4">Location</th>
                <th scope="col" className="py-3 px-4">Created</th>
                <th scope="col" className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredIncidents.map((incident) => (
                <tr
                  key={incident.id}
                  className="hover:bg-slate-50/80 transition-colors"
                >
                  {/* Reference Number */}
                  <td className="py-3 px-4 font-mono font-semibold text-slate-900">
                    <Link
                      href={`/incidents/${incident.id}`}
                      className="hover:underline text-slate-900"
                    >
                      {incident.reference_number}
                    </Link>
                  </td>

                  {/* Status Badge */}
                  <td className="py-3 px-4 whitespace-nowrap">
                    <StatusBadge status={incident.status} />
                  </td>

                  {/* Priority Badge */}
                  <td className="py-3 px-4 whitespace-nowrap">
                    <PriorityBadge priority={incident.priority} />
                  </td>

                  {/* Customer Information */}
                  <td className="py-3 px-4 whitespace-nowrap">
                    <div className="font-medium text-slate-900">{incident.customer_name}</div>
                    <div className="text-[11px] text-slate-400 font-mono">{incident.customer_phone}</div>
                  </td>

                  {/* Service & Capability */}
                  <td className="py-3 px-4">
                    <div className="font-medium text-slate-900 capitalize">
                      {incident.service_type.replace('_', ' ')}
                    </div>
                    {incident.required_capability && (
                      <div className="text-[11px] text-slate-500 font-mono">
                        Req: {incident.required_capability.name}
                      </div>
                    )}
                  </td>

                  {/* Customer Vehicle */}
                  <td className="py-3 px-4">
                    {incident.vehicle_registration ? (
                      <div>
                        <span className="font-mono text-[11px] font-semibold text-slate-800 bg-slate-100 px-1.5 py-0.5 rounded">
                          {incident.vehicle_registration}
                        </span>
                        {(incident.vehicle_make || incident.vehicle_model) && (
                          <div className="text-[11px] text-slate-500 mt-0.5">
                            {incident.vehicle_year || ''} {incident.vehicle_make || ''} {incident.vehicle_model || ''}
                          </div>
                        )}
                      </div>
                    ) : (
                      <span className="text-slate-400 italic">
                        {incident.vehicle_info || 'Not specified'}
                      </span>
                    )}
                  </td>

                  {/* Location Address */}
                  <td className="py-3 px-4 max-w-[220px] truncate" title={incident.location_address}>
                    <div className="truncate font-medium text-slate-800">
                      {incident.location_address}
                    </div>
                    {incident.location_source && (
                      <div className="text-[10px] text-slate-400 font-mono uppercase">
                        Source: {incident.location_source}
                      </div>
                    )}
                  </td>

                  {/* Created At */}
                  <td className="py-3 px-4 whitespace-nowrap text-slate-500">
                    <div>{new Date(incident.created_at).toLocaleDateString()}</div>
                    <div className="text-[10px] text-slate-400 font-mono">
                      {new Date(incident.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </td>

                  {/* Detail Link Action */}
                  <td className="py-3 px-4 text-right whitespace-nowrap">
                    <Link
                      href={`/incidents/${incident.id}`}
                      className="inline-flex items-center text-xs font-semibold text-slate-900 hover:text-slate-700 underline"
                    >
                      View Record →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/**
 * Render visual badge for 10-state incident status
 */
function StatusBadge({ status }: { status: IncidentStatus }) {
  const styles: Record<IncidentStatus, { label: string; className: string }> = {
    new: { label: 'New', className: 'bg-sky-50 text-sky-700 border-sky-200' },
    triaged: { label: 'Triaged', className: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
    ready_for_dispatch: { label: 'Ready for Dispatch', className: 'bg-amber-50 text-amber-700 border-amber-200' },
    dispatched: { label: 'Dispatched', className: 'bg-purple-50 text-purple-700 border-purple-200' },
    en_route: { label: 'En Route', className: 'bg-cyan-50 text-cyan-700 border-cyan-200' },
    on_scene: { label: 'On Scene', className: 'bg-teal-50 text-teal-700 border-teal-200' },
    in_progress: { label: 'In Progress', className: 'bg-blue-50 text-blue-700 border-blue-200' },
    completed: { label: 'Completed', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
    cancelled: { label: 'Cancelled', className: 'bg-slate-100 text-slate-700 border-slate-300' },
    unable_to_complete: { label: 'Unable to Complete', className: 'bg-rose-50 text-rose-700 border-rose-200' },
  };

  const current = styles[status] || { label: status, className: 'bg-slate-100 text-slate-700 border-slate-200' };

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium border font-mono ${current.className}`}
    >
      {current.label}
    </span>
  );
}

/**
 * Render visual badge for incident priority
 */
function PriorityBadge({ priority }: { priority: string }) {
  const styles: Record<string, string> = {
    low: 'bg-slate-100 text-slate-600 border-slate-200',
    standard: 'bg-slate-100 text-slate-700 border-slate-200',
    high: 'bg-amber-50 text-amber-700 border-amber-200 font-semibold',
    critical: 'bg-rose-50 text-rose-700 border-rose-200 font-bold',
  };

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium border uppercase tracking-wider font-mono ${
        styles[priority] || styles.standard
      }`}
    >
      {priority}
    </span>
  );
}
