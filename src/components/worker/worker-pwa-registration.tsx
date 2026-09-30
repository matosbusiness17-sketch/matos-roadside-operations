'use client';

import { useEffect } from 'react';

/**
 * Worker PWA Service Worker Registration Component
 * Registers the service worker scoped strictly to '/worker' on mount.
 * Failures are logged non-destructively without throwing uncaught errors.
 */
export function WorkerPwaRegistration() {
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
      return;
    }

    navigator.serviceWorker
      .register('/sw.js', { scope: '/worker' })
      .catch((error) => {
        // Non-destructive: log warning and do not disrupt worker UI or throw
        console.warn('Worker service worker registration failed:', error);
      });
  }, []);

  return null;
}
