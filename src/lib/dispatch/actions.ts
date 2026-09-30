'use server';

import {
  getDispatchCandidates,
  executeDispatchIncident,
  executeReassignIncident,
} from '@/lib/dispatch/data';
import { DispatchCandidatesResult, DispatchMutationResult } from '@/types';

/**
 * Server action to retrieve capability-aware dispatch candidates for an incident.
 * Does not accept client-supplied tenant, role, or credentials.
 */
export async function loadDispatchCandidates(
  incidentId: string
): Promise<DispatchCandidatesResult> {
  return getDispatchCandidates(incidentId);
}

/**
 * Server action to dispatch an eligible worker and vehicle to an incident in ready_for_dispatch status.
 * Executes authoritative dispatch_incident RPC transaction.
 */
export async function dispatchIncident(
  incidentId: string,
  workerId: string,
  vehicleId: string
): Promise<DispatchMutationResult> {
  return executeDispatchIncident(incidentId, workerId, vehicleId);
}

/**
 * Server action to reassign an incident in dispatched status whose assignment is still assigned.
 * Executes authoritative reassign_incident RPC transaction.
 */
export async function reassignIncident(
  incidentId: string,
  currentAssignmentId: string,
  newWorkerId: string,
  newVehicleId: string
): Promise<DispatchMutationResult> {
  return executeReassignIncident(incidentId, currentAssignmentId, newWorkerId, newVehicleId);
}
