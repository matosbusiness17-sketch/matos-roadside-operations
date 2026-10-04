import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getCurrentUser } from '@/lib/auth/get-user';
import { getOperationsSnapshot } from '@/lib/operations/data';
import { OperationsVehicle } from '@/types';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  formatAvailability,
  formatDateTime,
} from '@/lib/formatters';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Fleet & Response Units | Matos Systems Roadside',
  description: 'Live operational registry of response units, capabilities and availability.',
};

interface FleetVehicleRow {
  id: string;
  callsign: string;
  registrationNumber: string;
  isActive: boolean;
  latitude: number | null;
  longitude: number | null;
  locationUpdatedAt: string | null;
  capabilities: Array<{ id: string; code: string; name: string }>;
  assignedWorkerName: string | null;
  workerAvailability: string | null;
}

export default async function FleetPage() {
  const authContext = await getCurrentUser();

  if (!authContext || !authContext.profile || !authContext.profile.is_active) {
    redirect('/login?redirectTo=/fleet');
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

  let fleetRows: FleetVehicleRow[] = [];
  let queryError: string | null = null;
  let assignmentsFailed = false;
  let snapshotFailed = false;
  let assignedCount: number | null = null;
  let locatedUnits: number | null = null;

  try {
    const supabase = await createClient();

    // Query in parallel:
    // 1. Authoritative operational snapshot (provides PostGIS coordinates & capabilities)
    // 2. Organization vehicles table (provides full fleet roster including active/inactive status)
    // 3. Active worker-vehicle assignments
    // 4. Worker profiles & user display names
    const [snapshotRes, vehiclesRes, assignmentsRes, workerProfilesRes, profilesRes] =
      await Promise.all([
        getOperationsSnapshot(),
        supabase
          .from('vehicles')
          .select('id, callsign, registration_number, is_active, location_updated_at')
          .eq('organization_id', authContext.organization.id)
          .order('callsign', { ascending: true }),
        supabase
          .from('worker_vehicle_assignments')
          .select('id, vehicle_id, worker_id, status')
          .eq('organization_id', authContext.organization.id)
          .eq('status', 'active'),
        supabase
          .from('worker_profiles')
          .select('id, user_id, availability_status')
          .eq('organization_id', authContext.organization.id),
        supabase
          .from('profiles')
          .select('id, display_name')
          .eq('organization_id', authContext.organization.id),
      ]);

    // A. Vehicle registry failure: fail closed for the full fleet registry
    if (vehiclesRes.error) {
      console.error('Failed to load fleet vehicles registry:', vehiclesRes.error);
      queryError = 'Unable to load fleet registry records. Please try again.';
    } else {
      const allVehicles = vehiclesRes.data || [];

      // C. Operations snapshot failure detection
      if (!snapshotRes.success) {
        console.error('Failed to load operational snapshot for fleet:', snapshotRes.error);
        snapshotFailed = true;
      }

      // B. Assignment / Worker lookup failure detection
      if (assignmentsRes.error) {
        console.error('Failed to load worker vehicle assignments:', assignmentsRes.error);
        assignmentsFailed = true;
      }
      if (workerProfilesRes.error) {
        console.error('Failed to load worker profiles:', workerProfilesRes.error);
        assignmentsFailed = true;
      }
      if (profilesRes.error) {
        console.error('Failed to load user profiles for fleet:', profilesRes.error);
        assignmentsFailed = true;
      }

      // Process assignments if assignments query loaded
      const vehicleAssignmentMap = new Map<
        string,
        { assignedWorkerName: string; workerAvailability: string | null }
      >();

      if (!assignmentsRes.error && assignmentsRes.data) {
        const assignments = assignmentsRes.data;

        // If worker profile lookup failed, summary metric should reflect unavailable
        if (assignmentsFailed) {
          assignedCount = null;
        } else {
          assignedCount = assignments.length;
        }

        const workerProfiles = workerProfilesRes.data || [];
        const profiles = profilesRes.data || [];

        const profileNameMap = new Map<string, string>();
        for (const p of profiles) {
          if (p.display_name) {
            profileNameMap.set(p.id, p.display_name);
          }
        }

        const workerInfoMap = new Map<
          string,
          { name: string | null; availability: string | null }
        >();
        for (const wp of workerProfiles) {
          const name = profileNameMap.get(wp.user_id) || null;
          workerInfoMap.set(wp.id, {
            name,
            availability: wp.availability_status ?? null,
          });
        }

        for (const asgn of assignments) {
          const worker = workerInfoMap.get(asgn.worker_id);
          if (worker && worker.name) {
            vehicleAssignmentMap.set(asgn.vehicle_id, {
              assignedWorkerName: worker.name,
              workerAvailability: worker.availability,
            });
          } else {
            // Assignment exists, but worker record or profile cannot be resolved
            vehicleAssignmentMap.set(asgn.vehicle_id, {
              assignedWorkerName: 'Assignment details unavailable',
              workerAvailability: null,
            });
          }
        }
      }

      // Snapshot vehicles map for coordinates and capabilities
      const snapshotMap = new Map<string, OperationsVehicle>();
      if (snapshotRes.success) {
        for (const v of snapshotRes.snapshot.vehicles) {
          snapshotMap.set(v.id, v);
        }
      }

      fleetRows = allVehicles.map((veh) => {
        const snap = snapshotMap.get(veh.id);

        let assignedWorkerName: string | null = null;
        let workerAvailability: string | null = null;

        if (assignmentsRes.error) {
          // Assignment source failed completely: state is unavailable for all units
          assignedWorkerName = 'Assignment details unavailable';
          workerAvailability = null;
        } else {
          const asgn = vehicleAssignmentMap.get(veh.id);
          if (asgn) {
            assignedWorkerName = asgn.assignedWorkerName;
            workerAvailability = asgn.workerAvailability;
          } else {
            // Genuinely no active assignment for this vehicle
            assignedWorkerName = null;
            workerAvailability = null;
          }
        }

        return {
          id: veh.id,
          callsign: veh.callsign,
          registrationNumber: veh.registration_number || 'Not recorded',
          isActive: veh.is_active,
          latitude: snap ? snap.latitude : null,
          longitude: snap ? snap.longitude : null,
          locationUpdatedAt: veh.location_updated_at || (snap ? snap.location_updated_at : null),
          capabilities: snap ? snap.capabilities : [],
          assignedWorkerName,
          workerAvailability,
        };
      });

      if (!snapshotFailed) {
        locatedUnits = fleetRows.filter(
          (r) => r.latitude !== null && r.longitude !== null
        ).length;
      }
    }
  } catch (err) {
    console.error('Exception loading fleet data:', err);
    queryError = 'Unable to load fleet registry records. Please try again.';
  }

  const totalUnits = fleetRows.length;
  const activeUnits = fleetRows.filter((r) => r.isActive).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              Fleet &amp; Response Units
            </h1>
            <Badge variant="outline" className="font-mono text-xs">
              {authContext.organization.name}
            </Badge>
          </div>
          <p className="text-sm text-slate-600 mt-1">
            Live operational registry of response units, capabilities and availability.
          </p>
        </div>
        <div>
          <Link
            href="/operations"
            className="inline-flex items-center text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 px-3 py-1.5 rounded-md shadow-2xs transition-colors"
          >
            ← View on Operations Map
          </Link>
        </div>
      </div>

      {/* Partial Data Notice (if applicable and vehicles query succeeded) */}
      {!queryError && (snapshotFailed || assignmentsFailed) && (
        <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-2.5 text-xs text-slate-600 flex items-center gap-2">
          <span className="font-semibold text-slate-700">Notice:</span>
          <span>
            {snapshotFailed && assignmentsFailed
              ? 'Operational telemetry and worker assignment details are currently unavailable.'
              : snapshotFailed
              ? 'Operational GPS telemetry and capability data are currently unavailable.'
              : 'Worker assignment records are currently unavailable.'}
          </span>
        </div>
      )}

      {/* Summary Metrics Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="border-slate-200 bg-white">
          <CardContent className="p-4">
            <div className="text-xs font-medium text-slate-500 uppercase tracking-wider">
              Total Units
            </div>
            <div className="text-2xl font-bold font-mono text-slate-900 mt-1">
              {queryError ? '—' : totalUnits}
            </div>
            <div className="text-[11px] text-slate-400 mt-1">
              Registered fleet vehicles
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-200 bg-white">
          <CardContent className="p-4">
            <div className="text-xs font-medium text-slate-500 uppercase tracking-wider">
              Active Units
            </div>
            <div className="text-2xl font-bold font-mono text-emerald-600 mt-1">
              {queryError ? '—' : activeUnits}
            </div>
            <div className="text-[11px] text-slate-400 mt-1">
              In-service operational status
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-200 bg-white">
          <CardContent className="p-4">
            <div className="text-xs font-medium text-slate-500 uppercase tracking-wider">
              Located Units
            </div>
            <div className="text-2xl font-bold font-mono text-sky-600 mt-1">
              {queryError || snapshotFailed || locatedUnits === null ? '—' : locatedUnits}
            </div>
            <div className="text-[11px] text-slate-400 mt-1">
              Active GPS coordinates
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-200 bg-white">
          <CardContent className="p-4">
            <div className="text-xs font-medium text-slate-500 uppercase tracking-wider">
              Assigned Units
            </div>
            <div className="text-2xl font-bold font-mono text-purple-600 mt-1">
              {queryError || assignmentsFailed || assignedCount === null ? '—' : assignedCount}
            </div>
            <div className="text-[11px] text-slate-400 mt-1">
              Active worker shift bindings
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Fleet Registry Table */}
      <Card className="border-slate-200 bg-white shadow-xs">
        <CardHeader className="py-4 px-5 border-b border-slate-100">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-sm font-bold uppercase tracking-wider text-slate-800">
                Operational Fleet Registry
              </CardTitle>
              <CardDescription className="text-xs text-slate-500 mt-0.5">
                Vehicles configured with roadside capabilities, worker assignments, and GPS state.
              </CardDescription>
            </div>
            <span className="text-xs font-mono text-slate-400">
              {queryError ? '—' : `${totalUnits} units`}
            </span>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {queryError ? (
            <div className="p-8 text-center">
              <p className="text-xs font-semibold text-rose-600 mb-1">
                Failed to load fleet registry
              </p>
              <p className="text-xs text-slate-500 max-w-sm mx-auto">
                {queryError}
              </p>
            </div>
          ) : fleetRows.length === 0 ? (
            <div className="p-12 text-center space-y-2">
              <div className="mx-auto w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 font-bold text-lg">
                Ø
              </div>
              <h4 className="text-sm font-semibold text-slate-900">
                No fleet units registered
              </h4>
              <p className="text-xs text-slate-500 max-w-sm mx-auto">
                There are currently no response vehicles registered for this organization.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-slate-600 border-collapse">
                <thead className="bg-slate-50 text-[11px] font-semibold text-slate-500 uppercase tracking-wider border-b border-slate-200">
                  <tr>
                    <th scope="col" className="py-3 px-4">Callsign</th>
                    <th scope="col" className="py-3 px-4">Registration</th>
                    <th scope="col" className="py-3 px-4">Status</th>
                    <th scope="col" className="py-3 px-4">Assigned Worker</th>
                    <th scope="col" className="py-3 px-4">Worker Availability</th>
                    <th scope="col" className="py-3 px-4">Capabilities</th>
                    <th scope="col" className="py-3 px-4">Location State</th>
                    <th scope="col" className="py-3 px-4">Last GPS Update</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {fleetRows.map((veh) => (
                    <tr
                      key={veh.id}
                      className="hover:bg-slate-50/80 transition-colors"
                    >
                      {/* Callsign */}
                      <td className="py-3 px-4 font-mono font-bold text-slate-900 whitespace-nowrap">
                        {veh.callsign}
                      </td>

                      {/* Registration */}
                      <td className="py-3 px-4 font-mono text-slate-700 whitespace-nowrap">
                        {veh.registrationNumber !== 'Not recorded' ? (
                          <span className="bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200 font-semibold">
                            {veh.registrationNumber}
                          </span>
                        ) : (
                          <span className="text-slate-400 italic">Not recorded</span>
                        )}
                      </td>

                      {/* Operational Status */}
                      <td className="py-3 px-4 whitespace-nowrap">
                        {veh.isActive ? (
                          <Badge variant="success" className="font-mono text-xs">
                            Active
                          </Badge>
                        ) : (
                          <Badge variant="default" className="font-mono text-xs bg-slate-100 text-slate-500 border-slate-300">
                            Inactive
                          </Badge>
                        )}
                      </td>

                      {/* Assigned Worker */}
                      <td className="py-3 px-4 whitespace-nowrap">
                        {veh.assignedWorkerName === 'Assignment details unavailable' ? (
                          <span className="text-slate-500 italic">
                            Assignment details unavailable
                          </span>
                        ) : veh.assignedWorkerName ? (
                          <span className="font-semibold text-slate-900">
                            {veh.assignedWorkerName}
                          </span>
                        ) : (
                          <span className="text-slate-400 italic">Not assigned</span>
                        )}
                      </td>

                      {/* Worker Availability */}
                      <td className="py-3 px-4 whitespace-nowrap">
                        {veh.assignedWorkerName === null ? (
                          <span className="text-slate-400">—</span>
                        ) : veh.workerAvailability ? (
                          <AvailabilityBadge status={veh.workerAvailability} />
                        ) : (
                          <span className="text-slate-400 italic">Not recorded</span>
                        )}
                      </td>

                      {/* Capabilities */}
                      <td className="py-3 px-4 max-w-[240px]">
                        {snapshotFailed ? (
                          <span className="text-slate-400 italic">Data unavailable</span>
                        ) : veh.capabilities.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {veh.capabilities.map((cap) => (
                              <span
                                key={cap.id}
                                className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-700 border border-slate-200"
                              >
                                {cap.name}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-slate-400 italic">None recorded</span>
                        )}
                      </td>

                      {/* Location State */}
                      <td className="py-3 px-4 whitespace-nowrap font-mono text-[11px]">
                        {snapshotFailed ? (
                          <span className="text-slate-400 italic">Data unavailable</span>
                        ) : veh.latitude !== null && veh.longitude !== null ? (
                          <span
                            className="text-sky-700 bg-sky-50 px-2 py-0.5 rounded border border-sky-200 font-medium"
                            title={`Lat: ${veh.latitude}, Lng: ${veh.longitude}`}
                          >
                            {veh.latitude.toFixed(4)}°, {veh.longitude.toFixed(4)}°
                          </span>
                        ) : (
                          <span className="text-slate-400 italic">Location unavailable</span>
                        )}
                      </td>

                      {/* Last GPS Update */}
                      <td className="py-3 px-4 whitespace-nowrap font-mono text-[11px] text-slate-500">
                        {veh.locationUpdatedAt ? (
                          formatDateTime(veh.locationUpdatedAt)
                        ) : (
                          <span className="text-slate-400 italic">Not recorded</span>
                        )}
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
  );
}

/**
 * Visual badge for worker availability status
 */
function AvailabilityBadge({ status }: { status: string }) {
  if (status === 'available') {
    return (
      <Badge variant="success" className="font-mono text-xs">
        {formatAvailability(status)}
      </Badge>
    );
  }

  if (status === 'busy') {
    return (
      <Badge variant="warning" className="font-mono text-xs font-semibold">
        {formatAvailability(status)}
      </Badge>
    );
  }

  if (status === 'unavailable') {
    return (
      <Badge variant="destructive" className="font-mono text-xs">
        {formatAvailability(status)}
      </Badge>
    );
  }

  return (
    <Badge variant="default" className="font-mono text-xs text-slate-600 bg-slate-100 border-slate-200">
      {formatAvailability(status)}
    </Badge>
  );
}
