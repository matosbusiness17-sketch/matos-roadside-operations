import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { LoginForm } from './login-form';

export const metadata = {
  title: 'Sign In | Matos Systems Roadside',
  description: 'Authentication portal for operators, dispatchers, and field workers.',
};

interface LoginPageProps {
  searchParams: Promise<{ redirectTo?: string; error?: string }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const redirectTo = typeof params.redirectTo === 'string' ? params.redirectTo : '';
  const errorParam = typeof params.error === 'string' ? params.error : '';

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col justify-center items-center p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-2">
          <Badge variant="outline" className="text-[10px] uppercase font-mono tracking-widest text-slate-600">
            Operational Access
          </Badge>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            MATOS SYSTEMS
          </h1>
          <p className="text-xs text-slate-500">
            Roadside Assistance Operations & Dispatch System
          </p>
        </div>

        <Card className="border-slate-200 bg-white shadow-sm">
          <CardHeader className="p-5">
            <CardTitle className="text-sm font-semibold text-slate-900">
              Account Authentication
            </CardTitle>
            <CardDescription className="text-xs">
              Sign in with your organization-provisioned operational credentials.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-5 pt-0 space-y-4">
            <LoginForm initialRedirectTo={redirectTo} initialError={errorParam} />

            <div className="pt-2 border-t border-slate-200 flex flex-col gap-1.5 text-xs text-slate-500">
              <span className="font-medium text-slate-700">Explore Without Session:</span>
              <div className="flex gap-2">
                <Link href="/" className="text-slate-900 font-semibold underline hover:text-slate-700">
                  System Index →
                </Link>
                <span className="text-slate-300">|</span>
                <Link href="/customer/location/demo-customer-token-123" className="text-slate-900 font-semibold underline hover:text-slate-700">
                  Customer Link Demo →
                </Link>
              </div>
            </div>
          </CardContent>
        </Card>

        <p className="text-center text-xs text-slate-400">
          Matos Systems — Proprietary Operations Infrastructure
        </p>
      </div>
    </div>
  );
}
