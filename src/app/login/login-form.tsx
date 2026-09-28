'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { env } from '@/lib/env';

interface LoginFormProps {
  initialRedirectTo?: string;
  initialError?: string;
}

export function LoginForm({ initialRedirectTo = '', initialError = '' }: LoginFormProps) {
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>(() => {
    if (initialError === 'admin_required') {
      return 'Access denied: The Administration surface requires an Admin role.';
    }
    if (initialError === 'unauthorized_surface') {
      return 'Access restricted: Field worker accounts cannot access desktop operator surfaces.';
    }
    if (initialError === 'account_inactive') {
      return 'Account deactivated: Contact your organization administrator.';
    }
    return '';
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMessage('');

    if (!email || !password) {
      setErrorMessage('Please provide both email and password.');
      return;
    }

    if (!env.supabase.isConfigured) {
      setErrorMessage(
        'Supabase is not configured. Please ensure NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are set in .env.local.'
      );
      return;
    }

    setLoading(true);

    try {
      const supabase = createClient();
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (error || !data.user) {
        setErrorMessage(error?.message || 'Invalid operational credentials.');
        setLoading(false);
        return;
      }

      // Check operational profile and active status
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('role, is_active')
        .eq('id', data.user.id)
        .single();

      if (profileError || !profile) {
        await supabase.auth.signOut();
        setErrorMessage(
          'No operational profile found for this account. Contact your administrator to run the provisioning script.'
        );
        setLoading(false);
        return;
      }

      if (!profile.is_active) {
        await supabase.auth.signOut();
        setErrorMessage('This user profile is inactive. Contact your administrator.');
        setLoading(false);
        return;
      }

      // Route according to role
      let destination = '/operations';
      if (profile.role === 'worker') {
        destination = '/worker';
      } else if (
        initialRedirectTo &&
        initialRedirectTo.startsWith('/') &&
        !initialRedirectTo.startsWith('//')
      ) {
        if (profile.role === 'operator' && initialRedirectTo.startsWith('/admin')) {
          destination = '/operations';
        } else {
          destination = initialRedirectTo;
        }
      }

      router.push(destination);
      router.refresh();
    } catch (err: unknown) {
      console.error('Sign-in error:', err);
      setErrorMessage('An unexpected authentication error occurred.');
      setLoading(false);
    }
  }

  function fillDemo(demoEmail: string) {
    setEmail(demoEmail);
    setPassword('DemoPassword123!');
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {errorMessage && (
        <div className="rounded border border-rose-200 bg-rose-50/70 p-3 text-xs text-rose-800">
          <span className="font-semibold block mb-0.5">Authentication Error</span>
          {errorMessage}
        </div>
      )}

      {!env.supabase.isConfigured && (
        <div className="rounded border border-amber-200 bg-amber-50/70 p-3 text-xs text-amber-800 space-y-1">
          <span className="font-semibold block">Supabase Connection Required</span>
          <p className="text-[11px] leading-relaxed">
            Local credentials are not configured yet. Copy <code className="font-mono font-semibold">.env.example</code> to <code className="font-mono font-semibold">.env.local</code> and provide your Supabase project URL and anon key to test live authentication.
          </p>
        </div>
      )}

      <div className="space-y-3">
        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1" htmlFor="email">
            Operational Email
          </label>
          <input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="operator@matos.local"
            className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1" htmlFor="password">
            Password
          </label>
          <input
            id="password"
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••••••"
            className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900"
          />
        </div>

        <Button
          type="submit"
          disabled={loading}
          className="w-full text-xs font-semibold"
        >
          {loading ? 'Authenticating...' : 'Sign In'}
        </Button>
      </div>

      {/* Development Provisioning Quick-Fills */}
      <div className="rounded border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600 space-y-2">
        <div className="flex items-center justify-between">
          <span className="font-semibold text-slate-800">Development Demo Accounts</span>
          <Badge variant="outline" className="text-[10px] font-mono">
            Phase 2
          </Badge>
        </div>
        <p className="text-[11px] text-slate-500">
          Once created in your Supabase Auth project (see <code className="font-mono">supabase/seed.sql</code>), click to fill:
        </p>
        <div className="flex flex-wrap gap-1.5 pt-1">
          <button
            type="button"
            onClick={() => fillDemo('admin@matos.local')}
            className="px-2 py-1 rounded border border-slate-200 bg-white hover:bg-slate-100 text-[11px] text-slate-700 cursor-pointer"
          >
            Admin (Alex)
          </button>
          <button
            type="button"
            onClick={() => fillDemo('operator@matos.local')}
            className="px-2 py-1 rounded border border-slate-200 bg-white hover:bg-slate-100 text-[11px] text-slate-700 cursor-pointer"
          >
            Operator (Morgan)
          </button>
          <button
            type="button"
            onClick={() => fillDemo('worker@matos.local')}
            className="px-2 py-1 rounded border border-slate-200 bg-white hover:bg-slate-100 text-[11px] text-slate-700 cursor-pointer"
          >
            Worker (Taylor)
          </button>
        </div>
      </div>
    </form>
  );
}
