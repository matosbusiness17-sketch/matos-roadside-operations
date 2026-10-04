import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getCurrentUser } from '@/lib/auth/get-user';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Incident,
  IncidentPriority,
  IncidentStatus,
  OperationalEvent,
  TERMINAL_INCIDENT_STATUSES,
} from '@/types';
import {
  formatIncidentStatus,
  formatServiceType,
  formatDateTime,
} from '@/lib/formatters';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Operational History & Audit | Matos Systems Roadside',
  description: 'Archived terminal incident records and operational event audit history.',
};

export default async function HistoryPage() {
  const authContext = await getCurrentUser();

  if (!authContext || !authContext.profile || !authContext.profile.is_active) {
    redirect('/login?redirectTo=/history');
  }

  const role = authContext.profile.role;

  // Workers must never render operator surfaces
  if (role === 'worker') {
    redirect('/worker?error=unauthorized_surface');
  }

  // Only admin and operator may access this page
  if (role !== 'admin' && role !== 'operator') {
    redirect('/login');
  }

  let terminalIncidents: Incident[] = [];
  let operationalEvents: OperationalEvent[] = [];
  let incidentsError: string | null = null;
  let eventsError: string | null = null;

  try {
    const supabase = await createClient();

    const [incidentsRes, eventsRes] = await Promise.all([
      // 1. Query terminal incidents for caller organization (defense-in-depth on top of RLS)
      supabase
        .from('incidents')
        .select('*')
        .eq('organization_id', authContext.organization.id)
        .in('status', TERMINAL_INCIDENT_STATUSES)
        .order('updated_at', { ascending: false }),

      // 2. Query recent operational audit events for caller organization
      supabase
        .from('operational_events')
        .select('*, actor:profiles(display_name, role)')
        .eq('organization_id', authContext.organization.id)
        .order('created_at', { ascending: false })
        .limit(100),
    ]);

    if (incidentsRes.error) {
      console.error('Failed to query terminal incidents history:', incidentsRes.error);
      incidentsError = 'Unable to load terminal incidents history. Please try again.';
    } else {
      terminalIncidents = (incidentsRes.data as unknown as Incident[]) || [];
    }

    if (eventsRes.error) {
      console.error('Failed to query operational events audit log:', eventsRes.error);
      eventsError = 'Unable to load operational audit events. Please try again.';
    } else {
      operationalEvents = (eventsRes.data as unknown as OperationalEvent[]) || [];
    }
  } catch (err) {
    console.error('Exception querying operational history and audit records:', err);
    incidentsError = 'Unable to load terminal incidents history. Please try again.';
    eventsError = 'Unable to load operational audit events. Please try again.';
  }

  // Summary counts derived strictly from queried data
  const totalTerminalCount = terminalIncidents.length;
  const completedCount = terminalIncidents.filter((i) => i.status === 'completed').length;
  const cancelledCount = terminalIncidents.filter((i) => i.status === 'cancelled').length;
  const unableCount = terminalIncidents.filter((i) => i.status === 'unable_to_complete').length;
  const cancelledOrUnableCount = cancelledCount + unableCount;
  const auditEventsCount = operationalEvents.length;

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              Operational History & Audit
            </h1>
            <Badge variant="outline" className="font-mono text-xs">
              {authContext.organization.name}
            </Badge>
          </div>
          <p className="text-sm text-slate-600 mt-1">
            Archived terminal incident records and immutable operational event audit logs.
          </p>
        </div>
      </div>

      {/* Summary Metric Cards (Derived exclusively from authoritative queried records) */}
      <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="border-slate-200 bg-white">
          <CardContent className="p-4">
            <div className="text-xs font-medium text-slate-500 uppercase tracking-wider">
              Terminal Incidents
            </div>
            <div className="text-2xl font-bold font-mono text-slate-900 mt-1">
              {incidentsError ? '—' : totalTerminalCount}
            </div>
            <div className="text-[11px] text-slate-400 mt-1">
              Archived lifecycle records
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-200 bg-white">
          <CardContent className="p-4">
            <div className="text-xs font-medium text-slate-500 uppercase tracking-wider">
              Completed
            </div>
            <div className="text-2xl font-bold font-mono text-emerald-600 mt-1">
              {incidentsError ? '—' : completedCount}
            </div>
            <div className="text-[11px] text-slate-400 mt-1">
              Successfully resolved
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-200 bg-white">
          <CardContent className="p-4">
            <div className="text-xs font-medium text-slate-500 uppercase tracking-wider">
              Cancelled / Unable
            </div>
            <div className="text-2xl font-bold font-mono text-slate-700 mt-1">
              {incidentsError ? '—' : cancelledOrUnableCount}
            </div>
            <div className="text-[11px] text-slate-400 mt-1">
              {incidentsError ? '—' : `${cancelledCount} cancelled, ${unableCount} unable`}
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-200 bg-white">
          <CardContent className="p-4">
            <div className="text-xs font-medium text-slate-500 uppercase tracking-wider">
              Recent Audit Events
            </div>
            <div className="text-2xl font-bold font-mono text-slate-900 mt-1">
              {eventsError ? '—' : auditEventsCount}
            </div>
            <div className="text-[11px] text-slate-400 mt-1">
              Logged operational events
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main 2-Column Responsive Layout */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* Left Column: Terminal Incident History */}
        <div className="xl:col-span-7 2xl:col-span-8 space-y-4">
          <Card className="border-slate-200 bg-white shadow-xs">
            <CardHeader className="py-4 px-5 border-b border-slate-100">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-sm font-bold uppercase tracking-wider text-slate-800">
                    Terminal Incident History
                  </CardTitle>
                  <CardDescription className="text-xs text-slate-500 mt-0.5">
                    Completed, cancelled, and unable to complete incidents ordered by latest update.
                  </CardDescription>
                </div>
                <span className="text-xs font-mono text-slate-400">
                  {totalTerminalCount} records
                </span>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {incidentsError ? (
                <div className="p-8 text-center">
                  <p className="text-xs font-semibold text-rose-600 mb-1">
                    Failed to load incident history
                  </p>
                  <p className="text-xs text-slate-500 max-w-sm mx-auto">
                    {incidentsError}
                  </p>
                </div>
              ) : terminalIncidents.length === 0 ? (
                <div className="p-12 text-center space-y-2">
                  <div className="mx-auto w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 font-bold text-lg">
                    Ø
                  </div>
                  <h4 className="text-sm font-semibold text-slate-900">
                    No terminal incidents recorded
                  </h4>
                  <p className="text-xs text-slate-500 max-w-sm mx-auto">
                    No incidents in this organization have reached a terminal status (completed, cancelled, or unable to complete).
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs text-slate-600 border-collapse">
                    <thead className="bg-slate-50 text-[11px] font-semibold text-slate-500 uppercase tracking-wider border-b border-slate-200">
                      <tr>
                        <th scope="col" className="py-3 px-4">Reference</th>
                        <th scope="col" className="py-3 px-4">Final Status</th>
                        <th scope="col" className="py-3 px-4">Priority</th>
                        <th scope="col" className="py-3 px-4">Customer</th>
                        <th scope="col" className="py-3 px-4">Service</th>
                        <th scope="col" className="py-3 px-4">Location</th>
                        <th scope="col" className="py-3 px-4">Created</th>
                        <th scope="col" className="py-3 px-4">Updated</th>
                        <th scope="col" className="py-3 px-4 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {terminalIncidents.map((incident) => (
                        <tr
                          key={incident.id}
                          className="hover:bg-slate-50/80 transition-colors"
                        >
                          <td className="py-3 px-4 font-mono font-semibold text-slate-900 whitespace-nowrap">
                            <Link
                              href={`/incidents/${incident.id}`}
                              className="hover:underline text-slate-900"
                            >
                              {incident.reference_number}
                            </Link>
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap">
                            <StatusBadge status={incident.status} />
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap">
                            <PriorityBadge priority={incident.priority} />
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap font-medium text-slate-800">
                            {incident.customer_name}
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap text-slate-700 capitalize">
                            {formatServiceType(incident.service_type)}
                          </td>
                          <td
                            className="py-3 px-4 text-slate-600 max-w-[200px] truncate"
                            title={incident.location_address}
                          >
                            {incident.location_address}
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap text-[11px] text-slate-500 font-mono">
                            {formatDateTime(incident.created_at)}
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap text-[11px] text-slate-500 font-mono">
                            {formatDateTime(incident.updated_at)}
                          </td>
                          <td className="py-3 px-4 text-right whitespace-nowrap">
                            <Link
                              href={`/incidents/${incident.id}`}
                              className="text-xs font-semibold text-blue-600 hover:text-blue-800 hover:underline"
                            >
                              View →
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right Column: Recent Operational Events Audit Trail */}
        <div className="xl:col-span-5 2xl:col-span-4 space-y-4">
          <Card className="border-slate-200 bg-white shadow-xs">
            <CardHeader className="py-4 px-5 border-b border-slate-100">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-sm font-bold uppercase tracking-wider text-slate-800">
                    Operational Audit Trail
                  </CardTitle>
                  <CardDescription className="text-xs text-slate-500 mt-0.5">
                    Immutable event log of operational transitions and dispatches.
                  </CardDescription>
                </div>
                <span className="text-xs font-mono text-slate-400">
                  {auditEventsCount} events
                </span>
              </div>
            </CardHeader>
            <CardContent className="p-5">
              {eventsError ? (
                <div className="py-8 text-center">
                  <p className="text-xs font-semibold text-rose-600 mb-1">
                    Failed to load operational events
                  </p>
                  <p className="text-xs text-slate-500 max-w-sm mx-auto">
                    {eventsError}
                  </p>
                </div>
              ) : operationalEvents.length === 0 ? (
                <div className="py-8 text-center text-slate-400 text-xs italic">
                  No operational audit events recorded for this organization.
                </div>
              ) : (
                <div className="max-h-[800px] overflow-y-auto pr-1">
                  <div className="relative border-l-2 border-slate-200 ml-2 pl-4 space-y-5">
                    {operationalEvents.map((evt) => (
                      <div key={evt.id} className="relative">
                        {/* Timeline Node Dot */}
                        <div className="absolute -left-[23px] top-1.5 h-3 w-3 rounded-full border-2 border-white bg-slate-700" />

                        <div className="space-y-1.5">
                          <div className="flex flex-wrap items-center justify-between gap-1">
                            <span className="font-mono text-xs font-bold text-slate-900">
                              {evt.event_type}
                            </span>
                            <span className="text-[10px] font-mono text-slate-400 whitespace-nowrap">
                              {formatDateTime(evt.created_at)}
                            </span>
                          </div>

                          <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                            {evt.actor ? (
                              <span>
                                Actor:{' '}
                                <strong className="text-slate-700">
                                  {evt.actor.display_name}
                                </strong>{' '}
                                <span className="text-slate-400 font-mono">
                                  ({evt.actor.role})
                                </span>
                              </span>
                            ) : (
                              <span className="text-slate-400 italic">
                                System / Automated
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-1.5 text-[11px] font-mono">
                            <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-sans font-medium text-[10px] uppercase">
                              {evt.entity_type}
                            </span>
                            {evt.entity_type === 'incident' ? (
                              <Link
                                href={`/incidents/${evt.entity_id}`}
                                className="text-blue-600 hover:underline truncate max-w-[220px]"
                                title={`View incident ${evt.entity_id}`}
                              >
                                {evt.entity_id}
                              </Link>
                            ) : (
                              <span
                                className="truncate max-w-[220px] text-slate-600"
                                title={evt.entity_id}
                              >
                                {evt.entity_id}
                              </span>
                            )}
                          </div>

                          {/* Specialized readable view for status changes */}
                          {evt.event_type === 'INCIDENT_STATUS_CHANGED' &&
                            evt.metadata &&
                            typeof evt.metadata.previous_status === 'string' &&
                            typeof evt.metadata.new_status === 'string' && (
                              <div className="mt-1 p-2 rounded bg-slate-50 border border-slate-200 text-[11px] font-mono text-slate-700 space-y-1">
                                <div className="flex items-center gap-1.5 font-semibold">
                                  <span className="text-slate-500">
                                    {formatIncidentStatus(evt.metadata.previous_status)}
                                  </span>
                                  <span>→</span>
                                  <span className="text-slate-900">
                                    {formatIncidentStatus(evt.metadata.new_status)}
                                  </span>
                                </div>
                                {typeof evt.metadata.reason === 'string' && evt.metadata.reason && (
                                  <div className="text-[10px] text-slate-600 font-sans italic border-t border-slate-200 pt-1 mt-1">
                                    Reason: &quot;{evt.metadata.reason}&quot;
                                  </div>
                                )}
                              </div>
                            )}

                          {/* Collapsible raw metadata */}
                          {evt.metadata && Object.keys(evt.metadata).length > 0 ? (
                            <details className="mt-1 text-[11px] group">
                              <summary className="cursor-pointer text-slate-500 hover:text-slate-800 font-sans text-[11px] select-none py-0.5">
                                View metadata
                              </summary>
                              <pre className="mt-1 p-2 rounded bg-slate-50 border border-slate-200 text-[10px] font-mono text-slate-700 overflow-x-auto max-h-40 whitespace-pre-wrap break-all">
                                {JSON.stringify(evt.metadata, null, 2)}
                              </pre>
                            </details>
                          ) : (
                            <div className="text-[10px] text-slate-400 italic">
                              No metadata recorded
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}


/**
 * Visual badge for terminal and general incident statuses using existing Badge component
 */
function StatusBadge({ status }: { status: IncidentStatus }) {
  if (status === 'completed') {
    return (
      <Badge variant="success" className="font-mono text-xs font-semibold">
        Completed
      </Badge>
    );
  }

  if (status === 'cancelled') {
    return (
      <Badge
        variant="default"
        className="font-mono text-xs font-semibold bg-slate-100 text-slate-700 border-slate-300"
      >
        Cancelled
      </Badge>
    );
  }

  if (status === 'unable_to_complete') {
    return (
      <Badge variant="destructive" className="font-mono text-xs font-semibold">
        Unable to Complete
      </Badge>
    );
  }

  return (
    <Badge variant="outline" className="font-mono text-xs font-semibold">
      {status}
    </Badge>
  );
}

/**
 * Visual badge for incident priority using existing Badge component
 */
function PriorityBadge({ priority }: { priority: IncidentPriority | string }) {
  if (priority === 'critical') {
    return (
      <Badge variant="destructive" className="font-mono text-[11px] uppercase font-bold">
        critical
      </Badge>
    );
  }

  if (priority === 'high') {
    return (
      <Badge variant="warning" className="font-mono text-[11px] uppercase font-semibold">
        high
      </Badge>
    );
  }

  if (priority === 'low') {
    return (
      <Badge variant="default" className="font-mono text-[11px] uppercase text-slate-600">
        low
      </Badge>
    );
  }

  return (
    <Badge variant="default" className="font-mono text-[11px] uppercase text-slate-700">
      {priority}
    </Badge>
  );
}
