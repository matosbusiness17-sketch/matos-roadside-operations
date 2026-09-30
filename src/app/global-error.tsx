'use client';

import React from 'react';

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white p-6 rounded-lg border border-slate-200 shadow-xs text-center space-y-4">
          <h2 className="text-lg font-bold text-slate-900">Application Error</h2>
          <p className="text-xs text-slate-600">An unexpected system error occurred.</p>
          <button
            type="button"
            onClick={() => reset()}
            className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 rounded-md hover:bg-blue-700 cursor-pointer"
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
