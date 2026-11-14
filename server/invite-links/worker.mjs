/**
 * Trip Prep invitation links (reference — not deployed).
 *
 * Serves, on one https host (for example a free Cloudflare Workers subdomain):
 *  - /.well-known/assetlinks.json — Android App Links verification, so
 *    https://<host>/join/<token> opens Trip Prep directly once installed.
 *  - /join/<token> — the browser fallback: an "Open in Trip Prep" button
 *    (an intent:// link that falls back to this page if the app is missing),
 *    the code to type into Trips → Join a trip, and where to get the app.
 *
 * The token is only ever echoed back to the person holding it. Nothing is
 * stored or logged; accepting still happens in the app (expiry, revocation
 * and the use limit are enforced by the database when the user taps Join).
 *
 * Environment (not secrets):
 *   ANDROID_CERT_SHA256 — comma-separated SHA-256 signing-certificate
 *     fingerprints (EAS: `eas credentials -p android`), e.g. "AB:CD:…".
 *   APP_DOWNLOAD_URL — optional https link to install the app (internal APK page).
 */
const PACKAGE = 'com.sreenathsreesree.tripprep';
const TOKEN = /^[A-Za-z0-9_-]{16,128}$/;

export function assetLinks(env) {
  const fingerprints = String(env.ANDROID_CERT_SHA256 ?? '')
    .split(',')
    .map((f) => f.trim().toUpperCase())
    .filter((f) => /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(f));
  return [
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: { namespace: 'android_app', package_name: PACKAGE, sha256_cert_fingerprints: fingerprints },
    },
  ];
}

const escape = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function joinPage(token, env, host) {
  const download = /^https:\/\//.test(env.APP_DOWNLOAD_URL ?? '') ? env.APP_DOWNLOAD_URL : null;
  const fallback = encodeURIComponent(`https://${host}/join/${token}?opened=1`);
  const intent = `intent://join/${token}#Intent;scheme=tripprep;package=${PACKAGE};S.browser_fallback_url=${fallback};end`;
  const scheme = `tripprep://join/${token}`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>Join a trip on Trip Prep</title>
<style>body{font-family:system-ui,sans-serif;background:#202832;color:#EEF2F6;margin:0;padding:24px;line-height:1.5}
main{max-width:480px;margin:auto}a.btn{display:block;text-align:center;background:#7FD1B9;color:#14202A;padding:14px;border-radius:12px;font-weight:600;text-decoration:none;margin:16px 0}
code{display:block;background:#2C3744;padding:12px;border-radius:8px;word-break:break-all;user-select:all}small{color:#A9B4C0}</style></head>
<body><main><h1>You’re invited to a trip</h1>
<p>Open this invitation in the Trip Prep app to see the trip and choose whether to join.</p>
<a class="btn" id="open" href="${escape(intent)}">Open in Trip Prep</a>
<p><small>Not on Android Chrome? <a href="${escape(scheme)}" style="color:#7FD1B9">Try this link</a>.</small></p>
<p>If the app doesn’t open, open Trip Prep → Trips → Join, and enter this code:</p><code>${escape(token)}</code>
${download ? `<p>Don’t have Trip Prep yet? <a href="${escape(download)}" style="color:#7FD1B9">Get the app</a>, then come back to this link.</p>` : '<p><small>Don’t have Trip Prep yet? Ask the person who invited you how to install it.</small></p>'}
<p><small>The invitation expires after 7 days and can be cancelled by the trip owner. Nothing happens until you tap Join in the app.</small></p>
</main></body></html>`;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405 });
    if (url.pathname === '/.well-known/assetlinks.json') {
      return new Response(JSON.stringify(assetLinks(env)), { headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=3600' } });
    }
    const match = /^\/join\/([^/]+)\/?$/.exec(url.pathname);
    if (match) {
      let token = '';
      try {
        token = decodeURIComponent(match[1]);
      } catch {
        token = '';
      }
      if (TOKEN.test(token)) {
        return new Response(joinPage(token, env, url.host), {
          headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff' },
        });
      }
      return new Response('This invitation link is not valid. Ask for a new one.', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
    }
    return new Response('Trip Prep invitations', { headers: { 'content-type': 'text/plain; charset=utf-8' } });
  },
};
