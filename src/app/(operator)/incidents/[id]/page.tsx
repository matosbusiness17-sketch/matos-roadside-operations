import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getCurrentUser } from '@/lib/auth/get-user';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { IncidentTransitionControls } from '@/components/incidents/incident-transition-controls';
import { CustomerLocationLinkControl } from '@/components/incidents/customer-location-link-control';
import { Incident, IncidentStatus, OperationalEvent } from '@/types';

export const metadata = {
  title: 'Incident Detail | Matos Systems Roadside',
  description: 'Roadside operations record, state transitions, and audit event history.',
};

interface IncidentDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function IncidentDetailPage({ params }: IncidentDetailPageProps) {
  const authContext = await getCurrentUser();

  if (!authContext || !authContext.profile || !authContext.profile.is_active) {
    redirect('/login');
  }

  // Operator and Admin access
  if (authContext.profile.role !== 'admin' && authContext.profile.role !== 'operator') {
    redirect('/incidents');
  }

  const { id } = await params;

  let incident: Incident | null = null;
  let operationalEvents: OperationalEvent[] = [];

  try {
    const supabase = await createClient();

    // 1. Fetch incident strictly within caller organization (defense in depth on top of RLS)
    const { data: incidentData, error: incidentError } = await supabase
      .from('incidents')
      .select('*, required_capability:service_capabilities(*), creator:profiles(display_name, role)')
      .eq('id', id)
      .eq('organization_id', authContext.organization.id)
      .single();

    if (incidentError || !incidentData) {
      console.error('Incident not found or inaccessible:', incidentError);
      notFound();
    }

    incident = incidentData as unknown as Incident;

    // 2. Fetch operational events for this incident
    const { data: eventsData, error: eventsError } = await supabase
      .from('operational_events')
      .select('*, actor:profiles(display_name, role)')
      .eq('entity_id', incident.id)
      .eq('entity_type', 'incident')
      .order('created_at', { ascending: false });

    if (eventsError) {
      console.error('Failed to load operational events for incident:', eventsError);
    } else {
      operationalEvents = (eventsData as unknown as OperationalEvent[]) || [];
    }
  } catch (err) {
    console.error('Exception loading incident detail:', err);
    notFound();
  }

  const coordinates = parseCoordinates(incident.location);

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* Navigation Breadcrumb */}
      <div className="flex items-center gap-2 text-xs text-slate-500">
        <Link href="/incidents" className="hover:text-slate-900 transition-colors">
          ← Incidents Queue
        </Link>
        <span>/</span>
        <span className="font-mono text-slate-900 font-semibold">{incident.reference_number}</span>
      </div>

      {/* Incident Header Record Card */}
      <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-100 pb-5">
          <div className="space-y-1">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold font-mono tracking-tight text-slate-900">
                {incident.reference_number}
              </h1>
              <StatusBadge status={incident.status} />
              <PriorityBadge priority={incident.priority} />
            </div>
            <p className="text-xs text-slate-500">
              Created on {new Date(incident.created_at).toLocaleString()}
              {incident.creator && (
                <span> by <strong className="text-slate-700">{incident.creator.display_name}</strong></span>
              )}
              {incident.updated_at && (
                <span className="ml-2 font-mono text-[11px] text-slate-400">
                  (Updated: {new Date(incident.updated_at).toLocaleTimeString()})
                </span>
              )}
            </p>
          </div>

          <div className="text-right">
            <span className="text-[11px] font-mono text-slate-400 uppercase tracking-wider block">
              Tenant Domain
            </span>
            <Badge variant="outline" className="font-mono text-xs mt-0.5">
              {authContext.organization.name}
            </Badge>
          </div>
        </div>

        {/* State Machine Transition Controls */}
        <div className="pt-5">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-700 mb-3">
            Operational Lifecycle State Transitions
          </h2>
          <IncidentTransitionControls
            incidentId={incident.id}
            currentStatus={incident.status}
          />
        </div>
      </div>

      {/* Main Grid: Details + Audit Event History */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Columns: Structured Incident Information */}
        <div className="lg:col-span-2 space-y-6">
          {/* Customer & Problem Information */}
          <Card className="border-slate-200 shadow-xs">
            <CardHeader className="py-4 px-5 border-b border-slate-100">
              <CardTitle className="text-xs font-bold uppercase tracking-wider text-slate-800">
                Motorist & Breakdown Details
              </CardTitle>
            </CardHeader>
            <CardContent className="p-5 text-xs space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <span className="text-[11px] font-semibold text-slate-500 uppercase block">
                    Customer Name
                  </span>
                  <p className="text-sm font-semibold text-slate-900 mt-0.5">
                    {incident.customer_name}
                  </p>
                </div>
                <div>
                  <span className="text-[11px] font-semibold text-slate-500 uppercase block">
                    Phone Contact
                  </span>
                  <p className="text-sm font-mono font-medium text-slate-900 mt-0.5">
                    {incident.customer_phone}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-3 border-t border-slate-100">
                <div>
                  <span className="text-[11px] font-semibold text-slate-500 uppercase block">
                    Assistance Service Type
                  </span>
                  <p className="text-xs font-semibold text-slate-900 capitalize mt-0.5">
                    {incident.service_type.replace('_', ' ')}
                  </p>
                </div>
                <div>
                  <span className="text-[11px] font-semibold text-slate-500 uppercase block">
                    Required Fleet Capability
                  </span>
                  <p className="text-xs font-medium text-slate-900 mt-0.5">
                    {incident.required_capability ? (
                      <span className="font-semibold text-slate-900">
                        {incident.required_capability.name}
                        <span className="text-[11px] text-slate-500 font-mono ml-1.5">
                          ({incident.required_capability.category})
                        </span>
                      </span>
                    ) : (
                      <span className="text-slate-400 italic">None (Standard Fleet Dispatch)</span>
                    )}
                  </p>
                </div>
              </div>

              {incident.notes && (
                <div className="pt-3 border-t border-slate-100">
                  <span className="text-[11px] font-semibold text-slate-500 uppercase block mb-1">
                    Problem Notes & Hazard Context
                  </span>
                  <p className="text-xs text-slate-700 bg-slate-50 p-3 rounded border border-slate-200 font-mono whitespace-pre-wrap">
                    {incident.notes}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Customer Vehicle Information */}
          <Card className="border-slate-200 shadow-xs">
            <CardHeader className="py-4 px-5 border-b border-slate-100">
              <CardTitle className="text-xs font-bold uppercase tracking-wider text-slate-800">
                Customer Vehicle Information
              </CardTitle>
            </CardHeader>
            <CardContent className="p-5 text-xs">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div>
                  <span className="text-[11px] font-semibold text-slate-500 uppercase block">
                    Registration Plate
                  </span>
                  <p className="text-xs font-mono font-bold text-slate-900 mt-1">
                    {incident.vehicle_registration ? (
                      <span className="bg-slate-100 px-2 py-1 rounded border border-slate-200">
                        {incident.vehicle_registration}
                      </span>
                    ) : (
                      <span className="text-slate-400 italic font-normal">Not recorded</span>
                    )}
                  </p>
                </div>

                <div>
                  <span className="text-[11px] font-semibold text-slate-500 uppercase block">
                    Make & Model
                  </span>
                  <p className="text-xs font-semibold text-slate-800 mt-1">
                    {incident.vehicle_make || incident.vehicle_model
                      ? `${incident.vehicle_make || ''} ${incident.vehicle_model || ''}`
                      : <span className="text-slate-400 italic font-normal">Not recorded</span>}
                  </p>
                </div>

                <div>
                  <span className="text-[11px] font-semibold text-slate-500 uppercase block">
                    Model Year
                  </span>
                  <p className="text-xs font-mono text-slate-800 mt-1">
                    {incident.vehicle_year || <span className="text-slate-400 italic font-normal">N/A</span>}
                  </p>
                </div>

                <div>
                  <span className="text-[11px] font-semibold text-slate-500 uppercase block">
                    Vehicle Color
                  </span>
                  <p className="text-xs text-slate-800 mt-1">
                    {incident.vehicle_color || <span className="text-slate-400 italic font-normal">Not recorded</span>}
                  </p>
                </div>
              </div>

              {incident.vehicle_info && !incident.vehicle_registration && (
                <div className="pt-3 mt-3 border-t border-slate-100">
                  <span className="text-[11px] font-semibold text-slate-500 uppercase block">
                    Legacy Vehicle Info
                  </span>
                  <p className="text-xs text-slate-700 italic mt-0.5">
                    {incident.vehicle_info}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Incident Location & Spatial Reference */}
          <Card className="border-slate-200 shadow-xs">
            <CardHeader className="py-4 px-5 border-b border-slate-100">
              <CardTitle className="text-xs font-bold uppercase tracking-wider text-slate-800">
                Breakdown Location & PostGIS Spatial Reference
              </CardTitle>
            </CardHeader>
            <CardContent className="p-5 text-xs space-y-4">
              <div>
                <span className="text-[11px] font-semibold text-slate-500 uppercase block">
                  Location Address / Landmark
                </span>
                <p className="text-xs font-semibold text-slate-900 mt-1">
                  {incident.location_address}
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-3 border-t border-slate-100">
                <div>
                  <span className="text-[11px] font-semibold text-slate-500 uppercase block">
                    Location Source
                  </span>
                  <p className="text-xs font-mono text-slate-700 mt-1">
                    {incident.location_source ?? 'Not recorded'}
                  </p>
                </div>

                <div>
                  <span className="text-[11px] font-semibold text-slate-500 uppercase block">
                    Spatial Accuracy
                  </span>
                  <p className="text-xs font-mono text-slate-700 mt-1">
                    {incident.location_accuracy !== null && incident.location_accuracy !== undefined
                      ? `±${incident.location_accuracy}m`
                      : 'Not recorded'}
                  </p>
                </div>

                <div>
                  <span className="text-[11px] font-semibold text-slate-500 uppercase block">
                    PostGIS Geographic Coordinates
                  </span>
                  <p className="text-xs font-mono text-slate-900 mt-1">
                    {coordinates ? (
                      <span className="bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                        {coordinates.lat.toFixed(5)}°, {coordinates.lon.toFixed(5)}° (WGS84)
                      </span>
                    ) : (
                      <span className="text-slate-400 italic">No coordinates recorded</span>
                    )}
                  </p>
                </div>
              </div>

              {/* Customer Location Verification Link Control */}
              <div className="pt-3 border-t border-slate-100">
                <CustomerLocationLinkControl
                  incidentId={incident.id}
                  incidentStatus={incident.status}
                />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right Column: Immutable Operational Event Audit Trail */}
        <div className="space-y-4">
          <Card className="border-slate-200 shadow-xs">
            <CardHeader className="py-4 px-5 border-b border-slate-100">
              <CardTitle className="text-xs font-bold uppercase tracking-wider text-slate-800 flex items-center justify-between">
                <span>Operational Audit Trail</span>
                <span className="text-[10px] font-mono text-slate-400 font-normal">
                  ({operationalEvents.length} events)
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 text-xs">
              {operationalEvents.length === 0 ? (
                <div className="text-center py-8 text-slate-400 text-xs italic">
                  No operational audit events recorded for this incident.
                </div>
              ) : (
                <div className="relative border-l-2 border-slate-200 ml-2 pl-4 space-y-5">
                  {operationalEvents.map((evt) => (
                    <div key={evt.id} className="relative">
                      {/* Timeline Node Dot */}
                      <div className="absolute -left-[23px] top-1 h-3 w-3 rounded-full border-2 border-white bg-slate-700" />

                      <div className="space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono text-[11px] font-bold text-slate-900">
                            {evt.event_type}
                          </span>
                          <span className="text-[10px] font-mono text-slate-400">
                            {new Date(evt.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>

                        <div className="text-[11px] text-slate-500">
                          {new Date(evt.created_at).toLocaleDateString()}
                          {evt.actor && (
                            <span> • by <strong className="text-slate-700">{evt.actor.display_name}</strong> ({evt.actor.role})</span>
                          )}
                        </div>

                        {/* Metadata Details */}
                        {renderEventMetadata(evt.event_type, evt.metadata)}
                      </div>
                    </div>
                  ))}
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
 * Render specialized metadata box for operational audit events
 */
function renderEventMetadata(eventType: string, metadata: Record<string, unknown>) {
  if (!metadata || Object.keys(metadata).length === 0) return null;

  if (eventType === 'INCIDENT_STATUS_CHANGED') {
    const prev = metadata.previous_status as string;
    const next = metadata.new_status as string;
    const reason = metadata.reason as string | null;

    return (
      <div className="mt-1.5 p-2 rounded bg-slate-50 border border-slate-200 text-[11px] font-mono text-slate-700 space-y-1">
        <div className="flex items-center gap-1.5 font-semibold">
          <span className="text-slate-500">{prev}</span>
          <span>→</span>
          <span className="text-slate-900">{next}</span>
        </div>
        {reason && (
          <div className="text-[10px] text-slate-600 font-sans italic border-t border-slate-200 pt-1 mt-1">
            Reason: &quot;{reason}&quot;
          </div>
        )}
      </div>
    );
  }

  if (eventType === 'INCIDENT_CREATED') {
    return (
      <div className="mt-1.5 p-2 rounded bg-slate-50 border border-slate-200 text-[11px] font-mono text-slate-600 space-y-0.5">
        <div>Initial Status: <strong>{String(metadata.status || 'new')}</strong></div>
        <div>Service: {String(metadata.service_type || 'N/A')} ({String(metadata.priority || 'standard')})</div>
        {Boolean(metadata.has_coordinates) && <div>PostGIS Point: Recorded</div>}
      </div>
    );
  }

  return (
    <pre className="mt-1.5 p-2 rounded bg-slate-50 border border-slate-200 text-[10px] font-mono text-slate-600 overflow-x-auto">
      {JSON.stringify(metadata, null, 2)}
    </pre>
  );
}

/**
 * Parse coordinates from GeoJSON or PostGIS EWKB hex format safely
 */
function parseCoordinates(location: unknown): { lat: number; lon: number } | null {
  if (!location) return null;

  // Case 1: GeoJSON format { type: 'Point', coordinates: [lon, lat] }
  if (typeof location === 'object' && location !== null) {
    const loc = location as { type?: string; coordinates?: unknown };
    if (Array.isArray(loc.coordinates) && loc.coordinates.length >= 2) {
      const lon = Number(loc.coordinates[0]);
      const lat = Number(loc.coordinates[1]);
      if (Number.isFinite(lat) && Number.isFinite(lon)) {
        return { lat, lon };
      }
    }
  }

  // Case 2: PostGIS EWKB Hex format (little endian Point SRID 4326)
  if (typeof location === 'string') {
    try {
      const hex = location.trim();
      // Little endian 2D point SRID 4326: '0101000020E6100000' + 16 chars lon + 16 chars lat
      if (hex.length >= 50 && hex.toUpperCase().startsWith('0101000020')) {
        const lonHex = hex.substring(18, 34);
        const latHex = hex.substring(34, 50);
        const lon = Buffer.from(lonHex, 'hex').readDoubleLE(0);
        const lat = Buffer.from(latHex, 'hex').readDoubleLE(0);
        if (Number.isFinite(lat) && Number.isFinite(lon)) {
          return { lat, lon };
        }
      }
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * Visual badge for 10-state incident status
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
      className={`inline-flex items-center px-2.5 py-0.5 rounded text-xs font-semibold border font-mono ${current.className}`}
    >
      {current.label}
    </span>
  );
}

/**
 * Visual badge for incident priority
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
      className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium border uppercase tracking-wider font-mono ${
        styles[priority] || styles.standard
      }`}
    >
      {priority}
    </span>
  );
}
