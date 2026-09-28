import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { env } from '@/lib/env';

/**
 * Creates a server-side Supabase client for Server Components, Server Actions,
 * and Route Handlers using @supabase/ssr.
 * Reads cookies from incoming request.
 */
export async function createClient() {
  const cookieStore = await cookies();
  const url = env.supabase.url || 'https://placeholder-project-ref.supabase.co';
  const anonKey = env.supabase.anonKey || 'placeholder-anon-key';

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {
          // The `setAll` method was called from a Server Component.
          // This can be ignored when middleware handles session refresh.
        }
      },
    },
  });
}
