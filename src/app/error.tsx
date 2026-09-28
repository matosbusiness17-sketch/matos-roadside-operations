'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log unexpected runtime error
    console.error('Operational Runtime Exception:', error);
  }, [error]);

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md space-y-4">
        <div className="text-center">
          <Badge variant="destructive" className="font-mono text-xs mb-2">
            Application Error
          </Badge>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">
            Unexpected System Exception
          </h1>
        </div>

        <Card className="border-slate-200 bg-white">
          <CardHeader className="p-5">
            <CardTitle className="text-sm font-semibold text-slate-900">
              Operational Interface Boundary Tripped
            </CardTitle>
            <CardDescription className="text-xs">
              An unhandled runtime error occurred during rendering.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-5 pt-0 space-y-4">
            <div className="rounded border border-rose-200 bg-rose-50/50 p-3 text-xs text-rose-800 space-y-1 font-mono">
              <div className="font-semibold">Message:</div>
              <div className="break-all">{error.message || 'Unknown application error'}</div>
              {error.digest && (
                <div className="text-[10px] text-rose-600 mt-1">Digest: {error.digest}</div>
              )}
            </div>

            <div className="flex gap-2">
              <Button onClick={() => reset()} className="flex-1 text-xs" variant="default">
                Try Again
              </Button>
              <Link href="/operations" className="flex-1">
                <Button className="w-full text-xs" variant="outline">
                  Return to Operations
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
