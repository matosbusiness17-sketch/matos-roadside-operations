'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { createCustomerLocationRequest } from '@/lib/customer/location-actions';
import { IncidentStatus } from '@/types';

interface CustomerLocationLinkControlProps {
  incidentId: string;
  incidentStatus: IncidentStatus;
}

export function CustomerLocationLinkControl({
  incidentId,
  incidentStatus,
}: CustomerLocationLinkControlProps) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedUrl, setGeneratedUrl] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [isCopied, setIsCopied] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const isTerminal =
    incidentStatus === 'completed' ||
    incidentStatus === 'cancelled' ||
    incidentStatus === 'unable_to_complete';

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

  return (
    <div className="rounded border border-slate-200 bg-slate-50/70 p-4 space-y-3 text-xs">
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
        <div className="rounded border border-slate-200 bg-slate-100 p-2.5 text-xs text-slate-500 italic">
          Location link generation is disabled for terminal incidents ({incidentStatus.replace('_', ' ')}).
        </div>
      ) : (
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
      )}
    </div>
  );
}
