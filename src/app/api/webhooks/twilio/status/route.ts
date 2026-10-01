/**
 * Matos Systems — Twilio SMS Status Callback Webhook Route
 * Phase 9C Telephony SMS Gateway
 *
 * Receives URL-encoded status callbacks from Twilio, verifies X-Twilio-Signature,
 * and updates the authoritative SMS dispatch status monotonically via
 * public.record_sms_status_callback.
 */

import { createClient } from '@/lib/supabase/server';
import type { SmsDispatchStatus } from '@/types/telephony';
import {
  buildTwilioStatusCallbackUrl,
  validateTwilioWebhookSignature,
} from '@/lib/telephony/twilio-client';
import { VALID_SMS_DISPATCH_STATUSES } from '@/lib/telephony/sms-actions';

export const dynamic = 'force-dynamic';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request): Promise<Response> {
  // 1. Validate required environment configuration
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();
  const statusCallbackBaseUrl = process.env.TWILIO_STATUS_CALLBACK_BASE_URL?.trim();
  const twilioDbSecret = process.env.MATOS_TWILIO_DB_SECRET?.trim();

  if (!authToken || !statusCallbackBaseUrl || !twilioDbSecret) {
    return new Response('Configuration Error', { status: 500 });
  }

  // 2. Extract X-Twilio-Signature header
  const signature = request.headers.get('x-twilio-signature');
  if (!signature) {
    return new Response('Forbidden', { status: 403 });
  }

  // 3. Extract and validate dispatch_id from URL query string
  let dispatchId: string | null = null;
  try {
    const requestUrl = new URL(request.url);
    const rawId = requestUrl.searchParams.get('dispatch_id')?.trim();
    if (rawId && UUID_REGEX.test(rawId)) {
      dispatchId = rawId;
    }
  } catch {
    return new Response('Bad Request', { status: 400 });
  }

  if (!dispatchId) {
    return new Response('Bad Request', { status: 400 });
  }

  // 4. Parse complete URL-encoded form body
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return new Response('Bad Request', { status: 400 });
  }

  // Convert ALL string form entries into params object for signature verification
  const formParams: Record<string, string> = {};
  formData.forEach((value, key) => {
    if (typeof value === 'string') {
      formParams[key] = value;
    }
  });

  // 5. Construct EXPECTED callback URL from TWILIO_STATUS_CALLBACK_BASE_URL and validated dispatch_id
  let expectedUrl: string;
  try {
    expectedUrl = buildTwilioStatusCallbackUrl(statusCallbackBaseUrl, dispatchId);
  } catch {
    return new Response('Bad Request', { status: 400 });
  }

  // 6. Verify X-Twilio-Signature using official Twilio SDK validator
  const isValidSignature = validateTwilioWebhookSignature(
    authToken,
    signature,
    expectedUrl,
    formParams
  );

  if (!isValidSignature) {
    return new Response('Forbidden', { status: 403 });
  }

  // 7. Validate required callback fields
  const messageSid = formParams['MessageSid']?.trim();
  const messageStatus = formParams['MessageStatus']?.trim();
  const errorCode = formParams['ErrorCode']?.trim() || null;
  const errorMessage = formParams['ErrorMessage']?.trim() || null;

  if (!messageSid || messageSid.length === 0) {
    return new Response('Bad Request', { status: 400 });
  }

  if (
    !messageStatus ||
    !VALID_SMS_DISPATCH_STATUSES.has(messageStatus as SmsDispatchStatus)
  ) {
    // Unsupported status: DO NOT mutate database; return HTTP 400 Bad Request
    return new Response('Bad Request', { status: 400 });
  }

  // 8. Record callback monotonically in database via authoritative RPC
  try {
    const supabase = await createClient();

    const { data, error } = await supabase.rpc('record_sms_status_callback', {
      p_integration_secret: twilioDbSecret,
      p_dispatch_id: dispatchId,
      p_message_sid: messageSid,
      p_status: messageStatus,
      p_error_code: errorCode,
      p_error_message: errorMessage,
    });

    if (error) {
      return new Response('Internal Server Error', { status: 500 });
    }

    if (!data || typeof data !== 'object') {
      return new Response('Internal Server Error', { status: 500 });
    }

    const payload = data as Record<string, unknown>;
    if (payload.success !== true) {
      return new Response('Internal Server Error', { status: 500 });
    }

    // Successful mutation OR valid no-op (terminal state, duplicate, older state)
    return new Response(null, { status: 204 });
  } catch {
    return new Response('Internal Server Error', { status: 500 });
  }
}
