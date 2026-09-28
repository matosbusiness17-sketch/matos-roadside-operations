import { createBrowserClient } from '@supabase/ssr';
import { env } from '@/lib/env';

/**
 * Creates a browser-side Supabase client using @supabase/ssr.
 * Safe for client components. Uses public environment variables.
 */
export function createClient() {
  const url = env.supabase.url || 'https://placeholder-project-ref.supabase.co';
  const anonKey = env.supabase.anonKey || 'placeholder-anon-key';

  return createBrowserClient(url, anonKey);
}
