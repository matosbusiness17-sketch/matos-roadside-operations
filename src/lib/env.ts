/**
 * Matos Systems — Environment Configuration
 *
 * Safely accesses and exposes application environment variables.
 * In Phase 2, supports both NEXT_PUBLIC_SUPABASE_ANON_KEY and the modern
 * NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY convention for the client public key.
 * Never exposes server-role or private secret credentials.
 */

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const supabasePublicKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  '';
const mapboxAccessToken = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN ?? '';

export const env = {
  supabase: {
    url: supabaseUrl,
    anonKey: supabasePublicKey,
    isConfigured: Boolean(
      supabaseUrl &&
      supabasePublicKey &&
      !supabaseUrl.includes('placeholder')
    ),
  },
  mapbox: {
    accessToken: mapboxAccessToken,
    isConfigured: Boolean(
      mapboxAccessToken &&
      !mapboxAccessToken.includes('placeholder') &&
      mapboxAccessToken.trim().length > 0
    ),
  },
  app: {
    isProduction: process.env.NODE_ENV === 'production',
    isDevelopment: process.env.NODE_ENV === 'development',
  },
} as const;
