/**
 * Matos Systems — Telephony & Voice Intake Types
 * Phase 9 Domain Type Definitions
 */

import type { ServiceType, IncidentPriority, IncidentStatus } from './index';

export type TelephonyIntegrationProvider = 'vapi' | 'twilio';

export type SmsDispatchStatus =
  | 'reserved'
  | 'accepted'
  | 'queued'
  | 'sending'
  | 'sent'
  | 'delivered'
  | 'undelivered'
  | 'failed';

export interface OrganizationIntegration {
  id: string;
  organization_id: string;
  provider: TelephonyIntegrationProvider;
  integration_token_hash: string;
  inbound_phone_number: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CustomerLocationSmsDispatch {
  id: string;
  organization_id: string;
  incident_id: string;
  request_id: string | null;
  idempotency_key: string;
  recipient_phone: string;
  sender_id: string;
  provider_message_sid: string | null;
  status: SmsDispatchStatus;
  error_code: string | null;
  error_message: string | null;
  dispatched_by: string | null;
  created_at: string;
  updated_at: string;
}

export type ReserveSmsResult =
  | {
      reserved: true;
      dispatch_id: string;
    }
  | {
      reserved: false;
      dispatch_id: string;
      existing_status: SmsDispatchStatus;
      message_sid: string | null;
      error?: string;
    };

export interface FinalizeSmsSendResult {
  success: boolean;
  status?: SmsDispatchStatus;
  message_sid?: string;
  is_duplicate?: boolean;
  reason?: string;
  error?: string;
}

export interface VoiceIntakeIncidentParams {
  customerName: string;
  customerPhone: string;
  locationAddress: string;
  serviceType?: ServiceType;
  priority?: IncidentPriority;
  notes?: string;
  vehicleMake?: string;
  vehicleModel?: string;
  vehicleYear?: number;
  vehicleColor?: string;
  vehicleRegistration?: string;
}

export interface VoiceIntakeIncidentResult {
  success: boolean;
  incident_id?: string;
  reference_number?: string;
  status?: IncidentStatus;
  is_duplicate?: boolean;
  error?: string;
}

export interface VapiToolCallFunction {
  name: string;
  arguments: Record<string, unknown>;
}

export interface VapiToolCallItem {
  id: string;
  type: 'function';
  function: VapiToolCallFunction;
}

export interface VapiToolResultItem {
  toolCallId: string;
  result?: string;
  error?: string;
}

export interface VapiWebhookToolCallsPayload {
  message: {
    type: 'tool-calls';
    call?: {
      id: string;
      phoneNumberId?: string;
      assistantId?: string;
    };
    toolCallList?: VapiToolCallItem[];
    toolCalls?: VapiToolCallItem[];
  };
}

export interface VapiWebhookResponse {
  results: VapiToolResultItem[];
}
