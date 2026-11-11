/**
 * OAuth redirect handling. Google → Supabase (`/auth/v1/callback`) → our app at
 * `tripprep://auth/callback?code=…` (native) or `<origin>/auth/callback?code=…` (web).
 * Kept free of native imports so it is easy to test.
 */

/** The app's URL scheme. Must equal `expo.scheme` in app.json (checked by a test). */
export const APP_SCHEME = 'tripprep';
export const AUTH_CALLBACK_PATH = 'auth/callback';
export const NATIVE_REDIRECT_URL = `${APP_SCHEME}://${AUTH_CALLBACK_PATH}`;

export function getRedirectUrl(platform: string, webOrigin?: string): string {
  if (platform === 'web') {
    return `${(webOrigin ?? 'http://localhost:8081').replace(/\/$/, '')}/${AUTH_CALLBACK_PATH}`;
  }
  return NATIVE_REDIRECT_URL;
}

export type AuthCallback =
  | { kind: 'code'; code: string }
  | { kind: 'cancelled' }
  | { kind: 'error'; message: string }
  | { kind: 'none' };

function readParams(part: string): Map<string, string> {
  const params = new Map<string, string>();
  for (const pair of part.split('&')) {
    if (!pair) continue;
    const index = pair.indexOf('=');
    const rawKey = index === -1 ? pair : pair.slice(0, index);
    const rawValue = index === -1 ? '' : pair.slice(index + 1);
    try {
      params.set(
        decodeURIComponent(rawKey.replace(/\+/g, ' ')),
        decodeURIComponent(rawValue.replace(/\+/g, ' ')),
      );
    } catch {
      // Ignore malformed escapes; the remaining parameters are still usable.
    }
  }
  return params;
}

/**
 * Reads the result of the OAuth redirect. Supabase puts `code` (PKCE) or
 * `error` / `error_description` in the query string; some providers use the
 * fragment for errors, so both are read. Google's consent-screen "Cancel"
 * arrives as `access_denied` and is treated as a cancellation, not an error.
 */
export function parseAuthCallback(url: string): AuthCallback {
  const hashIndex = url.indexOf('#');
  const beforeHash = hashIndex === -1 ? url : url.slice(0, hashIndex);
  const hash = hashIndex === -1 ? '' : url.slice(hashIndex + 1);
  const queryIndex = beforeHash.indexOf('?');
  const query = queryIndex === -1 ? '' : beforeHash.slice(queryIndex + 1);

  const params = readParams(query);
  for (const [key, value] of readParams(hash)) if (!params.has(key)) params.set(key, value);

  const error = params.get('error') ?? params.get('error_code');
  if (error) {
    if (error === 'access_denied') return { kind: 'cancelled' };
    const description = params.get('error_description');
    return { kind: 'error', message: description && description.trim() ? description : error };
  }
  const code = params.get('code');
  if (code && code.trim()) return { kind: 'code', code: code.trim() };
  return { kind: 'none' };
}
