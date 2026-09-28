'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { env } from '@/lib/env';

export interface AuthActionResult {
  error?: string;
  success?: boolean;
  redirectUrl?: string;
}

/**
 * Server Action for authenticating with Email & Password.
 */
export async function signInAction(
  prevState: AuthActionResult | null,
  formData: FormData
): Promise<AuthActionResult> {
  const email = formData.get('email')?.toString().trim();
  const password = formData.get('password')?.toString();
  const redirectTo = formData.get('redirectTo')?.toString() || '';

  if (!email || !password) {
    return { error: 'Please provide both email and password.' };
  }

  if (!env.supabase.isConfigured) {
    return {
      error:
        'Supabase is not configured. Please ensure NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are set in .env.local.',
    };
  }

  try {
    const supabase = await createClient();
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (authError || !authData.user) {
      return { error: authError?.message || 'Invalid email or password.' };
    }

    // Verify user has an active profile and organization
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('role, is_active, organization_id')
      .eq('id', authData.user.id)
      .single();

    if (profileError || !profile) {
      await supabase.auth.signOut();
      return {
        error:
          'No operational profile found for this account. Contact your organization administrator.',
      };
    }

    if (!profile.is_active) {
      await supabase.auth.signOut();
      return {
        error:
          'Your account has been deactivated. Contact your organization administrator.',
      };
    }

    // Determine target surface based on role
    let destination = '/operations';
    if (profile.role === 'worker') {
      destination = '/worker';
    } else if (redirectTo && redirectTo.startsWith('/') && !redirectTo.startsWith('//')) {
      // Validate redirect is allowed for this role
      if (profile.role === 'operator' && redirectTo.startsWith('/admin')) {
        destination = '/operations';
      } else {
        destination = redirectTo;
      }
    }

    return { success: true, redirectUrl: destination };
  } catch (err: unknown) {
    console.error('Sign-in exception:', err);
    return { error: 'An unexpected authentication error occurred. Please try again.' };
  }
}

/**
 * Server Action to sign out current session.
 */
export async function signOutAction(): Promise<void> {
  try {
    const supabase = await createClient();
    await supabase.auth.signOut();
  } catch (error) {
    console.error('Sign out error:', error);
  }

  redirect('/login');
}
