import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * Extends app.json at build time. Identity (name, slug, package, owner,
 * project ID, signing) stays in app.json and is not changed here.
 *
 * When `EXPO_PUBLIC_INVITE_HOST` is set (a bare hostname that serves
 * server/invite-links), Android gets a verified App Link for
 * https://<host>/join/…, so invitation links open Trip Prep directly. Without
 * it, the custom scheme `tripprep://join/…` and code entry keep working.
 */
function inviteHost(raw: string | undefined): string | null {
  const value = (raw ?? '').trim().toLowerCase().replace(/^https:\/\//, '').replace(/\/+$/, '');
  return /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(value) ? value : null;
}

export default ({ config }: ConfigContext): ExpoConfig => {
  const host = inviteHost(process.env.EXPO_PUBLIC_INVITE_HOST);
  const base = config as ExpoConfig;
  if (!host) return base;
  return {
    ...base,
    android: {
      ...base.android,
      intentFilters: [
        ...(base.android?.intentFilters ?? []),
        {
          action: 'VIEW',
          autoVerify: true,
          data: [{ scheme: 'https', host, pathPrefix: '/join/' }],
          category: ['BROWSABLE', 'DEFAULT'],
        },
      ],
    },
  };
};
