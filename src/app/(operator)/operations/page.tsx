import React from 'react';
import Link from 'next/link';
import { getOperationsSnapshot } from '@/lib/operations/data';
import { env } from '@/lib/env';
import { OperationsWorkspace } from '@/components/operations/operations-workspace';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Operations | Matos Systems Roadside',
  description:
    'Database-backed operational mapping workspace with synchronized active incident queue, Mapbox map, and fleet context.',
};

export default async function OperationsPage() {
  const result = await getOperationsSnapshot();

  // If initial load fails, render explicit data-error state (never fake 0 incidents/vehicles)
  if (!result.success) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[460px] p-6 text-center bg-white border border-slate-200 rounded-lg shadow-xs">
        <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center text-red-600 mb-3">
          <svg
            className="w-6 h-6"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
        </div>
        <h2 className="text-base font-semibold text-slate-900 mb-1">
          Operational data unavailable
        </h2>
        <p className="text-xs text-slate-500 max-w-sm mb-4">
          The latest operations snapshot could not be loaded.
        </p>
        <div className="flex items-center gap-3">
          <Link
            href="/operations"
            className="inline-flex items-center px-3.5 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md shadow-2xs transition-colors"
          >
            Retry Loading
          </Link>
          <Link
            href="/incidents"
            className="inline-flex items-center px-3.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-md shadow-2xs transition-colors"
          >
            Go to Incidents
          </Link>
        </div>
      </div>
    );
  }

  return (
    <OperationsWorkspace
      initialSnapshot={result.snapshot}
      mapboxToken={env.mapbox.accessToken}
      isMapboxConfigured={env.mapbox.isConfigured}
    />
  );
}
