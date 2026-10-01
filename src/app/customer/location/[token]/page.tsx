import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { getCustomerLocationRequestStatus } from '@/lib/customer/location-actions';
import { CustomerLocationCapture } from '@/components/customer/customer-location-capture';

interface PageProps {
  params: Promise<{ token: string }>;
}

export const metadata = {
  title: 'Breakdown Location Confirmation | Matos Systems Roadside',
  description: 'Confirm your current breakdown coordinates for dispatch operations.',
};

export default async function CustomerLocationPage({ params }: PageProps) {
  const { token } = await params;

  // Validate token status without exposing operational incident data
  const statusResult = await getCustomerLocationRequestStatus(token);

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-start sm:justify-center items-center p-4 sm:p-6">
      <div className="w-full max-w-md space-y-4">
        {/* Header Branding */}
        <div className="text-center space-y-1">
          <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200">
            Roadside Operations
          </div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900">
            Breakdown Location Confirmation
          </h1>
          <p className="text-xs text-slate-500">
            Direct motorist GPS positioning link
          </p>
        </div>

        {/* State 1: Verification Failure (Network / Infrastructure failure) */}
        {!statusResult.success && (
          <Card className="border-slate-200 shadow-sm bg-white text-center">
            <CardContent className="p-6 space-y-3">
              <div className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-amber-100 text-amber-700 mx-auto">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                  />
                </svg>
              </div>
              <h2 className="text-base font-bold text-slate-900">
                We couldn&apos;t verify this location link.
              </h2>
              <p className="text-xs text-slate-600 leading-relaxed max-w-xs mx-auto">
                Please check your connection and try again. If the problem continues, contact roadside operations.
              </p>
            </CardContent>
          </Card>
        )}

        {/* State 2: Valid Active Token */}
        {statusResult.success && statusResult.status === 'valid' && (
          <Card className="border-slate-200 shadow-sm bg-white">
            <CardHeader className="p-5 pb-3">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-xs font-bold uppercase tracking-wider text-slate-800">
                  Confirm Your Location
                </CardTitle>
                <Badge variant="primary" className="text-[10px]">
                  Active Link
                </Badge>
              </div>
              <CardDescription className="text-xs text-slate-500">
                Single-use interaction for emergency dispatch coordination
              </CardDescription>
            </CardHeader>
            <CardContent className="p-5 pt-2">
              <CustomerLocationCapture token={token} />
            </CardContent>
          </Card>
        )}

        {/* State 3: Consumed / Used Token */}
        {statusResult.success && statusResult.status === 'used' && (
          <Card className="border-slate-200 shadow-sm bg-white text-center">
            <CardContent className="p-6 space-y-3">
              <div className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-slate-100 text-slate-700 mx-auto">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
              </div>
              <h2 className="text-base font-bold text-slate-900">
                Location has already been submitted.
              </h2>
              <p className="text-xs text-slate-600 leading-relaxed max-w-xs mx-auto">
                Your breakdown coordinates have already been received and confirmed by roadside operations. No further action is required.
              </p>
            </CardContent>
          </Card>
        )}

        {/* State 4: Expired / Revoked / Invalid Token */}
        {statusResult.success &&
          (statusResult.status === 'expired' ||
            statusResult.status === 'revoked' ||
            statusResult.status === 'invalid') && (
            <Card className="border-slate-200 shadow-sm bg-white text-center">
              <CardContent className="p-6 space-y-3">
                <div className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-slate-100 text-slate-600 mx-auto">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                    />
                  </svg>
                </div>
                <h2 className="text-base font-bold text-slate-900">
                  This location link is no longer available.
                </h2>
                <p className="text-xs text-slate-600 leading-relaxed max-w-xs mx-auto">
                  This location confirmation link has expired or has been replaced by a newer request. If you need roadside assistance, please contact operations.
                </p>
              </CardContent>
            </Card>
          )}

        {/* Footer */}
        <p className="text-center text-[11px] text-slate-400">
          Matos Systems &bull; Secure Roadside Operations
        </p>
      </div>
    </div>
  );
}
