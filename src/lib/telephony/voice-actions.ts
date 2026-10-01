/**
 * Matos Systems — Voice Telephony Actions
 * Phase 9B Voice Incident Intake Database Boundary
 *
 * Exclusively executes the authoritative database RPC:
 * public.create_voice_intake_incident(...)
 *
 * Pure integration boundary:
 * - Uses anon server Supabase client via createClient()
 * - Zero service_role or SUPABASE_SERVICE_ROLE_KEY
 * - Zero direct table INSERTs or raw SQL
 * - Zero secrets or SQL internals leaked
 * - Validates all RPC return structures at runtime
 */

import { createClient } from '@/lib/supabase/server';
import type { IncidentStatus } from '@/types';
import type {
  VoiceIntakeIncidentParams,
  VoiceIntakeIncidentResult,
} from '@/types/telephony';
import { VALID_INCIDENT_STATUSES } from './vapi-validator';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface ExecuteVoiceIntakeOptions {
  integrationSecret: string;
  idempotencyKey: string;
  params: VoiceIntakeIncidentParams;
}

/**
 * Maps known database validation or authorization exceptions to safe external error strings.
 * Guarantees zero leakage of SQL internals, secrets, hashes, or tenant IDs.
 */
function sanitizeRpcError(rawError?: string): string {
  if (!rawError || typeof rawError !== 'string') {
    return 'Voice intake incident creation failed.';
  }

  const lower = rawError.toLowerCase();

  if (
    lower.includes('unauthorized') ||
    lower.includes('secret') ||
    lower.includes('credential') ||
    lower.includes('token')
  ) {
    return 'Unauthorized integration credential.';
  }

  if (lower.includes('customer name is required')) {
    return 'Customer name is required.';
  }

  if (lower.includes('customer phone is required')) {
    return 'Customer phone is required.';
  }

  if (lower.includes('location address is required')) {
    return 'Location address is required.';
  }

  if (lower.includes('idempotency key is required')) {
    return 'Idempotency key is required.';
  }

  if (lower.includes('service_type')) {
    return 'Invalid service type.';
  }

  if (lower.includes('priority')) {
    return 'Invalid priority level.';
  }

  if (lower.includes('vehicle year')) {
    return 'Vehicle year must be between 1900 and 2100.';
  }

  if (lower.includes('capability')) {
    return 'Required service capability could not be resolved.';
  }

  return 'Database operation failed during incident intake.';
}

/**
 * Invokes the Phase 9A RPC create_voice_intake_incident to record a telephony intake incident.
 * Validates the database response contract at runtime before returning.
 */
export async function executeVoiceIntakeIncident(
  options: ExecuteVoiceIntakeOptions
): Promise<VoiceIntakeIncidentResult> {
  try {
    const supabase = await createClient();

    const rpcArgs = {
      p_integration_secret: options.integrationSecret,
      p_idempotency_key: options.idempotencyKey,
      p_customer_name: options.params.customerName,
      p_customer_phone: options.params.customerPhone,
      p_location_address: options.params.locationAddress,
      p_service_type: options.params.serviceType ?? null,
      p_priority: options.params.priority ?? null,
      p_notes: options.params.notes ?? null,
      p_vehicle_make: options.params.vehicleMake ?? null,
      p_vehicle_model: options.params.vehicleModel ?? null,
      p_vehicle_year: options.params.vehicleYear ?? null,
      p_vehicle_color: options.params.vehicleColor ?? null,
      p_vehicle_registration: options.params.vehicleRegistration ?? null,
    };

    const { data, error } = await supabase.rpc(
      'create_voice_intake_incident',
      rpcArgs
    );

    if (error) {
      return {
        success: false,
        error: sanitizeRpcError(error.message),
      };
    }

    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return {
        success: false,
        error: 'Malformed response returned from intake service.',
      };
    }

    const payload = data as Record<string, unknown>;

    if (payload.success !== true) {
      const errMsg =
        typeof payload.error === 'string'
          ? sanitizeRpcError(payload.error)
          : 'Voice intake incident creation failed.';
      return {
        success: false,
        error: errMsg,
      };
    }

    // Runtime-validate incident_id is a valid UUID
    if (
      typeof payload.incident_id !== 'string' ||
      !UUID_REGEX.test(payload.incident_id.trim())
    ) {
      return {
        success: false,
        error: 'Intake service returned an invalid incident identifier.',
      };
    }

    // Runtime-validate reference_number is a non-empty string
    if (
      typeof payload.reference_number !== 'string' ||
      payload.reference_number.trim().length === 0
    ) {
      return {
        success: false,
        error: 'Intake service returned an invalid incident reference number.',
      };
    }

    // Runtime-validate status belongs to authoritative IncidentStatus union
    if (
      typeof payload.status !== 'string' ||
      !VALID_INCIDENT_STATUSES.has(payload.status as IncidentStatus)
    ) {
      return {
        success: false,
        error: 'Intake service returned an unrecognized incident status.',
      };
    }

    // Runtime-validate is_duplicate is boolean
    if (typeof payload.is_duplicate !== 'boolean') {
      return {
        success: false,
        error: 'Intake service returned invalid duplication metadata.',
      };
    }

    return {
      success: true,
      incident_id: payload.incident_id.trim(),
      reference_number: payload.reference_number.trim(),
      status: payload.status as IncidentStatus,
      is_duplicate: payload.is_duplicate,
    };
  } catch {
    return {
      success: false,
      error: 'An unexpected error occurred during incident intake.',
    };
  }
}
