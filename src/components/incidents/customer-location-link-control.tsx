'use client';

import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  createCustomerLocationRequest,
  sendCustomerLocationSmsAction,
} from '@/lib/customer/location-actions';
import { createClient } from '@/lib/supabase/client';
import type { IncidentStatus } from '@/types';
import type { SmsDispatchStatus } from '@/types/telephony';

const E164_REGEX = /^\+[1-9][0-9]{6,14}$/;

interface CustomerLocationLinkControlProps {
  incidentId: string;
  incidentStatus: IncidentStatus;
  customerPhone: string;
}

interface DispatchState {
  id: string;
  incident_id: string;
  recipient_phone: string;
  provider_message_sid: string | null;
  status: SmsDispatchStatus;
  error_code: string | null;
  created_at: string;
  updated_at: string;
}

function isValidIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || value.trim().length === 0) return false;
  const time = new Date(value).getTime();
  return !Number.isNaN(time);
}

function isCompleteDispatchState(data: unknown): data is DispatchState {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  const d = data as Record<string, unknown>;

  if (typeof d.id !== 'string' || d.id.trim().length === 0) return false;
  if (typeof d.incident_id !== 'string' || d.incident_id.trim().length === 0) return false;
  if (typeof d.recipient_phone !== 'string' || d.recipient_phone.trim().length === 0) return false;
  if (typeof d.status !== 'string' || d.status.trim().length === 0) return false;
  if (!isValidIsoDate(d.created_at)) return false;
  if (!isValidIsoDate(d.updated_at)) return false;

  if (
    d.provider_message_sid !== null &&
    d.provider_message_sid !== undefined &&
    typeof d.provider_message_sid !== 'string'
  ) {
    return false;
  }

  if (
    d.error_code !== null &&
    d.error_code !== undefined &&
    typeof d.error_code !== 'string'
  ) {
    return false;
  }

  return true;
}

function getStatusBadgeConfig(status: SmsDispatchStatus): {
  label: string;
  variant: 'default' | 'primary' | 'success' | 'warning' | 'destructive';
} {
  switch (status) {
    case 'reserved':
      return { label: 'Reserved', variant: 'warning' };
    case 'accepted':
      return { label: 'Accepted by provider', variant: 'warning' };
    case 'queued':
      return { label: 'Queued', variant: 'warning' };
    case 'sending':
      return { label: 'Sending', variant: 'primary' };
    case 'sent':
      return { label: 'Sent', variant: 'primary' };
    case 'delivered':
      return { label: 'Delivered', variant: 'success' };
    case 'undelivered':
      return { label: 'Undelivered', variant: 'destructive' };
    case 'failed':
      return { label: 'Failed', variant: 'destructive' };
    default:
      return { label: status, variant: 'default' };
  }
}

export function CustomerLocationLinkControl({
  incidentId,
  incidentStatus,
  customerPhone,
}: CustomerLocationLinkControlProps) {
  // Manual link generation state
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedUrl, setGeneratedUrl] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [isCopied, setIsCopied] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // SMS dispatch state
  const [smsRecipient, setSmsRecipient] = useState(customerPhone || '');
  const [isSendingSms, setIsSendingSms] = useState(false);
  const [smsError, setSmsError] = useState<string | null>(null);
  const inFlightRef = useRef(false);

  // Active / pinned local dispatch state
  const activeDispatchIdRef = useRef<string | null>(null);
  const [activeDispatchId, setActiveDispatchId] = useState<string | null>(null);
  const [dispatch, setDispatch] = useState<DispatchState | null>(null);

  // Keep recipient phone in sync if customerPhone prop changes
  const prevCustomerPhoneRef = useRef(customerPhone);
  useEffect(() => {
    if (customerPhone !== prevCustomerPhoneRef.current) {
      prevCustomerPhoneRef.current = customerPhone;
      setSmsRecipient(customerPhone || '');
    }
  }, [customerPhone]);

  // Reset active tracking when incidentId changes (Requirement 7)
  const prevIncidentIdRef = useRef(incidentId);
  useEffect(() => {
    if (incidentId !== prevIncidentIdRef.current) {
      prevIncidentIdRef.current = incidentId;
      activeDispatchIdRef.current = null;
      setActiveDispatchId(null);
      setDispatch(null);
      setSmsError(null);
      setGeneratedUrl(null);
      setExpiresAt(null);
      setIsCopied(false);
      setErrorMessage(null);
    }
  }, [incidentId]);

  const isTerminal =
    incidentStatus === 'completed' ||
    incidentStatus === 'cancelled' ||
    incidentStatus === 'unable_to_complete';

  // Initial dispatch load for this incident (with race protection for active local send)
  useEffect(() => {
    if (!incidentId) return;

    let isMounted = true;
    const supabase = createClient();

    async function loadInitialDispatch() {
      try {
        const { data, error } = await supabase
          .from('customer_location_sms_dispatches')
          .select(
            'id, incident_id, recipient_phone, provider_message_sid, status, error_code, created_at, updated_at'
          )
          .eq('incident_id', incidentId)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (!isMounted) return;

        if (!error && data && isCompleteDispatchState(data)) {
          const loaded = data;
          setDispatch((prev) => {
            // Race protection: do not overwrite an active send that began while in flight
            if (activeDispatchIdRef.current && loaded.id !== activeDispatchIdRef.current) {
              return prev;
            }

            if (prev) {
              // Same dispatch ID: do not regress newer timestamp
              if (prev.id === loaded.id) {
                if (
                  isValidIsoDate(prev.updated_at) &&
                  isValidIsoDate(loaded.updated_at) &&
                  new Date(prev.updated_at).getTime() > new Date(loaded.updated_at).getTime()
                ) {
                  return prev;
                }
                return loaded;
              }

              // Different dispatch ID: only replace if loaded is newer
              if (
                isValidIsoDate(prev.created_at) &&
                isValidIsoDate(loaded.created_at) &&
                new Date(prev.created_at).getTime() >= new Date(loaded.created_at).getTime()
              ) {
                return prev;
              }
            }
            return loaded;
          });
        }
      } catch {
        // Non-destructive: read failure does not interrupt operator workflow
      }
    }

    void loadInitialDispatch();

    return () => {
      isMounted = false;
    };
  }, [incidentId]);

  // Realtime subscription for live delivery state updates
  useEffect(() => {
    if (!incidentId) return;

    const supabase = createClient();
    const channel = supabase
      .channel(`customer_location_sms_control_${incidentId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'customer_location_sms_dispatches',
          filter: `incident_id=eq.${incidentId}`,
        },
        (payload) => {
          const newRow = payload.new as Partial<DispatchState> | null;
          if (!newRow || typeof newRow !== 'object' || !newRow.id) return;

          setDispatch((prev) => {
            // Case 1: active dispatch is pinned
            if (activeDispatchIdRef.current) {
              // If event row ID is NOT the active ID, ignore it
              if (newRow.id !== activeDispatchIdRef.current) {
                return prev;
              }

              // Event row ID matches active ID:
              if (prev && prev.id === newRow.id) {
                // Defensive timestamp check: do not regress if prev updated_at is newer
                if (
                  isValidIsoDate(prev.updated_at) &&
                  isValidIsoDate(newRow.updated_at) &&
                  new Date(prev.updated_at).getTime() > new Date(newRow.updated_at).getTime()
                ) {
                  return prev;
                }

                // Merge safely
                return {
                  ...prev,
                  ...newRow,
                  provider_message_sid:
                    newRow.provider_message_sid !== undefined
                      ? newRow.provider_message_sid
                      : prev.provider_message_sid,
                  error_code:
                    newRow.error_code !== undefined
                      ? newRow.error_code
                      : prev.error_code,
                } as DispatchState;
              }

              // No existing same-ID dispatch in state:
              // Only accept as brand new DispatchState if ALL required fields are present and valid
              if (isCompleteDispatchState(newRow)) {
                return newRow;
              }

              // Incomplete payload without existing row: do not fabricate
              return prev;
            }

            // Case 2: No active local dispatch (viewing latest historical)
            if (prev) {
              if (prev.id === newRow.id) {
                if (
                  isValidIsoDate(prev.updated_at) &&
                  isValidIsoDate(newRow.updated_at) &&
                  new Date(prev.updated_at).getTime() > new Date(newRow.updated_at).getTime()
                ) {
                  return prev;
                }
                return {
                  ...prev,
                  ...newRow,
                  provider_message_sid:
                    newRow.provider_message_sid !== undefined
                      ? newRow.provider_message_sid
                      : prev.provider_message_sid,
                  error_code:
                    newRow.error_code !== undefined
                      ? newRow.error_code
                      : prev.error_code,
                } as DispatchState;
              }

              // Event is for a different dispatch ID: check if it's strictly newer
              if (
                isValidIsoDate(prev.created_at) &&
                isValidIsoDate(newRow.created_at) &&
                new Date(newRow.created_at).getTime() > new Date(prev.created_at).getTime() &&
                isCompleteDispatchState(newRow)
              ) {
                return newRow;
              }

              return prev;
            }

            // No prev exists at all:
            if (isCompleteDispatchState(newRow)) {
              return newRow;
            }

            return prev;
          });
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [incidentId]);

  const handleGenerateLink = async () => {
    if (isGenerating || isTerminal) return;

    setErrorMessage(null);
    setIsCopied(false);
    setIsGenerating(true);

    try {
      const result = await createCustomerLocationRequest(incidentId);

      if (!result.success || !result.token) {
        setErrorMessage(
          result.error?.message || 'Failed to generate customer location link.'
        );
        return;
      }

      const origin = typeof window !== 'undefined' ? window.location.origin : '';
      const fullUrl = `${origin}/customer/location/${result.token}`;

      setGeneratedUrl(fullUrl);
      setExpiresAt(result.expiresAt || null);
    } catch {
      setErrorMessage('An unexpected network error occurred while generating the link.');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCopyLink = async () => {
    if (!generatedUrl) return;

    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(generatedUrl);
        setIsCopied(true);
        setTimeout(() => setIsCopied(false), 3000);
      }
    } catch {
      setErrorMessage('Failed to copy to clipboard automatically. Please copy the link manually.');
    }
  };

  const handleSendSms = async () => {
    if (inFlightRef.current || isSendingSms || isTerminal) return;

    const cleanPhone = smsRecipient.trim();
    if (!cleanPhone || !E164_REGEX.test(cleanPhone)) {
      setSmsError(
        'Recipient phone must be a valid international E.164 phone number (e.g. +35699123456).'
      );
      return;
    }

    inFlightRef.current = true;
    setIsSendingSms(true);
    setSmsError(null);

    try {
      const idempotencyKey = `operator:${incidentId}:${crypto.randomUUID()}`;
      const result = await sendCustomerLocationSmsAction(
        incidentId,
        cleanPhone,
        idempotencyKey
      );

      if (!result.success) {
        setSmsError(result.error || 'Failed to dispatch location link via SMS.');
      }

      // Requirement 3: If a new reservation occurred (reserved === true),
      // previous active unused location tokens for this incident were revoked.
      // Clear manual link display immediately.
      // (If result.reserved === false [duplicate reservation], do NOT clear manual link).
      if (result.reserved === true) {
        setGeneratedUrl(null);
        setExpiresAt(null);
        setIsCopied(false);
      }

      // Requirement 4: Pin returned dispatchId as active send even if success is false
      if (result.dispatchId) {
        activeDispatchIdRef.current = result.dispatchId;
        setActiveDispatchId(result.dispatchId);

        // Requirement 1: Authoritatively load the returned dispatch row from database
        // Do NOT construct a fake DispatchState with browser timestamps or invented 'reserved' status.
        try {
          const supabase = createClient();
          const { data, error } = await supabase
            .from('customer_location_sms_dispatches')
            .select(
              'id, incident_id, recipient_phone, provider_message_sid, status, error_code, created_at, updated_at'
            )
            .eq('id', result.dispatchId)
            .eq('incident_id', incidentId)
            .maybeSingle();

          if (!error && data && isCompleteDispatchState(data)) {
            const loaded = data;
            setDispatch((prev) => {
              // Defensive check: if prev exists and has same dispatch ID,
              // do NOT regress if prev.updated_at is newer than loaded.updated_at
              if (prev && prev.id === loaded.id) {
                if (
                  isValidIsoDate(prev.updated_at) &&
                  isValidIsoDate(loaded.updated_at) &&
                  new Date(prev.updated_at).getTime() > new Date(loaded.updated_at).getTime()
                ) {
                  return prev;
                }
              }
              return loaded;
            });
          }
        } catch {
          // Non-fatal: do not fabricate a fake row
        }
      }
    } catch {
      setSmsError('An unexpected network error occurred while dispatching SMS.');
    } finally {
      inFlightRef.current = false;
      setIsSendingSms(false);
    }
  };

  const renderDispatchCard = () => {
    // Show neutral message if active dispatch is pinned but its row is not yet loaded
    if (activeDispatchId && (!dispatch || dispatch.id !== activeDispatchId)) {
      return (
        <div className="rounded border border-slate-200 bg-white p-3 text-xs text-slate-500 italic flex items-center justify-between">
          <span>Awaiting authoritative SMS delivery status…</span>
          <span className="font-mono text-[10px] text-slate-400">ID: {activeDispatchId.slice(0, 8)}…</span>
        </div>
      );
    }

    if (!dispatch) return null;

    const badgeConfig = getStatusBadgeConfig(dispatch.status);
    const isFailure = dispatch.status === 'failed' || dispatch.status === 'undelivered';

    return (
      <div className="rounded border border-slate-200 bg-white p-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold text-slate-800">
              SMS Delivery Status
            </span>
            <Badge variant={badgeConfig.variant} className="text-[10px]">
              {badgeConfig.label}
            </Badge>
          </div>
          <span className="text-[10px] font-mono text-slate-400">
            {new Date(dispatch.updated_at || dispatch.created_at).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
            })}
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] text-slate-600">
          <div>
            <span className="text-slate-400">Recipient: </span>
            <span className="font-mono font-medium text-slate-800">
              {dispatch.recipient_phone}
            </span>
          </div>
          {dispatch.provider_message_sid && (
            <div>
              <span className="text-slate-400">Message SID: </span>
              <span className="font-mono text-[10px] text-slate-700">
                {dispatch.provider_message_sid}
              </span>
            </div>
          )}
        </div>

        {isFailure && (
          <div
            role="alert"
            className="rounded border border-rose-200 bg-rose-50 p-2 text-[11px] text-rose-800 font-medium space-y-0.5"
          >
            <p>
              {dispatch.status === 'failed'
                ? 'SMS dispatch failed. Please verify the recipient number or resend.'
                : 'Carrier reported message as undelivered.'}
            </p>
            {/* Error Code label */}
            {dispatch.error_code && (
              <p className="font-mono text-[10px] text-rose-700">
                Error Code: {dispatch.error_code}
              </p>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="rounded border border-slate-200 bg-slate-50/70 p-4 space-y-3 text-xs">
      {/* Section Header */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-bold uppercase tracking-wider text-slate-700">
          Motorist Location Link Generation
        </span>
        <Badge variant="outline" className="text-[10px] font-mono">
          Single-Use GPS
        </Badge>
      </div>

      <p className="text-slate-600 text-xs leading-relaxed">
        Generate a secure, single-use web link for the motorist to pinpoint their breakdown coordinates via mobile GPS.
      </p>

      {isTerminal ? (
        <div className="space-y-3">
          <div className="rounded border border-slate-200 bg-slate-100 p-2.5 text-xs text-slate-500 italic">
            Location link generation and SMS dispatch are disabled for terminal incidents ({incidentStatus.replace('_', ' ')}).
          </div>
          {renderDispatchCard()}
        </div>
      ) : (
        <div className="space-y-4">
          {/* Manual Web Link Flow */}
          <div className="space-y-3">
            {errorMessage && (
              <div
                role="alert"
                className="rounded-md border border-rose-200 bg-rose-50 p-2.5 text-xs text-rose-800 font-medium break-words"
              >
                {errorMessage}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleGenerateLink}
                disabled={isGenerating}
                className="cursor-pointer font-medium text-xs bg-white hover:bg-slate-50"
              >
                {isGenerating ? 'Generating Link…' : 'Generate customer location link'}
              </Button>
              <span className="text-[11px] text-slate-400">
                (Invalidates any previous active link)
              </span>
            </div>

            {generatedUrl && (
              <div className="mt-3 rounded border border-blue-200 bg-blue-50/60 p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold text-blue-900">
                    Active Motorist Location Link
                  </span>
                  {expiresAt && (
                    <span className="text-[10px] font-mono text-blue-700">
                      Expires: {new Date(expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  )}
                </div>

                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={generatedUrl}
                    className="flex-1 rounded border border-blue-300 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-800 focus:outline-hidden"
                    onClick={(e) => (e.target as HTMLInputElement).select()}
                  />
                  <Button
                    type="button"
                    size="sm"
                    onClick={handleCopyLink}
                    className="shrink-0 cursor-pointer text-xs bg-blue-600 hover:bg-blue-700 text-white"
                  >
                    {isCopied ? 'Copied!' : 'Copy Link'}
                  </Button>
                </div>

                <p className="text-[11px] text-blue-800">
                  Share this link directly with the customer. Once coordinates are submitted, the link is permanently consumed and the incident map updates automatically.
                </p>
              </div>
            )}
          </div>

          {/* Separator to SMS Gateway Control */}
          <div className="border-t border-slate-200 pt-3 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-700">
                Send Location Link via SMS
              </span>
              <Badge variant="outline" className="text-[10px] font-mono">
                Twilio Gateway
              </Badge>
            </div>

            <p className="text-slate-600 text-xs leading-relaxed">
              Dispatch a fresh secure location link directly to the motorist via SMS. Delivery status updates in real time.
            </p>

            {smsError && (
              <div
                role="alert"
                className="rounded-md border border-rose-200 bg-rose-50 p-2.5 text-xs text-rose-800 font-medium break-words"
              >
                {smsError}
              </div>
            )}

            <div className="space-y-1.5">
              <label
                htmlFor="sms-recipient-input"
                className="block text-[11px] font-semibold text-slate-700"
              >
                SMS recipient
              </label>
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                <input
                  id="sms-recipient-input"
                  type="tel"
                  value={smsRecipient}
                  onChange={(e) => {
                    setSmsRecipient(e.target.value);
                    if (smsError) setSmsError(null);
                  }}
                  disabled={isSendingSms || isTerminal}
                  placeholder="+35699123456"
                  className="flex-1 rounded border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-800 focus:outline-hidden focus:border-blue-500 disabled:bg-slate-100 disabled:text-slate-400"
                />
                <Button
                  type="button"
                  size="sm"
                  onClick={handleSendSms}
                  disabled={isSendingSms || isTerminal || !smsRecipient.trim()}
                  className="shrink-0 cursor-pointer font-medium text-xs bg-blue-600 hover:bg-blue-700 text-white disabled:bg-slate-200 disabled:text-slate-400"
                >
                  {isSendingSms ? 'Sending SMS…' : 'Send location link via SMS'}
                </Button>
              </div>
              <p className="text-[11px] text-slate-500">
                Use international E.164 format, e.g. +35699123456
              </p>
            </div>

            {renderDispatchCard()}
          </div>
        </div>
      )}
    </div>
  );
}
