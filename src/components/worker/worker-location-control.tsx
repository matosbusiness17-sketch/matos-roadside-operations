'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { publishWorkerLocation } from '@/lib/worker/location-actions';

export function WorkerLocationControl() {
  const [isLocating, setIsLocating] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const isBusy = isLocating || isPublishing;

  const handleShareLocation = () => {
    if (isBusy) return;

    setErrorMessage(null);
    setSuccessMessage(null);

    // Fail-closed offline protection: do NOT acquire or publish GPS while offline
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setErrorMessage(
        'You are offline. Location was not sent or queued. Reconnect and share again.'
      );
      return;
    }

    // 1. Verify browser geolocation exists
    if (typeof window === 'undefined' || !navigator.geolocation) {
      setErrorMessage('Location sharing is not supported by this browser.');
      return;
    }

    // 2. Set locating state
    setIsLocating(true);

    const geoOptions: PositionOptions = {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 30000,
    };

    // 3. Call getCurrentPosition (one-shot acquisition, NOT watchPosition)
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        setIsLocating(false);

        // Guard against becoming offline during coordinate acquisition
        if (typeof navigator !== 'undefined' && !navigator.onLine) {
          setErrorMessage(
            'You are offline. Location was not sent or queued. Reconnect and share again.'
          );
          return;
        }

        setIsPublishing(true);

        try {
          const { latitude, longitude } = position.coords;
          const result = await publishWorkerLocation(latitude, longitude);

          if (result.success) {
            setSuccessMessage('Location shared successfully.');
          } else {
            setErrorMessage(result.error?.message || 'Failed to publish location.');
          }
        } catch {
          setErrorMessage('An unexpected network error occurred while publishing location.');
        } finally {
          setIsPublishing(false);
        }
      },
      (error) => {
        setIsLocating(false);

        switch (error.code) {
          case error.PERMISSION_DENIED:
            setErrorMessage(
              'Location permission is required to share vehicle location. Please enable location permissions in your browser.'
            );
            break;
          case error.POSITION_UNAVAILABLE:
            setErrorMessage('Location information is currently unavailable from your device.');
            break;
          case error.TIMEOUT:
            setErrorMessage('Location request timed out. Please try again.');
            break;
          default:
            setErrorMessage('An error occurred while retrieving location.');
            break;
        }
      },
      geoOptions
    );
  };

  return (
    <div className="rounded border border-slate-200 bg-slate-50/50 p-3 space-y-2 text-xs min-w-0">
      <div className="flex items-center justify-between gap-2 min-w-0">
        <span className="text-[10px] uppercase tracking-wider font-semibold text-slate-600 block">
          Vehicle GPS Telemetry
        </span>
      </div>

      <p className="text-slate-500 text-[11px] break-words">
        Publish current device location to update vehicle position for operations dispatch.
      </p>

      {errorMessage && (
        <div
          role="alert"
          className="rounded-md border border-rose-200 bg-rose-50 p-2.5 text-xs text-rose-800 font-medium break-words"
        >
          {errorMessage}
        </div>
      )}

      {successMessage && (
        <div
          aria-live="polite"
          className="rounded-md border border-emerald-200 bg-emerald-50 p-2.5 text-xs text-emerald-800 font-medium break-words"
        >
          {successMessage}
        </div>
      )}

      {isBusy && (
        <div
          aria-live="polite"
          className="text-center text-xs text-slate-500 font-medium animate-pulse"
        >
          {isLocating ? 'Acquiring GPS position…' : 'Publishing vehicle location…'}
        </div>
      )}

      <Button
        type="button"
        variant="outline"
        onClick={handleShareLocation}
        disabled={isBusy}
        className="w-full min-h-[44px] text-xs font-semibold text-slate-800 border-slate-300 hover:bg-slate-100"
      >
        {isLocating
          ? 'Acquiring position…'
          : isPublishing
          ? 'Publishing…'
          : 'Share current location'}
      </Button>
    </div>
  );
}
