/**
 * Matos Systems — Vapi Webhook & Tool-Call Validator
 * Phase 9B Telephony Intake Validation
 *
 * Owns pure validation, token authentication, and payload normalization.
 * Zero database access, zero runtime secrets logged, zero side-effects.
 */

import crypto from 'node:crypto';
import type {
  ServiceType,
  IncidentPriority,
  IncidentStatus,
} from '@/types';
import type {
  VoiceIntakeIncidentParams,
  VoiceIntakeIncidentResult,
  VapiToolResultItem,
} from '@/types/telephony';

export const VALID_SERVICE_TYPES: ReadonlySet<ServiceType> = new Set([
  'towing',
  'jump_start',
  'lockout',
  'tire_change',
  'fuel_delivery',
  'winch_recovery',
  'general_assistance',
]);

export const VALID_PRIORITIES: ReadonlySet<IncidentPriority> = new Set([
  'low',
  'standard',
  'high',
  'critical',
]);

export const VALID_INCIDENT_STATUSES: ReadonlySet<IncidentStatus> = new Set([
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
]);

/**
 * Validates the Authorization header using timing-safe comparison.
 * Fails closed if the header or configured secret is missing or empty.
 * Unequal buffer lengths are checked BEFORE timingSafeEqual to prevent throwing.
 */
export function validateVapiBearerToken(
  authHeader: string | null | undefined,
  expectedSecret: string | undefined
): boolean {
  if (!authHeader || !expectedSecret) {
    return false;
  }

  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match || !match[1]) {
    return false;
  }

  const providedToken = match[1].trim();
  const trimmedSecret = expectedSecret.trim();

  if (!providedToken || !trimmedSecret) {
    return false;
  }

  const tokenBuffer = Buffer.from(providedToken, 'utf8');
  const secretBuffer = Buffer.from(trimmedSecret, 'utf8');

  if (tokenBuffer.length !== secretBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(tokenBuffer, secretBuffer);
}

export interface ParsedToolCallItem {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ValidatedVapiEnvelope {
  callId: string;
  toolCalls: ParsedToolCallItem[];
}

export type EnvelopeValidationResult =
  | { isValid: true; data: ValidatedVapiEnvelope }
  | { isValid: false; error: string };

/**
 * Validates the Vapi webhook payload envelope.
 * Uses message.toolCallList as primary source with message.toolCalls as fallback.
 * Never combines both arrays.
 */
export function validateVapiWebhookEnvelope(payload: unknown): EnvelopeValidationResult {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { isValid: false, error: 'Malformed payload: expected JSON object.' };
  }

  const obj = payload as Record<string, unknown>;
  const message = obj.message;

  if (!message || typeof message !== 'object' || Array.isArray(message)) {
    return { isValid: false, error: 'Malformed payload: missing message object.' };
  }

  const msgObj = message as Record<string, unknown>;

  if (msgObj.type !== 'tool-calls') {
    return { isValid: false, error: "Invalid message type: expected 'tool-calls'." };
  }

  const call = msgObj.call;
  if (!call || typeof call !== 'object' || Array.isArray(call)) {
    return { isValid: false, error: 'Malformed payload: missing call object.' };
  }

  const callObj = call as Record<string, unknown>;
  const rawCallId = callObj.id;
  if (typeof rawCallId !== 'string' || rawCallId.trim().length === 0) {
    return { isValid: false, error: 'Malformed payload: missing or empty call.id.' };
  }
  const callId = rawCallId.trim();

  // Select tool list: toolCallList primary, toolCalls fallback. Never combine.
  let rawList: unknown = undefined;
  if (Array.isArray(msgObj.toolCallList)) {
    rawList = msgObj.toolCallList;
  } else if (Array.isArray(msgObj.toolCalls)) {
    rawList = msgObj.toolCalls;
  } else {
    return { isValid: false, error: 'Malformed payload: missing valid toolCallList or toolCalls array.' };
  }

  const list = rawList as unknown[];
  const toolCalls: ParsedToolCallItem[] = [];

  for (let i = 0; i < list.length; i++) {
    const item = list[i];
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return { isValid: false, error: `Malformed tool call at index ${i}: expected object.` };
    }

    const itemObj = item as Record<string, unknown>;
    const rawId = itemObj.id;
    if (typeof rawId !== 'string' || rawId.trim().length === 0) {
      return { isValid: false, error: `Malformed tool call at index ${i}: missing id.` };
    }

    if (itemObj.type !== 'function') {
      return { isValid: false, error: `Malformed tool call '${rawId}': expected type 'function'.` };
    }

    const fn = itemObj.function;
    if (!fn || typeof fn !== 'object' || Array.isArray(fn)) {
      return { isValid: false, error: `Malformed tool call '${rawId}': missing function object.` };
    }

    const fnObj = fn as Record<string, unknown>;
    const rawName = fnObj.name;
    if (typeof rawName !== 'string' || rawName.trim().length === 0) {
      return { isValid: false, error: `Malformed tool call '${rawId}': missing function name.` };
    }

    const args = fnObj.arguments;
    if (!args || typeof args !== 'object' || Array.isArray(args)) {
      return { isValid: false, error: `Malformed tool call '${rawId}': arguments must be a plain object.` };
    }

    toolCalls.push({
      id: rawId.trim(),
      name: rawName.trim(),
      arguments: args as Record<string, unknown>,
    });
  }

  return {
    isValid: true,
    data: {
      callId,
      toolCalls,
    },
  };
}

/**
 * Constructs the deterministic boundary idempotency key for Vapi tool calls.
 * Format: vapi:<callId>:<toolCallId>
 */
export function buildVapiIdempotencyKey(callId: string, toolCallId: string): string {
  return `vapi:${callId.trim()}:${toolCallId.trim()}`;
}

export type CreateIncidentValidationResult =
  | { isValid: true; params: VoiceIntakeIncidentParams }
  | { isValid: false; error: string };

/**
 * Validates and normalizes create_incident tool call arguments.
 * Strictly accepts snake_case argument keys.
 */
export function validateCreateIncidentArgs(args: Record<string, unknown>): CreateIncidentValidationResult {
  // Required: customer_name (snake_case only)
  const rawCustomerName = args.customer_name;
  if (typeof rawCustomerName !== 'string' || rawCustomerName.trim().length === 0) {
    return { isValid: false, error: 'Customer name is required and must be a non-empty string.' };
  }
  const customerName = rawCustomerName.trim();

  // Required: customer_phone (snake_case only)
  const rawCustomerPhone = args.customer_phone;
  if (typeof rawCustomerPhone !== 'string' || rawCustomerPhone.trim().length === 0) {
    return { isValid: false, error: 'Customer phone is required and must be a non-empty string.' };
  }
  const customerPhone = rawCustomerPhone.trim();

  // Required: location_address (snake_case only)
  const rawLocationAddress = args.location_address;
  if (typeof rawLocationAddress !== 'string' || rawLocationAddress.trim().length === 0) {
    return { isValid: false, error: 'Location address is required and must be a non-empty string.' };
  }
  const locationAddress = rawLocationAddress.trim();

  // Optional: service_type (snake_case only)
  const rawServiceType = args.service_type;
  let serviceType: ServiceType | undefined = undefined;
  if (rawServiceType !== undefined && rawServiceType !== null) {
    if (typeof rawServiceType !== 'string') {
      return { isValid: false, error: 'service_type must be a string.' };
    }
    const trimmed = rawServiceType.trim();
    if (trimmed.length > 0) {
      if (!VALID_SERVICE_TYPES.has(trimmed as ServiceType)) {
        return { isValid: false, error: `Invalid service_type '${trimmed}'.` };
      }
      serviceType = trimmed as ServiceType;
    }
  }

  // Optional: priority
  const rawPriority = args.priority;
  let priority: IncidentPriority | undefined = undefined;
  if (rawPriority !== undefined && rawPriority !== null) {
    if (typeof rawPriority !== 'string') {
      return { isValid: false, error: 'priority must be a string.' };
    }
    const trimmed = rawPriority.trim();
    if (trimmed.length > 0) {
      if (!VALID_PRIORITIES.has(trimmed as IncidentPriority)) {
        return { isValid: false, error: `Invalid priority '${trimmed}'.` };
      }
      priority = trimmed as IncidentPriority;
    }
  }

  // Optional: vehicle_year (snake_case only)
  // If undefined or null -> omitted. If supplied, must be a finite integer between 1900 and 2100.
  const rawYear = args.vehicle_year;
  let vehicleYear: number | undefined = undefined;
  if (rawYear !== undefined && rawYear !== null) {
    if (typeof rawYear !== 'number' || !Number.isInteger(rawYear) || !Number.isFinite(rawYear)) {
      return { isValid: false, error: 'Vehicle year must be a finite integer between 1900 and 2100.' };
    }
    if (rawYear < 1900 || rawYear > 2100) {
      return { isValid: false, error: 'Vehicle year must be between 1900 and 2100.' };
    }
    vehicleYear = rawYear;
  }

  // Helper for optional string fields: validates string type and trims
  const parseOptionalString = (
    val: unknown,
    fieldName: string
  ): { isValid: true; value: string | undefined } | { isValid: false; error: string } => {
    if (val === undefined || val === null) {
      return { isValid: true, value: undefined };
    }
    if (typeof val !== 'string') {
      return { isValid: false, error: `${fieldName} must be a string.` };
    }
    const trimmed = val.trim();
    return { isValid: true, value: trimmed.length > 0 ? trimmed : undefined };
  };

  const notesResult = parseOptionalString(args.notes, 'notes');
  if (!notesResult.isValid) return notesResult;

  const makeResult = parseOptionalString(args.vehicle_make, 'vehicle_make');
  if (!makeResult.isValid) return makeResult;

  const modelResult = parseOptionalString(args.vehicle_model, 'vehicle_model');
  if (!modelResult.isValid) return modelResult;

  const colorResult = parseOptionalString(args.vehicle_color, 'vehicle_color');
  if (!colorResult.isValid) return colorResult;

  const regResult = parseOptionalString(args.vehicle_registration, 'vehicle_registration');
  if (!regResult.isValid) return regResult;

  return {
    isValid: true,
    params: {
      customerName,
      customerPhone,
      locationAddress,
      serviceType,
      priority,
      notes: notesResult.value,
      vehicleMake: makeResult.value,
      vehicleModel: modelResult.value,
      vehicleYear,
      vehicleColor: colorResult.value,
      vehicleRegistration: regResult.value,
    },
  };
}

/**
 * Formats a Vapi tool result item following truthful status rules:
 * - New incident: "Incident <REF> has been created successfully."
 * - Duplicate incident: "Incident <REF> already exists and is currently <STATUS>."
 * - Failure: flat string error without result property.
 * Never exposes UUIDs, never fabricates reference numbers, never fabricates statuses, never mentions SMS.
 */
export function formatVoiceIntakeToolResult(
  toolCallId: string,
  result: VoiceIntakeIncidentResult
): VapiToolResultItem {
  if (!result.success) {
    return {
      toolCallId,
      error: `Failed to create incident: ${result.error ?? 'Incident intake could not be completed.'}`,
    };
  }

  // Strictly require reference_number, status in VALID_INCIDENT_STATUSES, and boolean is_duplicate
  if (
    typeof result.reference_number !== 'string' ||
    result.reference_number.trim().length === 0 ||
    !result.status ||
    !VALID_INCIDENT_STATUSES.has(result.status) ||
    typeof result.is_duplicate !== 'boolean'
  ) {
    return {
      toolCallId,
      error: 'Failed to create incident: Invalid incident response.',
    };
  }

  const ref = result.reference_number.trim();
  const status = result.status;

  if (result.is_duplicate) {
    return {
      toolCallId,
      result: `Incident ${ref} already exists and is currently ${status}.`,
    };
  }

  return {
    toolCallId,
    result: `Incident ${ref} has been created successfully.`,
  };
}
