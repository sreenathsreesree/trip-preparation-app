# Trip Prep invitation links (reference — not deployed)

Messaging apps only make **https** links tappable, and Android opens an https link in the app only
when the domain proves (via `/.well-known/assetlinks.json`) that it belongs to the app. This worker
provides both, on a free Cloudflare Workers host. Nothing here is billed and no secret is involved.

Until it is deployed, invitations still work: the app sends `tripprep://join/<token>` plus the bare
code, and **Trips → Join** accepts either. Some messaging apps show the custom-scheme link as plain text.

## Deploy (owner's decision)

```bash
# 1. Signing-certificate fingerprint of the EAS Android keystore (public value):
npx eas-cli@latest credentials -p android      # copy "SHA256 Fingerprint"
# 2. Deploy
npx wrangler@latest deploy server/invite-links/worker.mjs --name trip-prep-invite \
  --var ANDROID_CERT_SHA256:"AB:CD:…" --var APP_DOWNLOAD_URL:"https://…"
# 3. Check https://trip-prep-invite.<account>.workers.dev/.well-known/assetlinks.json
```

4. Set `EXPO_PUBLIC_INVITE_HOST=trip-prep-invite.<account>.workers.dev` (hostname only) in the EAS
   `preview`/`production` environments and build. `app.config.ts` then adds a verified App Link
   intent filter for `https://<host>/join/…`, and new invitations use the https link.
5. On a device: `adb shell pm get-app-links com.sreenathsreesree.tripprep` should show the host as
   `verified`.

Tests: `src/features/sharing/__tests__/inviteLinks.test.ts` (link building, encoded tokens, intent
and legacy `tripprep:///join/…` parsing) and `server/invite-links/worker.test.mjs`.
