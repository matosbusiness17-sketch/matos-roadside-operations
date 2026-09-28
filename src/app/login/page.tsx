import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export const metadata = {
  title: 'Sign In | Matos Systems Roadside',
  description: 'Authentication portal for operators, dispatchers, and field workers.',
};

export default function LoginPage() {
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
              Account Authentication Shell
            </CardTitle>
            <CardDescription className="text-xs">
              Phase 1 structural interface — auth flows disabled
            </CardDescription>
          </CardHeader>
          <CardContent className="p-5 pt-0 space-y-4">
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1" htmlFor="email">
                  Operational Email
                </label>
                <input
                  id="email"
                  type="email"
                  disabled
                  placeholder="operator@matossystems.com"
                  className="w-full rounded border border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-500 cursor-not-allowed focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1" htmlFor="password">
                  Password
                </label>
                <input
                  id="password"
                  type="password"
                  disabled
                  placeholder="••••••••••••"
                  className="w-full rounded border border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-500 cursor-not-allowed focus:outline-none"
                />
              </div>

              <Button disabled className="w-full cursor-not-allowed opacity-60 text-xs">
                Sign In (Phase 2 Auth Required)
              </Button>
            </div>

            <div className="rounded border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600 space-y-2">
              <span className="font-semibold text-slate-800">Phase 1 Architecture Boundary:</span>
              <p className="text-slate-600 leading-normal">
                Supabase Auth flows, role-based session tokens, and membership verification are planned for Phase 2.
              </p>
              <div className="pt-2 border-t border-slate-200 flex flex-col gap-1.5">
                <span className="font-medium text-slate-700">Quick Navigation for Phase 1 Inspection:</span>
                <div className="flex gap-2">
                  <Link href="/operations" className="text-slate-900 font-semibold underline hover:text-slate-700">
                    Operator Workspace →
                  </Link>
                  <span className="text-slate-300">|</span>
                  <Link href="/worker" className="text-slate-900 font-semibold underline hover:text-slate-700">
                    Worker View →
                  </Link>
                </div>
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
