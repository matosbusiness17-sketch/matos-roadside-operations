/**
 * Matos Systems — Twilio Programmable SMS Transport Client
 * Phase 9C Telephony SMS Gateway
 *
 * Dedicated transport client for outbound SMS dispatch and signature verification.
 * Zero database access, zero Supabase client references, zero service_role.
 */

import 'server-only';
import twilio from 'twilio';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface TwilioConfig {
  accountSid: string;
  authToken: string;
  messagingSender: string;
  statusCallbackBaseUrl: string;
}

export interface SendTwilioSmsParams {
  recipientPhone: string;
  body: string;
  dispatchId: string;
}

export interface TwilioSendResult {
  messageSid: string;
  status: string;
}

export class TwilioTransportError extends Error {
  public readonly code: string;

  constructor(message: string, code = 'TWILIO_SEND_FAILED') {
    super(message);
    this.name = 'TwilioTransportError';
    this.code = code;
  }
}

/**
 * Validates and retrieves server-only Twilio configuration.
 * Fails closed if any required environment variable is missing or blank.
 * Does not fall back or fabricate default senders.
 */
export function getTwilioConfig(): TwilioConfig {
  const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();
  const messagingSender = process.env.TWILIO_MESSAGING_SENDER?.trim();
  const statusCallbackBaseUrl = process.env.TWILIO_STATUS_CALLBACK_BASE_URL?.trim();

  if (!accountSid) {
    throw new Error('TWILIO_ACCOUNT_SID is missing or blank.');
  }
  if (!authToken) {
    throw new Error('TWILIO_AUTH_TOKEN is missing or blank.');
  }
  if (!messagingSender) {
    throw new Error('TWILIO_MESSAGING_SENDER is missing or blank.');
  }
  if (!statusCallbackBaseUrl) {
    throw new Error('TWILIO_STATUS_CALLBACK_BASE_URL is missing or blank.');
  }

  return {
    accountSid,
    authToken,
    messagingSender,
    statusCallbackBaseUrl,
  };
}

/**
 * Constructs the deterministic Twilio status callback URL with attached dispatch_id.
 * Validates dispatch_id as a UUID, requires absolute http: or https: scheme,
 * and sets query parameters using URL / URLSearchParams semantics.
 */
export function buildTwilioStatusCallbackUrl(
  baseUrl: string,
  dispatchId: string
): string {
  const cleanId = dispatchId.trim();
  if (!UUID_REGEX.test(cleanId)) {
    throw new Error('Invalid dispatch ID: must be a valid UUID');
  }

  let url: URL;
  try {
    url = new URL(baseUrl.trim());
  } catch {
    throw new Error('Invalid status callback base URL: must be a valid absolute URL');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Invalid status callback base URL scheme: must be http: or https:');
  }

  url.searchParams.set('dispatch_id', cleanId);
  return url.toString();
}

/**
 * Dispatches an outbound SMS message via the official Twilio SDK.
 * Emits no delivery claims; returns the provider MessageSid and status.
 */
export async function sendTwilioSms(
  params: SendTwilioSmsParams
): Promise<TwilioSendResult> {
  const config = getTwilioConfig();
  const cleanPhone = params.recipientPhone.trim();
  const cleanId = params.dispatchId.trim();

  if (!UUID_REGEX.test(cleanId)) {
    throw new TwilioTransportError('Invalid dispatch ID', 'INVALID_DISPATCH_ID');
  }

  const statusCallback = buildTwilioStatusCallbackUrl(
    config.statusCallbackBaseUrl,
    cleanId
  );

  const client = twilio(config.accountSid, config.authToken);

  try {
    const message = await client.messages.create({
      from: config.messagingSender,
      to: cleanPhone,
      body: params.body,
      statusCallback,
    });

    if (!message.sid || message.sid.trim().length === 0) {
      throw new TwilioTransportError(
        'Twilio returned an empty MessageSid',
        'EMPTY_MESSAGE_SID'
      );
    }

    return {
      messageSid: message.sid.trim(),
      status: message.status,
    };
  } catch (err: unknown) {
    if (err instanceof TwilioTransportError) {
      throw err;
    }

    let safeCode = 'TWILIO_DISPATCH_ERROR';

    if (err && typeof err === 'object') {
      const errObj = err as Record<string, unknown>;
      const rawCode = errObj.code;

      if (
        typeof rawCode === 'number' &&
        Number.isFinite(rawCode) &&
        Number.isInteger(rawCode)
      ) {
        safeCode = String(rawCode);
      } else if (typeof rawCode === 'string' && /^\d{1,8}$/.test(rawCode.trim())) {
        safeCode = rawCode.trim();
      }
    }

    throw new TwilioTransportError('Outbound SMS creation failed', safeCode);
  }
}

/**
 * Verifies the X-Twilio-Signature header on incoming webhook callbacks.
 * Uses official twilio.validateRequest helper with the exact expected absolute URL.
 */
export function validateTwilioWebhookSignature(
  authToken: string,
  signature: string | null | undefined,
  expectedUrl: string,
  params: Record<string, string>
): boolean {
  if (!signature || signature.trim().length === 0) {
    return false;
  }
  if (!authToken || authToken.trim().length === 0) {
    return false;
  }

  try {
    return twilio.validateRequest(authToken.trim(), signature.trim(), expectedUrl, params);
  } catch {
    return false;
  }
}
