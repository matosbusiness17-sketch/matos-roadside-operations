'use server';

import { createClient } from '@/lib/supabase/server';
import { getCurrentUser } from '@/lib/auth/get-user';
import {
  WorkerLifecycleAction,
  WorkerTransitionResult,
  WorkerTransitionErrorCode,
  WorkerTransitionSuccessPayload,
  AssignmentStatus,
  IncidentStatus,
  WorkerAvailabilityStatus,
  ALLOWED_WORKER_ACTIONS,
} from '@/types';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const AUTHORITATIVE_ASSIGNMENT_STATUSES: readonly AssignmentStatus[] = [
  'assigned',
  'accepted',
  'en_route',
  'on_scene',
  'completed',
  'cancelled',
];

const AUTHORITATIVE_INCIDENT_STATUSES: readonly IncidentStatus[] = [
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

const AUTHORITATIVE_WORKER_AVAILABILITY_STATUSES: readonly WorkerAvailabilityStatus[] = [
  'off_duty',
  'available',
  'busy',
  'unavailable',
];

/**
 * Maps raw database and RPC error messages to safe domain error codes and messages.
 * Never exposes raw SQL, Postgres internal state, or stack traces to the client.
 */
function mapWorkerRpcError(rawMessage: string): {
  code: WorkerTransitionErrorCode;
  message: string;
} {
  const lower = rawMessage.toLowerCase();

  if (lower.includes('authentication required')) {
    return {
      code: 'UNAUTHORIZED',
      message: 'Authentication required. Please sign in to continue.',
    };
  }

  if (lower.includes('unauthorized') || lower.includes('only workers')) {
    return {
      code: 'FORBIDDEN',
      message: 'Only authorized response workers can execute assignment transitions.',
    };
  }

  if (lower.includes('assignment not found') || lower.includes('profile not found')) {
    return {
      code: 'ASSIGNMENT_NOT_FOUND',
      message: 'The requested assignment was not found or is no longer assigned to you.',
    };
  }

  if (
    lower.includes('requires assignment in status') ||
    lower.includes('invalid status transition') ||
    lower.includes('already in status') ||
    lower.includes('terminal status')
  ) {
    return {
      code: 'INVALID_TRANSITION',
      message: 'This action is not valid for the current assignment or incident status.',
    };
  }

  if (lower.includes('conflict') || lower.includes('unique constraint')) {
    return {
      code: 'ASSIGNMENT_CONFLICT',
      message: 'An assignment state conflict occurred. Please refresh your assignment.',
    };
  }

  return {
    code: 'WORKER_ACTION_UNAVAILABLE',
    message: 'Worker lifecycle transition is temporarily unavailable. Please try again.',
  };
}

/**
 * Validates and normalizes the success JSONB payload returned from worker_transition_assignment RPC.
 * Enforces action-consistent invariants on assignment status, incident status, worker availability,
 * and completion timestamps.
 */
function validateWorkerSuccessPayload(
  raw: unknown,
  expectedAction: WorkerLifecycleAction
): WorkerTransitionSuccessPayload | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }

  const rec = raw as Record<string, unknown>;

  const requiredKeys = [
    'success',
    'action',
    'assignment_id',
    'assignment_status',
    'incident_id',
    'incident_status',
    'worker_id',
    'worker_availability',
    'completed_at',
    'transitioned_at',
  ];

  for (const k of requiredKeys) {
    if (!Object.prototype.hasOwnProperty.call(rec, k)) {
      return null;
    }
  }

  if (rec.success !== true || rec.action !== expectedAction) {
    return null;
  }

  if (typeof rec.assignment_id !== 'string' || !UUID_REGEX.test(rec.assignment_id)) {
    return null;
  }
  if (typeof rec.incident_id !== 'string' || !UUID_REGEX.test(rec.incident_id)) {
    return null;
  }
  if (typeof rec.worker_id !== 'string' || !UUID_REGEX.test(rec.worker_id)) {
    return null;
  }

  // Runtime membership validation of status enums
  if (
    typeof rec.assignment_status !== 'string' ||
    !AUTHORITATIVE_ASSIGNMENT_STATUSES.includes(rec.assignment_status as AssignmentStatus)
  ) {
    return null;
  }
  const assignment_status = rec.assignment_status as AssignmentStatus;

  if (
    typeof rec.incident_status !== 'string' ||
    !AUTHORITATIVE_INCIDENT_STATUSES.includes(rec.incident_status as IncidentStatus)
  ) {
    return null;
  }
  const incident_status = rec.incident_status as IncidentStatus;

  if (
    typeof rec.worker_availability !== 'string' ||
    !AUTHORITATIVE_WORKER_AVAILABILITY_STATUSES.includes(
      rec.worker_availability as WorkerAvailabilityStatus
    )
  ) {
    return null;
  }
  const worker_availability = rec.worker_availability as WorkerAvailabilityStatus;

  // Action-specific exact invariants
  let completed_at: string | null = null;

  switch (expectedAction) {
    case 'ACCEPT_ASSIGNMENT':
      if (
        assignment_status !== 'accepted' ||
        incident_status !== 'dispatched' ||
        worker_availability !== 'busy' ||
        rec.completed_at !== null
      ) {
        return null;
      }
      completed_at = null;
      break;

    case 'START_JOURNEY':
      if (
        assignment_status !== 'en_route' ||
        incident_status !== 'en_route' ||
        rec.completed_at !== null
      ) {
        return null;
      }
      completed_at = null;
      break;

    case 'ARRIVE_ON_SCENE':
      if (
        assignment_status !== 'on_scene' ||
        incident_status !== 'on_scene' ||
        rec.completed_at !== null
      ) {
        return null;
      }
      completed_at = null;
      break;

    case 'START_WORK':
      if (
        assignment_status !== 'on_scene' ||
        incident_status !== 'in_progress' ||
        rec.completed_at !== null
      ) {
        return null;
      }
      completed_at = null;
      break;

    case 'COMPLETE_JOB':
      if (
        assignment_status !== 'completed' ||
        incident_status !== 'completed' ||
        worker_availability !== 'available' ||
        rec.completed_at === null ||
        typeof rec.completed_at !== 'string'
      ) {
        return null;
      }
      const parsedCompletedAt = Date.parse(rec.completed_at);
      if (!Number.isFinite(parsedCompletedAt)) {
        return null;
      }
      completed_at = rec.completed_at;
      break;

    default:
      return null;
  }

  // transitioned_at must be a valid finite timestamp
  if (typeof rec.transitioned_at !== 'string') {
    return null;
  }
  const parsedTransitionedAt = Date.parse(rec.transitioned_at);
  if (!Number.isFinite(parsedTransitionedAt)) {
    return null;
  }

  return {
    success: true,
    action: expectedAction,
    assignment_id: rec.assignment_id,
    assignment_status,
    incident_id: rec.incident_id,
    incident_status,
    worker_id: rec.worker_id,
    worker_availability,
    completed_at,
    transitioned_at: rec.transitioned_at,
  };
}

/**
 * Server action: transitions the authenticated worker's active assignment through
 * one of the five locked operational lifecycle actions.
 */
export async function transitionWorkerAssignment(
  assignmentId: string,
  action: WorkerLifecycleAction
): Promise<WorkerTransitionResult> {
  try {
    // 1. Parameter and action validation
    if (!assignmentId || typeof assignmentId !== 'string' || !UUID_REGEX.test(assignmentId)) {
      return {
        success: false,
        error: {
          code: 'ASSIGNMENT_NOT_FOUND',
          message: 'Invalid assignment identifier format.',
        },
      };
    }

    if (!ALLOWED_WORKER_ACTIONS.includes(action)) {
      return {
        success: false,
        error: {
          code: 'INVALID_TRANSITION',
          message: 'Unsupported worker transition action.',
        },
      };
    }

    // 2. Caller authentication and role check
    const user = await getCurrentUser();
    if (!user) {
      return {
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authentication required. Please sign in to continue.',
        },
      };
    }

    if (user.profile.role !== 'worker') {
      return {
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: 'Only response workers can execute worker assignment transitions.',
        },
      };
    }

    // 3. Invoke authoritative RPC
    const supabase = await createClient();
    const { data, error } = await supabase.rpc('worker_transition_assignment', {
      p_assignment_id: assignmentId,
      p_action: action,
    });

    if (error) {
      const mapped = mapWorkerRpcError(error.message);
      return {
        success: false,
        error: mapped,
      };
    }

    // 4. Validate and normalize returned RPC payload
    const validated = validateWorkerSuccessPayload(data, action);
    if (!validated) {
      return {
        success: false,
        error: {
          code: 'INVALID_RESPONSE',
          message: 'The server returned an invalid or unverified transition response.',
        },
      };
    }

    return {
      success: true,
      data: validated,
    };
  } catch (err) {
    console.error('Unexpected error in transitionWorkerAssignment:', err);
    return {
      success: false,
      error: {
        code: 'WORKER_ACTION_UNAVAILABLE',
        message: 'Worker lifecycle transition failed unexpectedly. Please try again.',
      },
    };
  }
}
