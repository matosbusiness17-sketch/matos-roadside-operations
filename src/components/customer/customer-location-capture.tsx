'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { submitCustomerLocation } from '@/lib/customer/location-actions';

interface CustomerLocationCaptureProps {
  token: string;
}

export function CustomerLocationCapture({ token }: CustomerLocationCaptureProps) {
  const [isLocating, setIsLocating] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [reportedAccuracy, setReportedAccuracy] = useState<number | null>(null);

  const isBusy = isLocating || isSubmitting;

  const handleShareLocation = () => {
    if (isBusy || isSuccess) return;

    setErrorMessage(null);

    // 1. Check browser geolocation support
    if (typeof window === 'undefined' || !navigator.geolocation) {
      setErrorMessage('Geolocation is not supported by your browser or device.');
      return;
    }

    // 2. Check online status
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setErrorMessage('You are currently offline. Please check your connection and try again.');
      return;
    }

    setIsLocating(true);

    const geoOptions: PositionOptions = {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 30000,
    };

    // 3. One-shot geolocation acquisition (strictly getCurrentPosition, never watchPosition)
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        setIsLocating(false);

        // Guard against becoming offline during acquisition
        if (typeof navigator !== 'undefined' && !navigator.onLine) {
          setErrorMessage('Network connection lost before location could be submitted. Please reconnect.');
          return;
        }

        setIsSubmitting(true);

        try {
          const { latitude, longitude, accuracy } = position.coords;
          setReportedAccuracy(accuracy);

          const result = await submitCustomerLocation(token, latitude, longitude, accuracy);

          if (result.success) {
            setIsSuccess(true);
          } else {
            setErrorMessage(result.error?.message || 'Failed to submit location.');
          }
        } catch {
          setErrorMessage('A network error occurred while submitting your location. Please try again.');
        } finally {
          setIsSubmitting(false);
        }
      },
      (error) => {
        setIsLocating(false);

        switch (error.code) {
          case error.PERMISSION_DENIED:
            setErrorMessage(
              'Location permission was denied. Please allow location access in your browser settings to share your position.'
            );
            break;
          case error.POSITION_UNAVAILABLE:
            setErrorMessage(
              'Location information is currently unavailable from your device. Please try again or step into an open area.'
            );
            break;
          case error.TIMEOUT:
            setErrorMessage(
              'Location acquisition timed out. Please ensure GPS/location services are enabled and try again.'
            );
            break;
          default:
            setErrorMessage('An error occurred while retrieving your location. Please try again.');
            break;
        }
      },
      geoOptions
    );
  };

  if (isSuccess) {
    return (
      <div className="rounded-lg border border-emerald-200 bg-emerald-50/80 p-5 text-center space-y-3">
        <div className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-emerald-100 text-emerald-700">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h2 className="text-sm font-bold text-emerald-900">
          Location Confirmed
        </h2>
        <p className="text-xs text-emerald-800 leading-relaxed max-w-sm mx-auto">
          Location shared successfully. Roadside operations can now use your confirmed location.
        </p>
        {reportedAccuracy !== null && (
          <p className="text-[11px] font-mono text-emerald-700 pt-1">
            Accuracy reported: ±{Math.round(reportedAccuracy)}m
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <p className="text-xs text-slate-600 leading-relaxed">
          Share your current location so roadside operations can locate you.
        </p>
        <p className="text-[11px] text-slate-500">
          Your browser will request permission for high-accuracy GPS coordinates to pinpoint your breakdown.
        </p>
      </div>

      {errorMessage && (
        <div
          role="alert"
          className="rounded-md border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 font-medium break-words leading-relaxed"
        >
          {errorMessage}
        </div>
      )}

      {isBusy && (
        <div className="text-center py-1 text-xs text-slate-500 font-medium animate-pulse">
          {isLocating ? 'Acquiring GPS coordinates from device…' : 'Submitting confirmed coordinates to dispatch…'}
        </div>
      )}

      <Button
        type="button"
        onClick={handleShareLocation}
        disabled={isBusy}
        className="w-full py-3 px-4 min-h-[48px] text-sm font-semibold rounded-lg shadow-sm bg-blue-600 hover:bg-blue-700 text-white cursor-pointer"
      >
        {isLocating
          ? 'Acquiring location…'
          : isSubmitting
          ? 'Submitting…'
          : 'Share my current location'}
      </Button>
    </div>
  );
}
