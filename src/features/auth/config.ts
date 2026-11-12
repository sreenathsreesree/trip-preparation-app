/**
 * Supabase connection settings for Trip Prep, read from the public EXPO_PUBLIC_*
 * environment variables (EAS environment variables for builds, `.env.local` for
 * local development). Both values are designed to be public: they ship inside the
 * app and Row Level Security protects the data. Never put a secret or
 * service-role key here.
 */

export interface SupabaseConfig {
  url: string;
  publishableKey: string;
}

/**
 * Validates raw values. Returns null when either value is missing or malformed,
 * which keeps the app guest-only instead of failing at sign-in.
 */
export function parseSupabaseConfig(
  url: string | undefined,
  publishableKey: string | undefined,
): SupabaseConfig | null {
  const cleanUrl = url?.trim() ?? '';
  const cleanKey = publishableKey?.trim() ?? '';
  if (!/^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)+\/?$/i.test(cleanUrl)) return null;
  if (cleanKey.length === 0) return null;
  // Refuse anything that looks like a server-side key, even if misconfigured.
  if (cleanKey.startsWith('sb_secret_') || cleanKey.includes('service_role')) return null;
  return { url: cleanUrl.replace(/\/$/, ''), publishableKey: cleanKey };
}

// `process.env.EXPO_PUBLIC_*` must be read with literal property access so Expo inlines it.
export const supabaseConfig: SupabaseConfig | null = parseSupabaseConfig(
  process.env.EXPO_PUBLIC_SUPABASE_URL,
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
);

/** Storage key for the persisted auth session (SecureStore keys allow [A-Za-z0-9._-]). */
export const AUTH_STORAGE_KEY = 'tripprep.auth';

/** Secure-storage key of the optional Google Drive connection (journal backup); cleared on sign-out. */
export const DRIVE_STORAGE_KEY = 'tripprep.drive';
