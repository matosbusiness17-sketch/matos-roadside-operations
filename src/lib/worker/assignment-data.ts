import { createClient } from '@/lib/supabase/server';
import { getCurrentUser } from '@/lib/auth/get-user';
import {
  WorkerActiveAssignment,
  IncidentStatus,
  ServiceType,
  IncidentPriority,
} from '@/types';

const VALID_ACTIVE_ASSIGNMENT_STATUSES = [
  'assigned',
  'accepted',
  'en_route',
  'on_scene',
] as const;

const VALID_INCIDENT_STATUSES: IncidentStatus[] = [
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
];

const VALID_SERVICE_TYPES: ServiceType[] = [
  'towing',
  'jump_start',
  'lockout',
  'tire_change',
  'fuel_delivery',
  'winch_recovery',
  'general_assistance',
];

const VALID_PRIORITIES: IncidentPriority[] = [
  'low',
  'standard',
  'high',
  'critical',
];

/**
 * Authoritative locked whitelist of valid active assignment and incident lifecycle pairs.
 * Any other combination fails closed immediately.
 */
const VALID_ACTIVE_LIFECYCLE_PAIRS = new Set([
  'assigned|dispatched',
  'accepted|dispatched',
  'en_route|en_route',
  'on_scene|on_scene',
  'on_scene|in_progress',
]);

/**
 * Validates that a string is a non-empty, finite ISO timestamp.
 */
function validateRequiredTimestamp(val: unknown): string | null {
  if (typeof val !== 'string' || !val) {
    return null;
  }
  const parsed = Date.parse(val);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return val;
}

/**
 * Validates and normalizes raw assignment record from database query into WorkerActiveAssignment.
 * Fail-closed: returns null on missing required keys, malformed types, invalid status enums,
 * or inconsistent active lifecycle status pairs.
 * Never fabricates dates, phone numbers, customer names, or operational values.
 */
export function validateAndNormalizeWorkerAssignment(
  raw: unknown
): WorkerActiveAssignment | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }

  const record = raw as Record<string, unknown>;

  // Required assignment-level properties — missing properties must fail rather than normalizing to null
  const requiredAssignmentKeys = [
    'id',
    'status',
    'assigned_at',
    'vehicle_id',
    'vehicle',
    'incident',
  ];
  for (const key of requiredAssignmentKeys) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) {
      return null;
    }
  }

  if (typeof record.id !== 'string' || !record.id) {
    return null;
  }

  if (
    typeof record.status !== 'string' ||
    !VALID_ACTIVE_ASSIGNMENT_STATUSES.includes(
      record.status as (typeof VALID_ACTIVE_ASSIGNMENT_STATUSES)[number]
    )
  ) {
    return null;
  }

  const validAssignedAt = validateRequiredTimestamp(record.assigned_at);
  if (!validAssignedAt) {
    return null;
  }

  // Vehicle relationship rules
  let vehicle_id: string | null = null;
  let callsign: string | null = null;
  let registration_number: string | null = null;

  if (record.vehicle_id === null) {
    // If vehicle_id is null, vehicle relation MUST be null
    if (record.vehicle !== null) {
      return null;
    }
    vehicle_id = null;
    callsign = null;
    registration_number = null;
  } else {
    // If vehicle_id is non-null, vehicle MUST be an object with matching id
    if (typeof record.vehicle_id !== 'string' || !record.vehicle_id) {
      return null;
    }
    if (!record.vehicle || typeof record.vehicle !== 'object' || Array.isArray(record.vehicle)) {
      return null;
    }

    const veh = record.vehicle as Record<string, unknown>;
    if (!Object.prototype.hasOwnProperty.call(veh, 'id') || veh.id !== record.vehicle_id) {
      return null;
    }
    if (!Object.prototype.hasOwnProperty.call(veh, 'callsign') || typeof veh.callsign !== 'string' || !veh.callsign) {
      return null;
    }
    if (!Object.prototype.hasOwnProperty.call(veh, 'registration_number')) {
      return null;
    }
    if (veh.registration_number !== null && typeof veh.registration_number !== 'string') {
      return null;
    }

    vehicle_id = record.vehicle_id;
    callsign = veh.callsign;
    registration_number = veh.registration_number;
  }

  // Incident validation
  if (!record.incident || typeof record.incident !== 'object' || Array.isArray(record.incident)) {
    return null;
  }

  const inc = record.incident as Record<string, unknown>;
  const requiredIncidentKeys = [
    'id',
    'reference_number',
    'status',
    'service_type',
    'priority',
    'customer_name',
    'customer_phone',
    'location_address',
    'required_capability',
  ];
  for (const key of requiredIncidentKeys) {
    if (!Object.prototype.hasOwnProperty.call(inc, key)) {
      return null;
    }
  }

  if (typeof inc.id !== 'string' || !inc.id) {
    return null;
  }
  if (typeof inc.reference_number !== 'string' || !inc.reference_number) {
    return null;
  }
  if (
    typeof inc.status !== 'string' ||
    !VALID_INCIDENT_STATUSES.includes(inc.status as IncidentStatus)
  ) {
    return null;
  }
  if (
    typeof inc.service_type !== 'string' ||
    !VALID_SERVICE_TYPES.includes(inc.service_type as ServiceType)
  ) {
    return null;
  }
  if (
    typeof inc.priority !== 'string' ||
    !VALID_PRIORITIES.includes(inc.priority as IncidentPriority)
  ) {
    return null;
  }

  // Authoritative active lifecycle status pair consistency check
  const lifecyclePair = `${record.status}|${inc.status}`;
  if (!VALID_ACTIVE_LIFECYCLE_PAIRS.has(lifecyclePair)) {
    return null;
  }

  // Strictly nullable customer & location fields (property MUST exist; wrong type fails closed)
  if (inc.customer_name !== null && typeof inc.customer_name !== 'string') {
    return null;
  }
  const customer_name = inc.customer_name;

  if (inc.customer_phone !== null && typeof inc.customer_phone !== 'string') {
    return null;
  }
  const customer_phone = inc.customer_phone;

  if (inc.location_address !== null && typeof inc.location_address !== 'string') {
    return null;
  }
  const location_address = inc.location_address;

  // required_capability: property must exist, may be null, otherwise validate id/code/name strictly
  let required_capability: { id: string; code: string; name: string } | null = null;
  if (inc.required_capability !== null) {
    if (typeof inc.required_capability !== 'object' || Array.isArray(inc.required_capability)) {
      return null;
    }
    const cap = inc.required_capability as Record<string, unknown>;
    if (
      !Object.prototype.hasOwnProperty.call(cap, 'id') ||
      typeof cap.id !== 'string' ||
      !cap.id ||
      !Object.prototype.hasOwnProperty.call(cap, 'code') ||
      typeof cap.code !== 'string' ||
      !cap.code ||
      !Object.prototype.hasOwnProperty.call(cap, 'name') ||
      typeof cap.name !== 'string' ||
      !cap.name
    ) {
      return null;
    }
    required_capability = {
      id: cap.id,
      code: cap.code,
      name: cap.name,
    };
  }

  return {
    assignment_id: record.id,
    status: record.status as (typeof VALID_ACTIVE_ASSIGNMENT_STATUSES)[number],
    assigned_at: validAssignedAt,
    vehicle_id,
    callsign,
    registration_number,
    incident_id: inc.id,
    reference_number: inc.reference_number,
    incident_status: inc.status as IncidentStatus,
    service_type: inc.service_type as ServiceType,
    priority: inc.priority as IncidentPriority,
    customer_name,
    customer_phone,
    location_address,
    required_capability,
  };
}

/**
 * Loads the single active assignment for the current authenticated worker.
 * Returns:
 * - WorkerActiveAssignment: if worker has exactly one active assignment
 * - null: if worker has no active assignment or session is unauthorized
 * Fails closed without throwing raw database errors.
 */
export async function getCurrentWorkerAssignment(): Promise<WorkerActiveAssignment | null> {
  try {
    const user = await getCurrentUser();
    if (!user || user.profile.role !== 'worker') {
      return null;
    }

    const supabase = await createClient();

    // 1. Resolve worker_profile for authenticated user
    const { data: workerProfile, error: wpErr } = await supabase
      .from('worker_profiles')
      .select('id, organization_id')
      .eq('user_id', user.profile.id)
      .eq('organization_id', user.profile.organization_id)
      .maybeSingle();

    if (wpErr || !workerProfile) {
      return null;
    }

    // 2. Query active assignment strictly within organization and for this worker
    const { data: assignments, error: aErr } = await supabase
      .from('assignments')
      .select(`
        id,
        status,
        assigned_at,
        vehicle_id,
        vehicle:vehicles (
          id,
          callsign,
          registration_number
        ),
        incident:incidents (
          id,
          reference_number,
          status,
          service_type,
          priority,
          customer_name,
          customer_phone,
          location_address,
          required_capability:service_capabilities (
            id,
            code,
            name
          )
        )
      `)
      .eq('organization_id', user.profile.organization_id)
      .eq('worker_id', workerProfile.id)
      .in('status', ['assigned', 'accepted', 'en_route', 'on_scene']);

    if (aErr || !assignments || assignments.length === 0) {
      return null;
    }

    // Phase 6 uniqueness guarantees at most 1 active assignment per worker.
    // If an abnormal duplicate count is observed, fail closed to null.
    if (assignments.length > 1) {
      return null;
    }

    return validateAndNormalizeWorkerAssignment(assignments[0]);
  } catch (err) {
    console.error('Error in getCurrentWorkerAssignment:', err);
    return null;
  }
}
