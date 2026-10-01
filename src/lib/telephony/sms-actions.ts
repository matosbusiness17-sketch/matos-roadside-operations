/**
 * Matos Systems — Automated SMS Location-Link Orchestrator
 * Phase 9C Telephony SMS Gateway
 *
 * Implements the atomic Reserve-Before-Send pattern:
 * 1. reserve_customer_location_sms_integration (duplicate suppression)
 * 2. create_automated_customer_location_request (Phase 8 token reuse)
 * 3. Construct customer GPS confirmation link
 * 4. Send Twilio SMS with statusCallback containing dispatch_id
 * 5. finalize_customer_location_sms_send_integration (monotonic status progression)
 *
 * Uses anon server Supabase client via createClient().
 * Zero service_role, zero raw SQL, zero direct table mutations.
 */

import 'server-only';
import { createClient } from '@/lib/supabase/server';
import type { SmsDispatchStatus } from '@/types/telephony';
import {
  sendTwilioSms,
  TwilioTransportError,
  type TwilioSendResult,
} from './twilio-client';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const E164_REGEX = /^\+[1-9][0-9]{6,14}$/;

const HEX64_REGEX = /^[0-9a-f]{64}$/i;

export const VALID_SMS_DISPATCH_STATUSES: ReadonlySet<SmsDispatchStatus> = new Set([
  'accepted',
  'queued',
  'sending',
  'sent',
  'delivered',
  'undelivered',
  'failed',
]);

export const PROVIDER_SMS_DISPATCH_STATUSES = VALID_SMS_DISPATCH_STATUSES;

export const ALL_SMS_DISPATCH_STATUSES: ReadonlySet<SmsDispatchStatus> = new Set([
  'reserved',
  'accepted',
  'queued',
  'sending',
  'sent',
  'delivered',
  'undelivered',
  'failed',
]);

export interface SendCustomerLocationSmsParams {
  integrationSecret: string;
  incidentId: string;
  recipientPhone: string;
  idempotencyKey: string;
}

export interface SendCustomerLocationSmsResult {
  success: boolean;
  reserved: boolean;
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
 * Helper to record a pre-send dispatch failure in the database.
 * Runtime-validates RPC response and never assumes 'failed' unless confirmed by database.
 */
async function finalizeFailedDispatch(
  supabase: Awaited<ReturnType<typeof createClient>>,
  integrationSecret: string,
  dispatchId: string,
  errorCode: string,
  errorMessage: string
): Promise<{ finalized: boolean; status?: SmsDispatchStatus; errorNote?: string }> {
  try {
    const { data, error } = await supabase.rpc(
      'finalize_customer_location_sms_send_integration',
      {
        p_integration_secret: integrationSecret,
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
 * Helper to construct a consistent pre-send failure result surfacing errorNote when present.
 */
function buildPreSendFailureResult(
  dispatchId: string,
  errorCode: string,
  baseMessage: string,
  finalizeRes: { finalized: boolean; status?: SmsDispatchStatus; errorNote?: string }
): SendCustomerLocationSmsResult {
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
 * Orchestrates sending an automated customer location SMS link using Reserve-Before-Send.
 */
export async function sendCustomerLocationSms(
  params: SendCustomerLocationSmsParams
): Promise<SendCustomerLocationSmsResult> {
  // Input validation
  const cleanSecret = params.integrationSecret?.trim();
  if (!cleanSecret) {
    return {
      success: false,
      reserved: false,
      error: 'Integration secret is required and must be non-empty.',
    };
  }

  const cleanIncidentId = params.incidentId?.trim();
  if (!cleanIncidentId || !UUID_REGEX.test(cleanIncidentId)) {
    return {
      success: false,
      reserved: false,
      error: 'Incident ID must be a valid UUID.',
    };
  }

  const cleanPhone = params.recipientPhone?.trim();
  if (!cleanPhone || !E164_REGEX.test(cleanPhone)) {
    return {
      success: false,
      reserved: false,
      error: 'Recipient phone must be a valid E.164 phone number (e.g. +35699123456).',
    };
  }

  const cleanKey = params.idempotencyKey?.trim();
  if (!cleanKey) {
    return {
      success: false,
      reserved: false,
      error: 'Idempotency key is required and must be non-empty.',
    };
  }

  const supabase = await createClient();

  // ---------------------------------------------------------------------------
  // STEP 1: RESERVE BEFORE SEND
  // ---------------------------------------------------------------------------
  let reserveData: unknown;
  try {
    const { data, error } = await supabase.rpc(
      'reserve_customer_location_sms_integration',
      {
        p_integration_secret: cleanSecret,
        p_incident_id: cleanIncidentId,
        p_idempotency_key: cleanKey,
        p_recipient_phone: cleanPhone,
      }
    );

    if (error) {
      return {
        success: false,
        reserved: false,
        error: 'Failed to reserve SMS dispatch: database authorization or validation failure.',
      };
    }
    reserveData = data;
  } catch {
    return {
      success: false,
      reserved: false,
      error: 'Unexpected error occurred during SMS reservation.',
    };
  }

  if (!reserveData || typeof reserveData !== 'object' || Array.isArray(reserveData)) {
    return {
      success: false,
      reserved: false,
      error: 'Intake service returned an invalid reservation response.',
    };
  }

  const reservePayload = reserveData as Record<string, unknown>;

  // If reservation conflict: stop immediately and return validated existing dispatch status
  if (reservePayload.reserved === false) {
    // Runtime-validate ALL duplicate returned fields
    if (
      typeof reservePayload.dispatch_id !== 'string' ||
      !UUID_REGEX.test(reservePayload.dispatch_id.trim())
    ) {
      return {
        success: false,
        reserved: false,
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
      error: 'Invalid dispatch ID returned by reservation RPC.',
    };
  }

  // ---------------------------------------------------------------------------
  // STEP 2: GENERATE AND ATTACH LOCATION REQUEST
  // ---------------------------------------------------------------------------
  let tokenData: unknown;
  try {
    const { data, error } = await supabase.rpc(
      'create_automated_customer_location_request',
      {
        p_integration_secret: cleanSecret,
        p_incident_id: cleanIncidentId,
        p_dispatch_id: dispatchId,
      }
    );

    if (error) {
      const finalizeRes = await finalizeFailedDispatch(
        supabase,
        cleanSecret,
        dispatchId,
        'TOKEN_GENERATION_FAILED',
        'Failed to generate customer location token.'
      );
      return buildPreSendFailureResult(
        dispatchId,
        'TOKEN_GENERATION_FAILED',
        'Failed to generate customer location token.',
        finalizeRes
      );
    }
    tokenData = data;
  } catch {
    const finalizeRes = await finalizeFailedDispatch(
      supabase,
      cleanSecret,
      dispatchId,
      'TOKEN_GENERATION_EXCEPTION',
      'Unexpected error occurred while generating location token.'
    );
    return buildPreSendFailureResult(
      dispatchId,
      'TOKEN_GENERATION_EXCEPTION',
      'Unexpected error occurred while generating location token.',
      finalizeRes
    );
  }

  if (!tokenData || typeof tokenData !== 'object' || Array.isArray(tokenData)) {
    const finalizeRes = await finalizeFailedDispatch(
      supabase,
      cleanSecret,
      dispatchId,
      'MALFORMED_TOKEN_RESPONSE',
      'Invalid response from token generation RPC.'
    );
    return buildPreSendFailureResult(
      dispatchId,
      'MALFORMED_TOKEN_RESPONSE',
      'Invalid response from token generation RPC.',
      finalizeRes
    );
  }

  const tokenPayload = tokenData as Record<string, unknown>;

  if (tokenPayload.success !== true) {
    const finalizeRes = await finalizeFailedDispatch(
      supabase,
      cleanSecret,
      dispatchId,
      'TOKEN_RPC_UNSUCCESSFUL',
      'Token generation RPC reported failure.'
    );
    return buildPreSendFailureResult(
      dispatchId,
      'TOKEN_RPC_UNSUCCESSFUL',
      'Token generation RPC reported failure.',
      finalizeRes
    );
  }

  // Validate token: exactly 64 hex characters
  if (
    typeof tokenPayload.token !== 'string' ||
    !HEX64_REGEX.test(tokenPayload.token.trim())
  ) {
    const finalizeRes = await finalizeFailedDispatch(
      supabase,
      cleanSecret,
      dispatchId,
      'INVALID_TOKEN_FORMAT',
      'Malformed location token returned from intake service.'
    );
    return buildPreSendFailureResult(
      dispatchId,
      'INVALID_TOKEN_FORMAT',
      'Malformed location token returned from intake service.',
      finalizeRes
    );
  }

  // Validate request_id: valid UUID
  if (
    typeof tokenPayload.request_id !== 'string' ||
    !UUID_REGEX.test(tokenPayload.request_id.trim())
  ) {
    const finalizeRes = await finalizeFailedDispatch(
      supabase,
      cleanSecret,
      dispatchId,
      'INVALID_REQUEST_ID',
      'Invalid request ID returned from intake service.'
    );
    return buildPreSendFailureResult(
      dispatchId,
      'INVALID_REQUEST_ID',
      'Invalid request ID returned from intake service.',
      finalizeRes
    );
  }

  // Validate expires_at: valid timestamp string
  if (
    typeof tokenPayload.expires_at !== 'string' ||
    Number.isNaN(new Date(tokenPayload.expires_at).getTime())
  ) {
    const finalizeRes = await finalizeFailedDispatch(
      supabase,
      cleanSecret,
      dispatchId,
      'INVALID_EXPIRATION',
      'Invalid expiration timestamp returned from intake service.'
    );
    return buildPreSendFailureResult(
      dispatchId,
      'INVALID_EXPIRATION',
      'Invalid expiration timestamp returned from intake service.',
      finalizeRes
    );
  }

  // Validate relative_path: must start with /customer/location/
  if (
    typeof tokenPayload.relative_path !== 'string' ||
    !tokenPayload.relative_path.startsWith('/customer/location/')
  ) {
    const finalizeRes = await finalizeFailedDispatch(
      supabase,
      cleanSecret,
      dispatchId,
      'INVALID_RELATIVE_PATH',
      'Invalid relative path returned from intake service.'
    );
    return buildPreSendFailureResult(
      dispatchId,
      'INVALID_RELATIVE_PATH',
      'Invalid relative path returned from intake service.',
      finalizeRes
    );
  }

  const relativePath = tokenPayload.relative_path;

  // ---------------------------------------------------------------------------
  // STEP 3: BUILD CUSTOMER LOCATION URL
  // ---------------------------------------------------------------------------
  let customerUrl: string;
  try {
    customerUrl = buildCustomerLocationUrl(
      process.env.APP_BASE_URL ?? '',
      relativePath
    );
  } catch {
    const finalizeRes = await finalizeFailedDispatch(
      supabase,
      cleanSecret,
      dispatchId,
      'URL_CONSTRUCTION_FAILED',
      'Invalid APP_BASE_URL configuration.'
    );
    return buildPreSendFailureResult(
      dispatchId,
      'URL_CONSTRUCTION_FAILED',
      'Invalid APP_BASE_URL configuration.',
      finalizeRes
    );
  }

  const messageBody = `Matos Roadside: Please confirm your breakdown location: ${customerUrl}`;

  // ---------------------------------------------------------------------------
  // STEP 4: SEND TWILIO SMS
  // ---------------------------------------------------------------------------
  let twilioResult: TwilioSendResult;
  try {
    twilioResult = await sendTwilioSms({
      recipientPhone: cleanPhone,
      body: messageBody,
      dispatchId,
    });
  } catch (sendErr: unknown) {
    // STEP 5B: TWILIO SEND FAILURE (before reliable MessageSid)
    let safeCode = 'TWILIO_DISPATCH_ERROR';
    let safeMessage = 'Outbound SMS dispatch failed.';

    if (sendErr instanceof TwilioTransportError) {
      safeCode = sendErr.code;
      safeMessage = sendErr.message;
    }

    const finalizeRes = await finalizeFailedDispatch(
      supabase,
      cleanSecret,
      dispatchId,
      safeCode,
      safeMessage
    );

    return buildPreSendFailureResult(
      dispatchId,
      safeCode,
      `Twilio SMS dispatch failed: ${safeMessage}`,
      finalizeRes
    );
  }

  // Validate MessageSid
  const messageSid = twilioResult.messageSid.trim();
  if (messageSid.length === 0) {
    const finalizeRes = await finalizeFailedDispatch(
      supabase,
      cleanSecret,
      dispatchId,
      'EMPTY_MESSAGE_SID',
      'Twilio returned an empty message identifier.'
    );
    return buildPreSendFailureResult(
      dispatchId,
      'EMPTY_MESSAGE_SID',
      'Twilio returned an empty message identifier.',
      finalizeRes
    );
  }

  // Validate actual Twilio returned status:
  // If Twilio returned a valid MessageSid but unsupported status, DO NOT mark failed in database.
  // Leave reservation intact for signed callback to attach MessageSid and advance state authoritatively.
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
  // STEP 5A: SUCCESS FINALIZATION
  // ---------------------------------------------------------------------------
  try {
    const { data: finalizeData, error: finalizeError } = await supabase.rpc(
      'finalize_customer_location_sms_send_integration',
      {
        p_integration_secret: cleanSecret,
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
        error: 'Finalization RPC reported failure.',
      };
    }

    // Require status is a valid provider SmsDispatchStatus; fail closed with zero fallback to twilioStatus
    if (
      typeof finalPayload.status !== 'string' ||
      !PROVIDER_SMS_DISPATCH_STATUSES.has(finalPayload.status as SmsDispatchStatus)
    ) {
      return {
        success: false,
        reserved: true,
        dispatchId,
        messageSid,
        error: 'Finalization RPC returned an invalid or unsupported status.',
      };
    }
    const authoritativeStatus = finalPayload.status as SmsDispatchStatus;

    // Validate message_sid based on twilioStatus contract:
    // When twilioStatus !== 'failed', message_sid must be non-empty and match Twilio MessageSid exactly.
    // When twilioStatus === 'failed', database RPC branch may omit message_sid; if present, it must match.
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
            error: 'Finalization RPC returned a mismatched MessageSid.',
          };
        }
      }
    }

    // Validate is_duplicate: absent -> false; boolean -> use it; any other type -> fail closed
    let isDuplicate = false;
    if (finalPayload.is_duplicate !== undefined && finalPayload.is_duplicate !== null) {
      if (typeof finalPayload.is_duplicate !== 'boolean') {
        return {
          success: false,
          reserved: true,
          dispatchId,
          messageSid,
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
      error: 'Unexpected error during SMS send finalization.',
    };
  }
}
