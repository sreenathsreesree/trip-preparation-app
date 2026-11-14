/**
 * Invitation links.
 *
 * - **https://<invite host>/join/<token>** — the link people tap. Messaging apps
 *   only make http(s) links clickable. On Android, a verified App Link opens
 *   Trip Prep directly; otherwise the host's page (server/invite-links) opens in
 *   the browser and offers "Open in Trip Prep" (an intent:// link with a
 *   download fallback). Used only when `EXPO_PUBLIC_INVITE_HOST` is set at build time.
 * - **tripprep://join/<token>** — the custom-scheme fallback (two slashes:
 *   `Linking.createURL` produced `tripprep:///join/…`, which some handlers drop).
 * - The bare token, which can be pasted into Join a trip.
 */
export const APP_SCHEME = 'tripprep';
export const ANDROID_PACKAGE = 'com.sreenathsreesree.tripprep';

const TOKEN = /^[A-Za-z0-9_-]{16,128}$/;

/** A bare hostname (no scheme, path or port), or null. */
export function inviteHost(raw: string | undefined): string | null {
  const value = (raw ?? '').trim().toLowerCase().replace(/^https:\/\//, '').replace(/\/+$/, '');
  return /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(value) ? value : null;
}

export const configuredInviteHost = inviteHost(process.env.EXPO_PUBLIC_INVITE_HOST);

export type InviteLinks = { token: string; web: string | null; app: string; primary: string };

export function buildInviteLinks(token: string, host: string | null = configuredInviteHost): InviteLinks {
  if (!TOKEN.test(token)) throw new Error('Invalid invitation token.');
  const encoded = encodeURIComponent(token);
  const web = host ? `https://${host}/join/${encoded}` : null;
  const app = `${APP_SCHEME}://join/${encoded}`;
  return { token, web, app, primary: web ?? app };
}

/** The message sent through the share sheet. The https link goes on its own line so messaging apps linkify it. */
export function inviteMessage(tripName: string, links: InviteLinks): string {
  const lines = [`Join my trip “${tripName}” on Trip Prep:`, '', links.primary, ''];
  if (links.web) lines.push(`Already have Trip Prep? This also works: ${links.app}`);
  lines.push(`Or open Trip Prep → Trips → Join a trip and enter this code:`, links.token);
  return lines.join('\n');
}

/** Extracts the token from any invitation link form (https, custom scheme with 2 or 3 slashes, intent://) or a pasted code. */
export function parseInviteToken(input: string): string | null {
  const text = input.trim();
  const match = /(?:^|[/:])join\/([A-Za-z0-9_%-]{16,200})(?:[/?#;\s]|$)/.exec(text) ?? /^([A-Za-z0-9_-]{16,128})$/.exec(text);
  if (!match) {
    const query = /[?&](?:t|token)=([A-Za-z0-9_%-]{16,200})/.exec(text);
    if (!query) return null;
    return decodeToken(query[1] ?? '');
  }
  return decodeToken(match[1] ?? '');
}

function decodeToken(raw: string): string | null {
  let value: string;
  try {
    value = decodeURIComponent(raw);
  } catch {
    return null;
  }
  return TOKEN.test(value) ? value : null;
}

/**
 * Maps an incoming deep link to an app path. Handles `https://<host>/join/<t>`,
 * `tripprep://join/<t>`, the malformed `tripprep:///join/<t>` sent by older
 * versions, and `/join/<t>` paths. Returns null when it is not an invitation.
 */
export function invitePathFor(url: string): string | null {
  if (!/join/.test(url)) return null;
  const token = parseInviteToken(url);
  return token ? `/join/${encodeURIComponent(token)}` : null;
}
