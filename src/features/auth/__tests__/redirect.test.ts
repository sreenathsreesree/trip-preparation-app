import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseSupabaseConfig } from '../config';
import { APP_SCHEME, NATIVE_REDIRECT_URL, getRedirectUrl, parseAuthCallback } from '../redirect';

describe('auth redirect', () => {
  it('uses the scheme declared in app.json for the native callback', () => {
    const appJson = JSON.parse(readFileSync(join(__dirname, '../../../../app.json'), 'utf8')) as {
      expo: { scheme: string };
    };
    expect(APP_SCHEME).toBe(appJson.expo.scheme);
    expect(NATIVE_REDIRECT_URL).toBe('tripprep://auth/callback');
  });

  it('builds native and web redirect URLs', () => {
    expect(getRedirectUrl('android')).toBe('tripprep://auth/callback');
    expect(getRedirectUrl('ios')).toBe('tripprep://auth/callback');
    expect(getRedirectUrl('web', 'http://localhost:8081/')).toBe('http://localhost:8081/auth/callback');
    expect(getRedirectUrl('web')).toBe('http://localhost:8081/auth/callback');
  });

  it('reads a PKCE code from the query string', () => {
    expect(parseAuthCallback('tripprep://auth/callback?code=abc-123')).toEqual({ kind: 'code', code: 'abc-123' });
    expect(parseAuthCallback('auth/callback?sb_flow_id=x&code=c%2Fd')).toEqual({ kind: 'code', code: 'c/d' });
  });

  it('reads provider errors from the query string or fragment', () => {
    expect(
      parseAuthCallback('tripprep://auth/callback?error=server_error&error_description=Unable+to+exchange'),
    ).toEqual({ kind: 'error', message: 'Unable to exchange' });
    expect(parseAuthCallback('tripprep://auth/callback#error=invalid_request')).toEqual({
      kind: 'error',
      message: 'invalid_request',
    });
  });

  it('treats a declined Google consent screen as a cancellation', () => {
    expect(parseAuthCallback('tripprep://auth/callback?error=access_denied&error_description=denied')).toEqual({
      kind: 'cancelled',
    });
  });

  it('ignores URLs without a result and malformed escapes', () => {
    expect(parseAuthCallback('tripprep://auth/callback')).toEqual({ kind: 'none' });
    expect(parseAuthCallback('tripprep://auth/callback?code=')).toEqual({ kind: 'none' });
    expect(parseAuthCallback('tripprep://auth/callback?x=%E0%A4%A&code=ok')).toEqual({ kind: 'code', code: 'ok' });
  });
});

describe('Supabase config', () => {
  it('accepts the project URL and a publishable key', () => {
    expect(parseSupabaseConfig(' https://okudcunrqusrzppqnppm.supabase.co/ ', ' sb_publishable_x ')).toEqual({
      url: 'https://okudcunrqusrzppqnppm.supabase.co',
      publishableKey: 'sb_publishable_x',
    });
  });

  it('stays unconfigured (guest-only) when values are missing or unsafe', () => {
    expect(parseSupabaseConfig(undefined, 'sb_publishable_x')).toBeNull();
    expect(parseSupabaseConfig('https://a.supabase.co', '')).toBeNull();
    expect(parseSupabaseConfig('http://a.supabase.co', 'sb_publishable_x')).toBeNull();
    expect(parseSupabaseConfig('https://a.supabase.co', 'sb_secret_abc')).toBeNull();
    expect(parseSupabaseConfig('https://a.supabase.co', 'eyJ...service_role...')).toBeNull();
  });
});
