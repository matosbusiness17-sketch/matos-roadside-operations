'use server';

import { createClient } from '@/lib/supabase/server';
import {
  sendTwilioSms,
  TwilioTransportError,
  type TwilioSendResult,
} from '@/lib/telephony/twilio-client';
import type { SmsDispatchStatus } from '@/types/telephony';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN_HEX_REGEX = /^[0-9a-f]{64}$/i;
const E164_REGEX = /^\+[1-9][0-9]{6,14}$/;

const PROVIDER_SMS_DISPATCH_STATUSES: ReadonlySet<SmsDispatchStatus> = new Set([
  'accepted',
  'queued',
  'sending',
  'sent',
  'delivered',
  'undelivered',
  'failed',
]);

const ALL_SMS_DISPATCH_STATUSES: ReadonlySet<SmsDispatchStatus> = new Set([
  'reserved',
  'accepted',
  'queued',
  'sending',
  'sent',
  'delivered',
  'undelivered',
  'failed',
]);

export type CustomerLocationRequestStatus = 'valid' | 'expired' | 'used' | 'revoked' | 'invalid';

export interface CreateCustomerLocationRequestResult {
  success: boolean;
  token?: string;
  expiresAt?: string;
  relativePath?: string;
  error?: {
    code?: string;
    message: string;
  };
}

export interface GetCustomerLocationStatusResult {
  success: boolean;
  status: CustomerLocationRequestStatus;
  expiresAt?: string;
  error?: {
    code?: string;
    message: string;
  };
}

export interface SubmitCustomerLocationResult {
  success: boolean;
  data?: {
    confirmed_at: string;
  };
  error?: {
    code?: string;
    message: string;
  };
}

/**
 * Maps raw database error messages to safe user-facing error objects.
 */
function mapCustomerRpcError(rawMessage: string): { code: string; message: string } {
  const lower = rawMessage.toLowerCase();

  if (lower.includes('authentication required')) {
    return {
      code: 'UNAUTHORIZED',
      message: 'Authentication required. Please sign in as an operator.',
    };
  }

  if (lower.includes('unauthorized') || lower.includes('only admins and operators')) {
    return {
      code: 'FORBIDDEN',
      message: 'Only dispatch operators and administrators can generate location links.',
    };
  }

  if (lower.includes('incident not found')) {
    return {
      code: 'INCIDENT_NOT_FOUND',
      message: 'The requested incident was not found in your organization.',
    };
  }

  if (lower.includes('terminal incident')) {
    return {
      code: 'INCIDENT_TERMINAL',
      message: 'Location links cannot be generated for completed or cancelled incidents.',
    };
  }

  if (lower.includes('already been used')) {
    return {
      code: 'TOKEN_ALREADY_USED',
      message: 'This location request link has already been used.',
    };
  }

  if (lower.includes('expired')) {
    return {
      code: 'TOKEN_EXPIRED',
      message: 'This location request link has expired.',
    };
  }

  if (lower.includes('revoked')) {
    return {
      code: 'TOKEN_REVOKED',
      message: 'This location request link was revoked by a newer request.',
    };
  }

  if (lower.includes('invalid') || lower.includes('not found')) {
    return {
      code: 'TOKEN_INVALID',
      message: 'This location request link is invalid or no longer active.',
    };
  }

  return {
    code: 'OPERATION_FAILED',
    message: 'An unexpected error occurred while processing the location request.',
  };
}

/**
 * Operator action to generate a fresh single-use customer location verification link.
 * Revokes previous active unused tokens for the target incident.
 */
export async function createCustomerLocationRequest(
  incidentId: string
): Promise<CreateCustomerLocationRequestResult> {
  if (!incidentId || !UUID_REGEX.test(incidentId.trim())) {
    return {
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'A valid incident ID is required.',
      },
    };
  }

  try {
    const supabase = await createClient();

    const { data, error } = await supabase.rpc('create_customer_location_request', {
      p_incident_id: incidentId.trim(),
    });

    if (error) {
      return {
        success: false,
        error: mapCustomerRpcError(error.message),
      };
    }

    if (!data || typeof data !== 'object') {
      return {
        success: false,
        error: {
          code: 'INVALID_RESPONSE',
          message: 'Malformed response returned from database RPC.',
        },
      };
    }

    const payload = data as {
      success?: unknown;
      token?: unknown;
      expires_at?: unknown;
      relative_path?: unknown;
    };

    if (
      payload.success !== true ||
      typeof payload.token !== 'string' ||
      payload.token.trim().length === 0 ||
      typeof payload.expires_at !== 'string' ||
      payload.expires_at.trim().length === 0 ||
      Number.isNaN(new Date(payload.expires_at).getTime())
    ) {
      return {
        success: false,
        error: {
          code: 'INCOMPLETE_RESPONSE',
          message: 'Location token response was missing required attributes.',
        },
      };
    }

    return {
      success: true,
      token: (payload.token as string).trim(),
      expiresAt: (payload.expires_at as string).trim(),
      relativePath: typeof payload.relative_path === 'string' ? payload.relative_path : undefined,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      error: mapCustomerRpcError(message),
    };
  }
}

/**
 * Public action to check whether a customer location token is valid, used, expired, or revoked.
 * Leaks zero customer, vehicle, or incident operational data.
 */
export async function getCustomerLocationRequestStatus(
  token: string
): Promise<GetCustomerLocationStatusResult> {
  const cleanToken = token ? token.trim() : '';

  if (!cleanToken || !TOKEN_HEX_REGEX.test(cleanToken)) {
    return {
      success: true,
      status: 'invalid',
    };
  }

  try {
    const supabase = await createClient();

    const { data, error } = await supabase.rpc('get_customer_location_request_status', {
      p_token: cleanToken,
    });

    if (error) {
      return {
        success: false,
        status: 'invalid',
        error: mapCustomerRpcError(error.message),
      };
    }

    if (!data || typeof data !== 'object') {
      return {
        success: true,
        status: 'invalid',
      };
    }

    const payload = data as {
      success?: boolean;
      status?: CustomerLocationRequestStatus;
      expires_at?: string;
    };

    const status = payload.status || 'invalid';

    return {
      success: true,
      status,
      expiresAt: payload.expires_at,
    };
  } catch {
    return {
      success: false,
      status: 'invalid',
      error: {
        code: 'NETWORK_ERROR',
        message: 'Failed to verify location link status. Please check your connection.',
      },
    };
  }
}

/**
 * Public action for customer to submit device GPS coordinates.
 * Authoritatively sets PostGIS location on the incident and marks token consumed.
 * Never fabricates timestamps or exposes internal incident IDs.
 */
export async function submitCustomerLocation(
  token: string,
  latitude: number,
  longitude: number,
  accuracy: number
): Promise<SubmitCustomerLocationResult> {
  const cleanToken = token ? token.trim() : '';

  // 1. Format validation
  if (!cleanToken || !TOKEN_HEX_REGEX.test(cleanToken)) {
    return {
      success: false,
      error: {
        code: 'INVALID_TOKEN',
        message: 'Invalid or malformed location link token.',
      },
    };
  }

  // 2. Coordinate validation
  if (
    typeof latitude !== 'number' ||
    !Number.isFinite(latitude) ||
    typeof longitude !== 'number' ||
    !Number.isFinite(longitude)
  ) {
    return {
      success: false,
      error: {
        code: 'INVALID_COORDINATES',
        message: 'Latitude and longitude coordinates must be valid numbers.',
      },
    };
  }

  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    return {
      success: false,
      error: {
        code: 'COORDINATES_OUT_OF_RANGE',
        message: 'Coordinates are outside valid geographical bounds.',
      },
    };
  }

  if (
    typeof accuracy !== 'number' ||
    !Number.isFinite(accuracy) ||
    accuracy < 0
  ) {
    return {
      success: false,
      error: {
        code: 'INVALID_ACCURACY',
        message: 'Accuracy must be a valid non-negative number.',
      },
    };
  }

  try {
    const supabase = await createClient();

    const { data, error } = await supabase.rpc('submit_customer_location', {
      p_token: cleanToken,
      p_latitude: latitude,
      p_longitude: longitude,
      p_accuracy: accuracy,
    });

    if (error) {
      return {
        success: false,
        error: mapCustomerRpcError(error.message),
      };
    }

    if (!data || typeof data !== 'object') {
      return {
        success: false,
        error: {
          code: 'INVALID_RESPONSE',
          message: 'Malformed confirmation returned from location submission.',
        },
      };
    }

    const payload = data as {
      success?: unknown;
      confirmed_at?: unknown;
    };

    const isConfirmedAtValidDate =
      typeof payload.confirmed_at === 'string' &&
      payload.confirmed_at.trim().length > 0 &&
      !Number.isNaN(new Date(payload.confirmed_at).getTime());

    if (payload.success !== true || !isConfirmedAtValidDate) {
      return {
        success: false,
        error: {
          code: 'INVALID_RESPONSE',
          message: 'Malformed confirmation returned from location submission.',
        },
      };
    }

    return {
      success: true,
      data: {
        confirmed_at: (payload.confirmed_at as string).trim(),
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      error: mapCustomerRpcError(message),
    };
  }
}

export interface SendCustomerLocationSmsActionResult {
  success: boolean;
  reserved?: boolean;
  dispatchId?: string;
  status?: SmsDispatchStatus;
  messageSid?: string;
  isDuplicate?: boolean;
  error?: string;
  errorCode?: string;
}

/**
 * Builds the absolute customer location link from APP_BASE_URL and the relative token path.
 * Enforces valid URL semantics and http: / https: protocol.
 */
function buildCustomerLocationUrl(baseUrlStr: string, relativePath: string): string {
  if (!baseUrlStr || baseUrlStr.trim().length === 0) {
    throw new Error('APP_BASE_URL is missing or blank.');
  }

  let base: URL;
  try {
    base = new URL(baseUrlStr.trim());
  } catch {
    throw new Error('Invalid APP_BASE_URL: must be an absolute URL.');
  }

  if (base.protocol !== 'http:' && base.protocol !== 'https:') {
    throw new Error('APP_BASE_URL must have http: or https: protocol.');
  }

  return new URL(relativePath, base).toString();
}

/**
 * Helper to record an operator pre-send dispatch failure in the database.
 * Runtime-validates RPC response and never assumes 'failed' unless confirmed by database.
 */
async function finalizeOperatorFailedDispatch(
  supabase: Awaited<ReturnType<typeof createClient>>,
  dispatchId: string,
  errorCode: string,
  errorMessage: string
): Promise<{ finalized: boolean; status?: SmsDispatchStatus; errorNote?: string }> {
  try {
    const { data, error } = await supabase.rpc(
      'finalize_customer_location_sms_send_operator',
      {
        p_dispatch_id: dispatchId,
        p_message_sid: null,
        p_status: 'failed',
        p_error_code: errorCode,
        p_error_message: errorMessage,
      }
    );

    if (error || !data || typeof data !== 'object' || Array.isArray(data)) {
      return { finalized: false, errorNote: 'dispatch failure recording could not be confirmed' };
    }

    const payload = data as Record<string, unknown>;
    if (payload.success !== true) {
      return { finalized: false, errorNote: 'dispatch failure recording could not be confirmed' };
    }

    if (payload.is_duplicate !== undefined && typeof payload.is_duplicate !== 'boolean') {
      return { finalized: false, errorNote: 'dispatch failure recording could not be confirmed' };
    }

    let finalStatus: SmsDispatchStatus | undefined = undefined;
    if (payload.status !== undefined && payload.status !== null) {
      if (
        typeof payload.status !== 'string' ||
        !ALL_SMS_DISPATCH_STATUSES.has(payload.status as SmsDispatchStatus)
      ) {
        return { finalized: false, errorNote: 'dispatch failure recording could not be confirmed' };
      }
      finalStatus = payload.status as SmsDispatchStatus;
    }

    return { finalized: true, status: finalStatus };
  } catch {
    return { finalized: false, errorNote: 'dispatch failure recording could not be confirmed' };
  }
}

/**
 * Helper to construct an operator pre-send failure result surfacing errorNote when present.
 */
function buildOperatorPreSendFailureResult(
  dispatchId: string,
  errorCode: string,
  baseMessage: string,
  finalizeRes: { finalized: boolean; status?: SmsDispatchStatus; errorNote?: string }
): SendCustomerLocationSmsActionResult {
  const errorMessage = finalizeRes.errorNote
    ? `${baseMessage} (${finalizeRes.errorNote})`
    : baseMessage;

  return {
    success: false,
    reserved: true,
    dispatchId,
    ...(finalizeRes.status ? { status: finalizeRes.status } : {}),
    errorCode,
    error: errorMessage,
  };
}

/**
 * Authenticated operator Server Action to dispatch a customer location link via Twilio SMS.
 * Follows atomic Reserve-Before-Send pattern:
 * 1. Validate input (UUID incidentId, strict E.164 phone, non-empty idempotencyKey)
 * 2. reserve_customer_location_sms_operator (idempotency / duplicate suppression)
 * 3. create_customer_location_request (Phase 8 token generation)
 * 4. attach_customer_location_request_to_sms_dispatch_operator (binds token to dispatch)
 * 5. Construct customer GPS link using APP_BASE_URL
 * 6. Send SMS through approved sendTwilioSms() transport
 * 7. finalize_customer_location_sms_send_operator (records authoritative status)
 */
export async function sendCustomerLocationSmsAction(
  incidentId: string,
  recipientPhone: string,
  idempotencyKey: string
): Promise<SendCustomerLocationSmsActionResult> {
  const cleanIncidentId = incidentId?.trim();
  if (!cleanIncidentId || !UUID_REGEX.test(cleanIncidentId)) {
    return {
      success: false,
      reserved: false,
      errorCode: 'VALIDATION_ERROR',
      error: 'A valid incident ID is required.',
    };
  }

  const cleanPhone = recipientPhone?.trim();
  if (!cleanPhone || !E164_REGEX.test(cleanPhone)) {
    return {
      success: false,
      reserved: false,
      errorCode: 'INVALID_PHONE',
      error: 'Recipient phone must be a valid E.164 phone number (e.g. +35699123456).',
    };
  }

  const cleanKey = idempotencyKey?.trim();
  if (!cleanKey || cleanKey.length > 255) {
    return {
      success: false,
      reserved: false,
      errorCode: 'VALIDATION_ERROR',
      error: 'Idempotency key is required and must be non-empty.',
    };
  }

  let supabase: Awaited<ReturnType<typeof createClient>>;
  try {
    supabase = await createClient();
  } catch {
    return {
      success: false,
      reserved: false,
      errorCode: 'CLIENT_ERROR',
      error: 'Failed to initialize database client.',
    };
  }

  // ---------------------------------------------------------------------------
  // STEP 2: RESERVE OPERATOR SMS (Duplicate suppression before token / Twilio)
  // ---------------------------------------------------------------------------
  let reserveData: unknown;
  try {
    const { data, error } = await supabase.rpc(
      'reserve_customer_location_sms_operator',
      {
        p_incident_id: cleanIncidentId,
        p_idempotency_key: cleanKey,
        p_recipient_phone: cleanPhone,
      }
    );

    if (error) {
      const mapped = mapCustomerRpcError(error.message);
      return {
        success: false,
        reserved: false,
        errorCode: mapped.code,
        error: mapped.message,
      };
    }
    reserveData = data;
  } catch {
    return {
      success: false,
      reserved: false,
      errorCode: 'RESERVATION_EXCEPTION',
      error: 'An unexpected error occurred while reserving SMS dispatch.',
    };
  }

  if (!reserveData || typeof reserveData !== 'object' || Array.isArray(reserveData)) {
    return {
      success: false,
      reserved: false,
      errorCode: 'INVALID_RESPONSE',
      error: 'Database returned an invalid reservation response.',
    };
  }

  const reservePayload = reserveData as Record<string, unknown>;

  // If duplicate reservation: STOP. Do not create token. Do not call Twilio.
  if (reservePayload.reserved === false) {
    if (
      typeof reservePayload.dispatch_id !== 'string' ||
      !UUID_REGEX.test(reservePayload.dispatch_id.trim())
    ) {
      return {
        success: false,
        reserved: false,
        errorCode: 'INVALID_RESPONSE',
        error: 'Duplicate reservation response returned an invalid dispatch ID.',
      };
    }
    const existingId = reservePayload.dispatch_id.trim();

    if (
      typeof reservePayload.existing_status !== 'string' ||
      !ALL_SMS_DISPATCH_STATUSES.has(reservePayload.existing_status as SmsDispatchStatus)
    ) {
      return {
        success: false,
        reserved: false,
        errorCode: 'INVALID_RESPONSE',
        error: 'Duplicate reservation response returned an invalid or unrecognized dispatch status.',
      };
    }
    const existingStatus = reservePayload.existing_status as SmsDispatchStatus;

    let existingSid: string | undefined = undefined;
    if (
      reservePayload.message_sid !== undefined &&
      reservePayload.message_sid !== null
    ) {
      if (
        typeof reservePayload.message_sid !== 'string' ||
        reservePayload.message_sid.trim().length === 0
      ) {
        return {
          success: false,
          reserved: false,
          errorCode: 'INVALID_RESPONSE',
          error: 'Duplicate reservation response returned an invalid message identifier.',
        };
      }
      existingSid = reservePayload.message_sid.trim();
    }

    return {
      success: true,
      reserved: false,
      isDuplicate: true,
      dispatchId: existingId,
      status: existingStatus,
      messageSid: existingSid,
    };
  }

  if (reservePayload.reserved !== true) {
    return {
      success: false,
      reserved: false,
      errorCode: 'INVALID_RESPONSE',
      error: 'Invalid reservation flag returned by database.',
    };
  }

  const dispatchId =
    typeof reservePayload.dispatch_id === 'string'
      ? reservePayload.dispatch_id.trim()
      : '';

  if (!UUID_REGEX.test(dispatchId)) {
    return {
      success: false,
      reserved: false,
      errorCode: 'INVALID_RESPONSE',
      error: 'Invalid dispatch ID returned by reservation RPC.',
    };
  }

  // ---------------------------------------------------------------------------
  // STEP 4: CREATE PHASE 8 LOCATION REQUEST
  // ---------------------------------------------------------------------------
  let tokenData: unknown;
  try {
    const { data, error } = await supabase.rpc('create_customer_location_request', {
      p_incident_id: cleanIncidentId,
    });

    if (error) {
      const finalizeRes = await finalizeOperatorFailedDispatch(
        supabase,
        dispatchId,
        'TOKEN_GENERATION_FAILED',
        'Failed to generate customer location token.'
      );
      return buildOperatorPreSendFailureResult(
        dispatchId,
        'TOKEN_GENERATION_FAILED',
        'Failed to generate customer location token.',
        finalizeRes
      );
    }
    tokenData = data;
  } catch {
    const finalizeRes = await finalizeOperatorFailedDispatch(
      supabase,
      dispatchId,
      'TOKEN_GENERATION_EXCEPTION',
      'Unexpected error occurred while generating location token.'
    );
    return buildOperatorPreSendFailureResult(
      dispatchId,
      'TOKEN_GENERATION_EXCEPTION',
      'Unexpected error occurred while generating location token.',
      finalizeRes
    );
  }

  if (!tokenData || typeof tokenData !== 'object' || Array.isArray(tokenData)) {
    const finalizeRes = await finalizeOperatorFailedDispatch(
      supabase,
      dispatchId,
      'MALFORMED_TOKEN_RESPONSE',
      'Invalid response from token generation RPC.'
    );
    return buildOperatorPreSendFailureResult(
      dispatchId,
      'MALFORMED_TOKEN_RESPONSE',
      'Invalid response from token generation RPC.',
      finalizeRes
    );
  }

  const tokenPayload = tokenData as Record<string, unknown>;

  if (tokenPayload.success !== true) {
    const finalizeRes = await finalizeOperatorFailedDispatch(
      supabase,
      dispatchId,
      'TOKEN_RPC_UNSUCCESSFUL',
      'Token generation RPC reported failure.'
    );
    return buildOperatorPreSendFailureResult(
      dispatchId,
      'TOKEN_RPC_UNSUCCESSFUL',
      'Token generation RPC reported failure.',
      finalizeRes
    );
  }

  // Validate token: exactly 64 hexadecimal characters
  if (
    typeof tokenPayload.token !== 'string' ||
    !TOKEN_HEX_REGEX.test(tokenPayload.token.trim())
  ) {
    const finalizeRes = await finalizeOperatorFailedDispatch(
      supabase,
      dispatchId,
      'INVALID_TOKEN_FORMAT',
      'Malformed location token returned from database.'
    );
    return buildOperatorPreSendFailureResult(
      dispatchId,
      'INVALID_TOKEN_FORMAT',
      'Malformed location token returned from database.',
      finalizeRes
    );
  }
  const token = tokenPayload.token.trim();

  // Validate expires_at: valid timestamp string
  if (
    typeof tokenPayload.expires_at !== 'string' ||
    tokenPayload.expires_at.trim().length === 0 ||
    Number.isNaN(new Date(tokenPayload.expires_at).getTime())
  ) {
    const finalizeRes = await finalizeOperatorFailedDispatch(
      supabase,
      dispatchId,
      'INVALID_EXPIRATION',
      'Invalid expiration timestamp returned from database.'
    );
    return buildOperatorPreSendFailureResult(
      dispatchId,
      'INVALID_EXPIRATION',
      'Invalid expiration timestamp returned from database.',
      finalizeRes
    );
  }

  // Validate relative_path: must match /customer/location/<token> exactly
  const expectedRelativePath = `/customer/location/${token}`;
  if (
    typeof tokenPayload.relative_path !== 'string' ||
    tokenPayload.relative_path !== expectedRelativePath
  ) {
    const finalizeRes = await finalizeOperatorFailedDispatch(
      supabase,
      dispatchId,
      'INVALID_RELATIVE_PATH',
      'Invalid relative path returned from database.'
    );
    return buildOperatorPreSendFailureResult(
      dispatchId,
      'INVALID_RELATIVE_PATH',
      'Invalid relative path returned from database.',
      finalizeRes
    );
  }
  const relativePath = tokenPayload.relative_path;

  // ---------------------------------------------------------------------------
  // STEP 6: ATTACH TOKEN REQUEST TO RESERVED SMS DISPATCH
  // ---------------------------------------------------------------------------
  let attachData: unknown;
  try {
    const { data, error } = await supabase.rpc(
      'attach_customer_location_request_to_sms_dispatch_operator',
      {
        p_dispatch_id: dispatchId,
        p_token: token,
      }
    );

    if (error) {
      const finalizeRes = await finalizeOperatorFailedDispatch(
        supabase,
        dispatchId,
        'ATTACH_REQUEST_FAILED',
        'Failed to attach location request to SMS dispatch.'
      );
      return buildOperatorPreSendFailureResult(
        dispatchId,
        'ATTACH_REQUEST_FAILED',
        'Failed to attach location request to SMS dispatch.',
        finalizeRes
      );
    }
    attachData = data;
  } catch {
    const finalizeRes = await finalizeOperatorFailedDispatch(
      supabase,
      dispatchId,
      'ATTACH_REQUEST_EXCEPTION',
      'Unexpected error occurred while attaching location request to dispatch.'
    );
    return buildOperatorPreSendFailureResult(
      dispatchId,
      'ATTACH_REQUEST_EXCEPTION',
      'Unexpected error occurred while attaching location request to dispatch.',
      finalizeRes
    );
  }

  if (!attachData || typeof attachData !== 'object' || Array.isArray(attachData)) {
    const finalizeRes = await finalizeOperatorFailedDispatch(
      supabase,
      dispatchId,
      'MALFORMED_ATTACH_RESPONSE',
      'Invalid response from dispatch attachment RPC.'
    );
    return buildOperatorPreSendFailureResult(
      dispatchId,
      'MALFORMED_ATTACH_RESPONSE',
      'Invalid response from dispatch attachment RPC.',
      finalizeRes
    );
  }

  const attachPayload = attachData as Record<string, unknown>;
  if (
    attachPayload.success !== true ||
    typeof attachPayload.request_id !== 'string' ||
    !UUID_REGEX.test(attachPayload.request_id.trim())
  ) {
    const finalizeRes = await finalizeOperatorFailedDispatch(
      supabase,
      dispatchId,
      'ATTACH_VALIDATION_FAILED',
      'Dispatch attachment confirmation failed.'
    );
    return buildOperatorPreSendFailureResult(
      dispatchId,
      'ATTACH_VALIDATION_FAILED',
      'Dispatch attachment confirmation failed.',
      finalizeRes
    );
  }

  // ---------------------------------------------------------------------------
  // STEP 7: BUILD CUSTOMER LOCATION URL
  // ---------------------------------------------------------------------------
  let customerUrl: string;
  try {
    customerUrl = buildCustomerLocationUrl(
      process.env.APP_BASE_URL ?? '',
      relativePath
    );
  } catch {
    const finalizeRes = await finalizeOperatorFailedDispatch(
      supabase,
      dispatchId,
      'URL_CONSTRUCTION_FAILED',
      'Invalid APP_BASE_URL configuration.'
    );
    return buildOperatorPreSendFailureResult(
      dispatchId,
      'URL_CONSTRUCTION_FAILED',
      'Invalid APP_BASE_URL configuration.',
      finalizeRes
    );
  }

  const messageBody = `Matos Roadside: Please confirm your breakdown location: ${customerUrl}`;

  // ---------------------------------------------------------------------------
  // STEP 8: SEND TWILIO SMS
  // ---------------------------------------------------------------------------
  let twilioResult: TwilioSendResult;
  try {
    twilioResult = await sendTwilioSms({
      recipientPhone: cleanPhone,
      body: messageBody,
      dispatchId,
    });
  } catch (sendErr: unknown) {
    let safeCode = 'TWILIO_DISPATCH_ERROR';
    let safeMessage = 'Outbound SMS dispatch failed.';

    if (sendErr instanceof TwilioTransportError) {
      safeCode = sendErr.code;
      safeMessage = sendErr.message;
    }

    const finalizeRes = await finalizeOperatorFailedDispatch(
      supabase,
      dispatchId,
      safeCode,
      safeMessage
    );

    return buildOperatorPreSendFailureResult(
      dispatchId,
      safeCode,
      `Twilio SMS dispatch failed: ${safeMessage}`,
      finalizeRes
    );
  }

  // Validate MessageSid
  const messageSid = twilioResult.messageSid.trim();
  if (messageSid.length === 0) {
    const finalizeRes = await finalizeOperatorFailedDispatch(
      supabase,
      dispatchId,
      'EMPTY_MESSAGE_SID',
      'Twilio returned an empty message identifier.'
    );
    return buildOperatorPreSendFailureResult(
      dispatchId,
      'EMPTY_MESSAGE_SID',
      'Twilio returned an empty message identifier.',
      finalizeRes
    );
  }

  // Validate actual Twilio returned status
  const twilioStatus = twilioResult.status.trim();
  if (!PROVIDER_SMS_DISPATCH_STATUSES.has(twilioStatus as SmsDispatchStatus)) {
    return {
      success: false,
      reserved: true,
      dispatchId,
      messageSid,
      errorCode: 'UNSUPPORTED_PROVIDER_STATUS',
      error: 'Twilio returned an unsupported message status.',
    };
  }

  // ---------------------------------------------------------------------------
  // STEP 9: OPERATOR SUCCESS FINALIZATION
  // ---------------------------------------------------------------------------
  try {
    const { data: finalizeData, error: finalizeError } = await supabase.rpc(
      'finalize_customer_location_sms_send_operator',
      {
        p_dispatch_id: dispatchId,
        p_message_sid: messageSid,
        p_status: twilioStatus,
        p_error_code: null,
        p_error_message: null,
      }
    );

    if (finalizeError || !finalizeData || typeof finalizeData !== 'object' || Array.isArray(finalizeData)) {
      return {
        success: false,
        reserved: true,
        dispatchId,
        messageSid,
        errorCode: 'FINALIZATION_FAILED',
        error: 'Failed to record SMS send finalization: database error or malformed response.',
      };
    }

    const finalPayload = finalizeData as Record<string, unknown>;
    if (finalPayload.success !== true) {
      return {
        success: false,
        reserved: true,
        dispatchId,
        messageSid,
        errorCode: 'FINALIZATION_FAILED',
        error: 'Finalization RPC reported failure.',
      };
    }

    if (
      typeof finalPayload.status !== 'string' ||
      !PROVIDER_SMS_DISPATCH_STATUSES.has(finalPayload.status as SmsDispatchStatus)
    ) {
      return {
        success: false,
        reserved: true,
        dispatchId,
        messageSid,
        errorCode: 'FINALIZATION_FAILED',
        error: 'Finalization RPC returned an invalid or unsupported status.',
      };
    }
    const authoritativeStatus = finalPayload.status as SmsDispatchStatus;

    if (twilioStatus !== 'failed') {
      if (
        typeof finalPayload.message_sid !== 'string' ||
        finalPayload.message_sid.trim() !== messageSid
      ) {
        return {
          success: false,
          reserved: true,
          dispatchId,
          messageSid,
          errorCode: 'FINALIZATION_FAILED',
          error: 'Finalization RPC returned an invalid or mismatched MessageSid.',
        };
      }
    } else {
      if (
        finalPayload.message_sid !== undefined &&
        finalPayload.message_sid !== null
      ) {
        if (
          typeof finalPayload.message_sid !== 'string' ||
          finalPayload.message_sid.trim() !== messageSid
        ) {
          return {
            success: false,
            reserved: true,
            dispatchId,
            messageSid,
            errorCode: 'FINALIZATION_FAILED',
            error: 'Finalization RPC returned a mismatched MessageSid.',
          };
        }
      }
    }

    let isDuplicate = false;
    if (finalPayload.is_duplicate !== undefined && finalPayload.is_duplicate !== null) {
      if (typeof finalPayload.is_duplicate !== 'boolean') {
        return {
          success: false,
          reserved: true,
          dispatchId,
          messageSid,
          errorCode: 'FINALIZATION_FAILED',
          error: 'Finalization RPC returned invalid is_duplicate metadata.',
        };
      }
      isDuplicate = finalPayload.is_duplicate;
    }

    return {
      success: true,
      reserved: true,
      isDuplicate,
      dispatchId,
      status: authoritativeStatus,
      messageSid,
    };
  } catch {
    return {
      success: false,
      reserved: true,
      dispatchId,
      messageSid,
      errorCode: 'FINALIZATION_EXCEPTION',
      error: 'Unexpected error during SMS send finalization.',
    };
  }
}
