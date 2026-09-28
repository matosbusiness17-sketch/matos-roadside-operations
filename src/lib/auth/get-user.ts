import { createClient } from '@/lib/supabase/server';
import { Profile, Organization } from '@/types';
import { env } from '@/lib/env';

export interface AuthUserContext {
  user: {
    id: string;
    email: string;
  };
  profile: Profile;
  organization: Organization;
}

/**
 * Server-side helper to retrieve the currently authenticated user
 * along with their database profile and organization.
 * Returns null if unauthenticated, if profile is missing, or if user is inactive.
 */
export async function getCurrentUser(): Promise<AuthUserContext | null> {
  if (!env.supabase.isConfigured) {
    return null;
  }

  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return null;
    }

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('*, organization:organizations(*)')
      .eq('id', user.id)
      .single();

    if (profileError || !profile || !profile.is_active) {
      return null;
    }

    return {
      user: {
        id: user.id,
        email: user.email ?? '',
      },
      profile,
      organization: profile.organization as Organization,
    };
  } catch (error) {
    console.error('Error fetching current user:', error);
    return null;
  }
}
