import { createClient } from '@/lib/supabase/server';
import { getCurrentUser } from '@/lib/auth/get-user';
import {
  DispatchContext,
  DispatchCandidatesResult,
  DispatchMutationResult,
  DispatchRankedCandidate,
  DispatchUnrankedCandidate,
  DispatchCurrentAssignment,
  DispatchState,
  DispatchSuccessPayload,
  ReassignSuccessPayload,
  AssignmentStatus,
  IncidentStatus,
} from '@/types';

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

const VALID_ASSIGNMENT_STATUSES: AssignmentStatus[] = [
  'assigned',
  'accepted',
  'en_route',
  'on_scene',
  'completed',
  'cancelled',
];

const VALID_DISPATCH_STATES: DispatchState[] = [
  'initial_dispatch',
  'reassignment',
  'assigned_locked',
  'unavailable',
];

/**
 * Validates that a string is a non-empty, finite ISO timestamp.
 * Returns the validated string, or null if invalid.
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
 * Validates a strictly nullable string field on an object.
 * Returns:
 * - string: if present and typeof string
 * - null: if present and value is null
 * - undefined: if missing OR wrong non-null type (fails closed)
 */
function validateNullableString(
  obj: Record<string, unknown>,
  key: string
): string | null | undefined {
  if (!Object.prototype.hasOwnProperty.call(obj, key)) {
    return undefined; // missing required contract key
  }
  const val = obj[key];
  if (val === null) {
    return null;
  }
  if (typeof val === 'string') {
    return val;
  }
  return undefined; // wrong type (e.g. number, boolean, object) -> fail closed
}

/**
 * Validates a strictly nullable timestamp field on an object.
 * Returns:
 * - string: if present, typeof string, and finite timestamp
 * - null: if present and value is null
 * - undefined: if missing, wrong type, or invalid timestamp (fails closed)
 */
function validateNullableTimestamp(
  obj: Record<string, unknown>,
  key: string
): string | null | undefined {
  if (!Object.prototype.hasOwnProperty.call(obj, key)) {
    return undefined; // missing required contract key
  }
  const val = obj[key];
  if (val === null) {
    return null;
  }
  if (typeof val === 'string' && val.length > 0) {
    const parsed = Date.parse(val);
    if (Number.isFinite(parsed)) {
      return val;
    }
  }
  return undefined; // wrong type or non-finite timestamp -> fail closed
}

/**
 * Validates and normalizes raw dispatch candidates JSONB payload from get_dispatch_candidates RPC.
 * Fail-closed: returns null if required structure or any entity field is missing or malformed.
 * Never fabricates dates, distances, names, or operational values.
 */
export function validateAndNormalizeDispatchContext(raw: unknown): DispatchContext | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }

  const record = raw as Record<string, unknown>;

  // Required root properties presence check
  const requiredRootKeys = [
    'generated_at',
    'dispatch_state',
    'ranking_available',
    'incident',
    'current_assignment',
    'ranked_candidates',
    'unranked_candidates',
  ];
  for (const key of requiredRootKeys) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) {
      return null;
    }
  }

  const validGeneratedAt = validateRequiredTimestamp(record.generated_at);
  if (!validGeneratedAt) {
    return null;
  }

  if (
    typeof record.dispatch_state !== 'string' ||
    !VALID_DISPATCH_STATES.includes(record.dispatch_state as DispatchState)
  ) {
    return null;
  }
  const dispatch_state = record.dispatch_state as DispatchState;

  if (typeof record.ranking_available !== 'boolean') {
    return null;
  }

  // Validate incident object
  if (!record.incident || typeof record.incident !== 'object' || Array.isArray(record.incident)) {
    return null;
  }

  const inc = record.incident as Record<string, unknown>;
  const requiredIncidentKeys = [
    'id',
    'reference_number',
    'status',
    'has_location',
    'required_capability',
  ];
  for (const key of requiredIncidentKeys) {
    if (!Object.prototype.hasOwnProperty.call(inc, key)) {
      return null;
    }
  }

  if (
    typeof inc.id !== 'string' ||
    !inc.id ||
    typeof inc.reference_number !== 'string' ||
    !inc.reference_number ||
    typeof inc.status !== 'string' ||
    !VALID_INCIDENT_STATUSES.includes(inc.status as IncidentStatus) ||
    typeof inc.has_location !== 'boolean'
  ) {
    return null;
  }

  let required_capability: { id: string; code: string; name: string } | null = null;
  if (inc.required_capability !== null) {
    if (typeof inc.required_capability !== 'object' || Array.isArray(inc.required_capability)) {
      return null;
    }
    const capObj = inc.required_capability as Record<string, unknown>;
    if (
      typeof capObj.id !== 'string' ||
      !capObj.id ||
      typeof capObj.code !== 'string' ||
      !capObj.code ||
      typeof capObj.name !== 'string' ||
      !capObj.name
    ) {
      return null;
    }
    required_capability = {
      id: capObj.id,
      code: capObj.code,
      name: capObj.name,
    };
  }

  // Validate current_assignment object (strictly nullable contract key)
  let current_assignment: DispatchCurrentAssignment | null = null;
  if (record.current_assignment !== null) {
    if (typeof record.current_assignment !== 'object' || Array.isArray(record.current_assignment)) {
      return null;
    }
    const curr = record.current_assignment as Record<string, unknown>;
    const requiredAssignmentKeys = [
      'id',
      'status',
      'worker_id',
      'worker_name',
      'vehicle_id',
      'callsign',
      'registration_number',
      'assigned_at',
    ];
    for (const key of requiredAssignmentKeys) {
      if (!Object.prototype.hasOwnProperty.call(curr, key)) {
        return null;
      }
    }

    if (
      typeof curr.id !== 'string' ||
      !curr.id ||
      typeof curr.status !== 'string' ||
      !VALID_ASSIGNMENT_STATUSES.includes(curr.status as AssignmentStatus) ||
      typeof curr.worker_id !== 'string' ||
      !curr.worker_id ||
      typeof curr.worker_name !== 'string' ||
      !curr.worker_name ||
      typeof curr.vehicle_id !== 'string' ||
      !curr.vehicle_id ||
      typeof curr.callsign !== 'string' ||
      !curr.callsign
    ) {
      return null;
    }

    const regNum = validateNullableString(curr, 'registration_number');
    if (regNum === undefined) {
      return null; // Malformed non-null registration_number -> fail closed
    }

    const validAssignedAt = validateRequiredTimestamp(curr.assigned_at);
    if (!validAssignedAt) {
      return null; // Malformed timestamp -> fail closed
    }

    current_assignment = {
      id: curr.id,
      status: curr.status as AssignmentStatus,
      worker_id: curr.worker_id,
      worker_name: curr.worker_name,
      vehicle_id: curr.vehicle_id,
      callsign: curr.callsign,
      registration_number: regNum,
      assigned_at: validAssignedAt,
    };
  }

  // Lifecycle consistency invariants
  if (dispatch_state === 'initial_dispatch') {
    if (inc.status !== 'ready_for_dispatch' || current_assignment !== null) {
      return null;
    }
  } else if (dispatch_state === 'reassignment') {
    if (
      inc.status !== 'dispatched' ||
      current_assignment === null ||
      current_assignment.status !== 'assigned'
    ) {
      return null;
    }
  } else if (dispatch_state === 'assigned_locked') {
    if (
      inc.status !== 'dispatched' ||
      current_assignment === null ||
      (current_assignment.status !== 'accepted' &&
        current_assignment.status !== 'en_route' &&
        current_assignment.status !== 'on_scene')
    ) {
      return null;
    }
  }

  // Validate ranked_candidates array
  if (!Array.isArray(record.ranked_candidates)) {
    return null;
  }

  const ranked_candidates: DispatchRankedCandidate[] = [];
  for (const item of record.ranked_candidates) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return null;
    }
    const c = item as Record<string, unknown>;
    const requiredCandidateKeys = [
      'worker_id',
      'worker_name',
      'vehicle_id',
      'callsign',
      'registration_number',
      'distance_meters',
      'vehicle_location_updated_at',
      'required_capability_matched',
    ];
    for (const key of requiredCandidateKeys) {
      if (!Object.prototype.hasOwnProperty.call(c, key)) {
        return null;
      }
    }

    if (
      typeof c.worker_id !== 'string' ||
      !c.worker_id ||
      typeof c.worker_name !== 'string' ||
      !c.worker_name ||
      typeof c.vehicle_id !== 'string' ||
      !c.vehicle_id ||
      typeof c.callsign !== 'string' ||
      !c.callsign ||
      typeof c.distance_meters !== 'number' ||
      !Number.isFinite(c.distance_meters) ||
      c.distance_meters < 0 ||
      typeof c.required_capability_matched !== 'boolean'
    ) {
      return null;
    }

    const regNum = validateNullableString(c, 'registration_number');
    if (regNum === undefined) {
      return null; // Malformed registration_number -> fail closed
    }

    const locUpdated = validateNullableTimestamp(c, 'vehicle_location_updated_at');
    if (locUpdated === undefined) {
      return null; // Malformed vehicle_location_updated_at -> fail closed
    }

    ranked_candidates.push({
      worker_id: c.worker_id,
      worker_name: c.worker_name,
      vehicle_id: c.vehicle_id,
      callsign: c.callsign,
      registration_number: regNum,
      distance_meters: c.distance_meters,
      vehicle_location_updated_at: locUpdated,
      required_capability_matched: c.required_capability_matched,
    });
  }

  // Validate unranked_candidates array
  if (!Array.isArray(record.unranked_candidates)) {
    return null;
  }

  const unranked_candidates: DispatchUnrankedCandidate[] = [];
  for (const item of record.unranked_candidates) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return null;
    }
    const c = item as Record<string, unknown>;
    const requiredUnrankedKeys = [
      'worker_id',
      'worker_name',
      'vehicle_id',
      'callsign',
      'registration_number',
      'distance_meters',
      'vehicle_location_updated_at',
      'required_capability_matched',
      'ranking_reason',
    ];
    for (const key of requiredUnrankedKeys) {
      if (!Object.prototype.hasOwnProperty.call(c, key)) {
        return null;
      }
    }

    if (
      typeof c.worker_id !== 'string' ||
      !c.worker_id ||
      typeof c.worker_name !== 'string' ||
      !c.worker_name ||
      typeof c.vehicle_id !== 'string' ||
      !c.vehicle_id ||
      typeof c.callsign !== 'string' ||
      !c.callsign ||
      c.distance_meters !== null ||
      typeof c.required_capability_matched !== 'boolean' ||
      (c.ranking_reason !== 'vehicle_location_unavailable' &&
        c.ranking_reason !== 'incident_location_unavailable')
    ) {
      return null;
    }

    const regNum = validateNullableString(c, 'registration_number');
    if (regNum === undefined) {
      return null; // Malformed registration_number -> fail closed
    }

    const locUpdated = validateNullableTimestamp(c, 'vehicle_location_updated_at');
    if (locUpdated === undefined) {
      return null; // Malformed vehicle_location_updated_at -> fail closed
    }

    unranked_candidates.push({
      worker_id: c.worker_id,
      worker_name: c.worker_name,
      vehicle_id: c.vehicle_id,
      callsign: c.callsign,
      registration_number: regNum,
      distance_meters: null,
      vehicle_location_updated_at: locUpdated,
      required_capability_matched: c.required_capability_matched,
      ranking_reason: c.ranking_reason,
    });
  }

  return {
    generated_at: validGeneratedAt,
    dispatch_state,
    incident: {
      id: inc.id,
      reference_number: inc.reference_number,
      status: inc.status as IncidentStatus,
      required_capability,
      has_location: inc.has_location,
    },
    current_assignment,
    ranking_available: record.ranking_available,
    ranked_candidates,
    unranked_candidates,
  };
}

/**
 * Authoritative data-layer function to retrieve dispatch candidates for an incident.
 * Derives caller context, enforces admin/operator role, calls get_dispatch_candidates RPC,
 * and defensibly validates return payload.
 */
export async function getDispatchCandidates(
  incidentId: string
): Promise<DispatchCandidatesResult> {
  const authContext = await getCurrentUser();

  if (!authContext || !authContext.profile || !authContext.profile.is_active) {
    return {
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Authentication required to access dispatch candidates.',
      },
    };
  }

  const role = authContext.profile.role;
  if (role !== 'admin' && role !== 'operator') {
    return {
      success: false,
      error: {
        code: 'FORBIDDEN',
        message: 'Unauthorized: only operators and administrators can access dispatch candidates.',
      },
    };
  }

  if (!incidentId || typeof incidentId !== 'string') {
    return {
      success: false,
      error: {
        code: 'NOT_DISPATCHABLE',
        message: 'Valid incident ID is required.',
      },
    };
  }

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc('get_dispatch_candidates', {
      p_incident_id: incidentId,
    });

    if (error) {
      console.error('Database error retrieving dispatch candidates:', error);
      return {
        success: false,
        error: {
          code: 'SNAPSHOT_UNAVAILABLE',
          message: 'Dispatch candidates could not be loaded.',
        },
      };
    }

    const context = validateAndNormalizeDispatchContext(data);
    if (!context) {
      console.error('Malformed dispatch candidate payload received:', data);
      return {
        success: false,
        error: {
          code: 'INVALID_RESPONSE',
          message: 'Dispatch candidate response was invalid or corrupted.',
        },
      };
    }

    return {
      success: true,
      context,
    };
  } catch (err) {
    console.error('Unexpected error retrieving dispatch candidates:', err);
    return {
      success: false,
      error: {
        code: 'SNAPSHOT_UNAVAILABLE',
        message: 'Dispatch candidates could not be loaded.',
      },
    };
  }
}

/**
 * Authoritative execution of dispatch_incident RPC.
 * Dispatches an eligible worker and vehicle to an incident in ready_for_dispatch status.
 */
export async function executeDispatchIncident(
  incidentId: string,
  workerId: string,
  vehicleId: string
): Promise<DispatchMutationResult> {
  const authContext = await getCurrentUser();

  if (!authContext || !authContext.profile || !authContext.profile.is_active) {
    return {
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Authentication required to dispatch an incident.',
      },
    };
  }

  const role = authContext.profile.role;
  if (role !== 'admin' && role !== 'operator') {
    return {
      success: false,
      error: {
        code: 'FORBIDDEN',
        message: 'Unauthorized: only operators and administrators can dispatch incidents.',
      },
    };
  }

  if (!incidentId || !workerId || !vehicleId) {
    return {
      success: false,
      error: {
        code: 'NOT_DISPATCHABLE',
        message: 'Incident ID, Worker ID, and Vehicle ID are all required.',
      },
    };
  }

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc('dispatch_incident', {
      p_incident_id: incidentId,
      p_worker_id: workerId,
      p_vehicle_id: vehicleId,
    });

    if (error) {
      console.error('Database error executing dispatch_incident:', error);
      const msg = error.message || '';

      if (msg.includes('not ready for dispatch')) {
        return {
          success: false,
          error: {
            code: 'NOT_DISPATCHABLE',
            message: 'Incident is no longer ready for dispatch.',
          },
        };
      }

      if (
        msg.includes('not available') ||
        msg.includes('deactivated') ||
        msg.includes('not active') ||
        msg.includes('does not possess') ||
        msg.includes('No active shift')
      ) {
        return {
          success: false,
          error: {
            code: 'CANDIDATE_NO_LONGER_ELIGIBLE',
            message: 'This unit is no longer available or eligible for dispatch.',
          },
        };
      }

      if (
        msg.includes('already has an active assignment') ||
        msg.includes('duplicate') ||
        msg.includes('conflict') ||
        msg.includes('unique constraint')
      ) {
        return {
          success: false,
          error: {
            code: 'DISPATCH_CONFLICT',
            message: 'An active assignment conflict occurred for this unit or incident.',
          },
        };
      }

      return {
        success: false,
        error: {
          code: 'DISPATCH_UNAVAILABLE',
          message: 'Dispatch could not be completed.',
        },
      };
    }

    if (
      !data ||
      typeof data !== 'object' ||
      data.success !== true ||
      typeof data.assignment_id !== 'string' ||
      !data.assignment_id ||
      typeof data.incident_id !== 'string' ||
      !data.incident_id ||
      typeof data.reference_number !== 'string' ||
      !data.reference_number ||
      data.incident_status !== 'dispatched' ||
      typeof data.worker_id !== 'string' ||
      !data.worker_id ||
      typeof data.vehicle_id !== 'string' ||
      !data.vehicle_id ||
      typeof data.assigned_at !== 'string' ||
      !validateRequiredTimestamp(data.assigned_at)
    ) {
      console.error('Malformed dispatch success response:', data);
      return {
        success: false,
        error: {
          code: 'INVALID_RESPONSE',
          message: 'Dispatch response was invalid.',
        },
      };
    }

    const payload: DispatchSuccessPayload = {
      success: true,
      assignment_id: data.assignment_id,
      incident_id: data.incident_id,
      reference_number: data.reference_number,
      incident_status: 'dispatched',
      worker_id: data.worker_id,
      vehicle_id: data.vehicle_id,
      assigned_at: data.assigned_at,
    };

    return {
      success: true,
      data: payload,
    };
  } catch (err) {
    console.error('Unexpected error executing dispatch_incident:', err);
    return {
      success: false,
      error: {
        code: 'DISPATCH_UNAVAILABLE',
        message: 'Dispatch could not be completed.',
      },
    };
  }
}

/**
 * Authoritative execution of reassign_incident RPC.
 * Reassigns an incident in dispatched status whose current assignment is still in status 'assigned'.
 */
export async function executeReassignIncident(
  incidentId: string,
  currentAssignmentId: string,
  newWorkerId: string,
  newVehicleId: string
): Promise<DispatchMutationResult> {
  const authContext = await getCurrentUser();

  if (!authContext || !authContext.profile || !authContext.profile.is_active) {
    return {
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Authentication required to reassign an incident.',
      },
    };
  }

  const role = authContext.profile.role;
  if (role !== 'admin' && role !== 'operator') {
    return {
      success: false,
      error: {
        code: 'FORBIDDEN',
        message: 'Unauthorized: only operators and administrators can reassign incidents.',
      },
    };
  }

  if (!incidentId || !currentAssignmentId || !newWorkerId || !newVehicleId) {
    return {
      success: false,
      error: {
        code: 'NOT_DISPATCHABLE',
        message: 'All parameters (incident, current assignment, new worker, and new vehicle) are required.',
      },
    };
  }

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc('reassign_incident', {
      p_incident_id: incidentId,
      p_current_assignment_id: currentAssignmentId,
      p_new_worker_id: newWorkerId,
      p_new_vehicle_id: newVehicleId,
    });

    if (error) {
      console.error('Database error executing reassign_incident:', error);
      const msg = error.message || '';

      if (
        msg.includes('status is already') ||
        msg.includes('cannot be reassigned') ||
        msg.includes('must be in dispatched status')
      ) {
        return {
          success: false,
          error: {
            code: 'REASSIGNMENT_NOT_ALLOWED',
            message: 'This incident can no longer be reassigned as the unit has progressed beyond assigned status.',
          },
        };
      }

      if (msg.includes('identical to current assignment')) {
        return {
          success: false,
          error: {
            code: 'REASSIGNMENT_NOT_ALLOWED',
            message: 'The replacement unit cannot be identical to the current unit.',
          },
        };
      }

      if (
        msg.includes('not available') ||
        msg.includes('deactivated') ||
        msg.includes('not active') ||
        msg.includes('does not possess') ||
        msg.includes('No active shift')
      ) {
        return {
          success: false,
          error: {
            code: 'CANDIDATE_NO_LONGER_ELIGIBLE',
            message: 'The selected replacement unit is no longer available or eligible.',
          },
        };
      }

      if (
        msg.includes('already has an active assignment') ||
        msg.includes('duplicate') ||
        msg.includes('conflict') ||
        msg.includes('unique constraint')
      ) {
        return {
          success: false,
          error: {
            code: 'DISPATCH_CONFLICT',
            message: 'An active assignment conflict occurred for the replacement unit.',
          },
        };
      }

      return {
        success: false,
        error: {
          code: 'DISPATCH_UNAVAILABLE',
          message: 'Reassignment could not be completed.',
        },
      };
    }

    if (
      !data ||
      typeof data !== 'object' ||
      data.success !== true ||
      typeof data.incident_id !== 'string' ||
      !data.incident_id ||
      typeof data.reference_number !== 'string' ||
      !data.reference_number ||
      typeof data.old_assignment_id !== 'string' ||
      !data.old_assignment_id ||
      typeof data.new_assignment_id !== 'string' ||
      !data.new_assignment_id ||
      typeof data.new_worker_id !== 'string' ||
      !data.new_worker_id ||
      typeof data.new_vehicle_id !== 'string' ||
      !data.new_vehicle_id ||
      data.incident_status !== 'dispatched'
    ) {
      console.error('Malformed reassign success response:', data);
      return {
        success: false,
        error: {
          code: 'INVALID_RESPONSE',
          message: 'Reassignment response was invalid.',
        },
      };
    }

    const payload: ReassignSuccessPayload = {
      success: true,
      incident_id: data.incident_id,
      reference_number: data.reference_number,
      old_assignment_id: data.old_assignment_id,
      new_assignment_id: data.new_assignment_id,
      new_worker_id: data.new_worker_id,
      new_vehicle_id: data.new_vehicle_id,
      incident_status: 'dispatched',
    };

    return {
      success: true,
      data: payload,
    };
  } catch (err) {
    console.error('Unexpected error executing reassign_incident:', err);
    return {
      success: false,
      error: {
        code: 'DISPATCH_UNAVAILABLE',
        message: 'Reassignment could not be completed.',
      },
    };
  }
}
