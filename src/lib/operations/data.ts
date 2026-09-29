import { createClient } from '@/lib/supabase/server';
import { getCurrentUser } from '@/lib/auth/get-user';
import {
  OperationsSnapshot,
  OperationsSnapshotResult,
  OperationsIncident,
  OperationsVehicle,
  OperationsCapabilitySummary,
  IncidentStatus,
  IncidentPriority,
  ServiceType,
  LocationSource,
} from '@/types';

/**
 * Validates and normalizes raw snapshot JSONB data received from the
 * get_operations_map_snapshot RPC.
 * Fail-closed: returns null if the root structure or any required entity field
 * is invalid, missing, or malformed. Never fabricates operational values.
 */
function validateAndNormalizeSnapshot(raw: unknown): OperationsSnapshot | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }

  const record = raw as Record<string, unknown>;

  if (typeof record.generated_at !== 'string' || !record.generated_at) {
    return null;
  }

  if (!Array.isArray(record.incidents) || !Array.isArray(record.vehicles)) {
    return null;
  }

  const normalizedIncidents: OperationsIncident[] = [];
  for (const item of record.incidents) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return null;
    }
    const inc = item as Record<string, unknown>;

    // Fail-closed validation for required operational fields:
    // Never invent timestamps, names, phone numbers, addresses, status, priority, or service type
    if (
      typeof inc.id !== 'string' ||
      !inc.id ||
      typeof inc.reference_number !== 'string' ||
      !inc.reference_number ||
      typeof inc.status !== 'string' ||
      typeof inc.priority !== 'string' ||
      typeof inc.service_type !== 'string' ||
      typeof inc.customer_name !== 'string' ||
      typeof inc.customer_phone !== 'string' ||
      typeof inc.location_address !== 'string' ||
      typeof inc.created_at !== 'string' ||
      !inc.created_at ||
      typeof inc.updated_at !== 'string' ||
      !inc.updated_at
    ) {
      return null;
    }

    // Defensive coordinate validation: normalize invalid/out-of-bounds to null
    // If both coordinates are valid finite numbers within bounds, preserve them; otherwise both null
    let lat: number | null = null;
    let lng: number | null = null;
    if (
      typeof inc.latitude === 'number' &&
      typeof inc.longitude === 'number' &&
      Number.isFinite(inc.latitude) &&
      Number.isFinite(inc.longitude) &&
      inc.latitude >= -90 &&
      inc.latitude <= 90 &&
      inc.longitude >= -180 &&
      inc.longitude <= 180
    ) {
      lat = inc.latitude;
      lng = inc.longitude;
    }

    // Required capability summary normalization (nullable)
    let reqCap: OperationsCapabilitySummary | null = null;
    if (
      inc.required_capability &&
      typeof inc.required_capability === 'object' &&
      !Array.isArray(inc.required_capability)
    ) {
      const capObj = inc.required_capability as Record<string, unknown>;
      if (
        typeof capObj.id === 'string' &&
        typeof capObj.code === 'string' &&
        typeof capObj.name === 'string'
      ) {
        reqCap = {
          id: capObj.id,
          code: capObj.code,
          name: capObj.name,
        };
      }
    }

    normalizedIncidents.push({
      id: inc.id,
      reference_number: inc.reference_number,
      status: inc.status as IncidentStatus,
      priority: inc.priority as IncidentPriority,
      service_type: inc.service_type as ServiceType,
      customer_name: inc.customer_name,
      customer_phone: inc.customer_phone,
      location_address: inc.location_address,
      latitude: lat,
      longitude: lng,
      location_accuracy:
        typeof inc.location_accuracy === 'number' && Number.isFinite(inc.location_accuracy)
          ? inc.location_accuracy
          : null,
      location_source:
        typeof inc.location_source === 'string'
          ? (inc.location_source as LocationSource)
          : null,
      required_capability: reqCap,
      vehicle_registration:
        typeof inc.vehicle_registration === 'string' ? inc.vehicle_registration : null,
      vehicle_make: typeof inc.vehicle_make === 'string' ? inc.vehicle_make : null,
      vehicle_model: typeof inc.vehicle_model === 'string' ? inc.vehicle_model : null,
      vehicle_year:
        typeof inc.vehicle_year === 'number' && Number.isFinite(inc.vehicle_year)
          ? inc.vehicle_year
          : null,
      vehicle_color: typeof inc.vehicle_color === 'string' ? inc.vehicle_color : null,
      notes: typeof inc.notes === 'string' ? inc.notes : null,
      created_at: inc.created_at,
      updated_at: inc.updated_at,
    });
  }

  const normalizedVehicles: OperationsVehicle[] = [];
  for (const item of record.vehicles) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return null;
    }
    const veh = item as Record<string, unknown>;

    // Fail-closed validation for required vehicle fields
    if (
      typeof veh.id !== 'string' ||
      !veh.id ||
      typeof veh.callsign !== 'string' ||
      !veh.callsign ||
      typeof veh.is_active !== 'boolean'
    ) {
      return null;
    }

    // Defensive coordinate validation: normalize invalid/out-of-bounds to null
    let lat: number | null = null;
    let lng: number | null = null;
    if (
      typeof veh.latitude === 'number' &&
      typeof veh.longitude === 'number' &&
      Number.isFinite(veh.latitude) &&
      Number.isFinite(veh.longitude) &&
      veh.latitude >= -90 &&
      veh.latitude <= 90 &&
      veh.longitude >= -180 &&
      veh.longitude <= 180
    ) {
      lat = veh.latitude;
      lng = veh.longitude;
    }

    const caps: OperationsCapabilitySummary[] = [];
    if (Array.isArray(veh.capabilities)) {
      for (const capItem of veh.capabilities) {
        if (
          capItem &&
          typeof capItem === 'object' &&
          !Array.isArray(capItem)
        ) {
          const capObj = capItem as Record<string, unknown>;
          if (
            typeof capObj.id === 'string' &&
            typeof capObj.code === 'string' &&
            typeof capObj.name === 'string'
          ) {
            caps.push({
              id: capObj.id,
              code: capObj.code,
              name: capObj.name,
            });
          }
        }
      }
    }

    normalizedVehicles.push({
      id: veh.id,
      callsign: veh.callsign,
      registration_number:
        typeof veh.registration_number === 'string' ? veh.registration_number : null,
      is_active: veh.is_active,
      latitude: lat,
      longitude: lng,
      location_updated_at:
        typeof veh.location_updated_at === 'string' ? veh.location_updated_at : null,
      capabilities: caps,
    });
  }

  return {
    generated_at: record.generated_at,
    incidents: normalizedIncidents,
    vehicles: normalizedVehicles,
  };
}

/**
 * Authoritative application-layer operational snapshot loader.
 * Validates session, confirms operator/admin role, calls get_operations_map_snapshot RPC,
 * defensibly validates payload, and returns typed OperationsSnapshotResult.
 * Never exposes raw Postgres/Supabase error messages to callers.
 */
export async function getOperationsSnapshot(): Promise<OperationsSnapshotResult> {
  const authContext = await getCurrentUser();

  if (!authContext || !authContext.profile || !authContext.profile.is_active) {
    return {
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Authentication required to access operational data.',
      },
    };
  }

  const role = authContext.profile.role;
  if (role !== 'admin' && role !== 'operator') {
    return {
      success: false,
      error: {
        code: 'FORBIDDEN',
        message: 'Unauthorized: insufficient privileges to access operational data.',
      },
    };
  }

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc('get_operations_map_snapshot');

    if (error) {
      console.error('Database error loading operations map snapshot:', error);
      return {
        success: false,
        error: {
          code: 'SNAPSHOT_UNAVAILABLE',
          message: 'Operational data could not be loaded.',
        },
      };
    }

    const snapshot = validateAndNormalizeSnapshot(data);
    if (!snapshot) {
      console.error('Invalid operations snapshot structure returned from RPC:', data);
      return {
        success: false,
        error: {
          code: 'INVALID_SNAPSHOT',
          message: 'Operational data payload is invalid or corrupted.',
        },
      };
    }

    return {
      success: true,
      snapshot,
    };
  } catch (err) {
    console.error('Unexpected error loading operations map snapshot:', err);
    return {
      success: false,
      error: {
        code: 'SNAPSHOT_UNAVAILABLE',
        message: 'Operational data could not be loaded.',
      },
    };
  }
}
