# Trip Prep invitation links (deployment-ready — not deployed)

## Why invitations are not clickable today

The app builds `tripprep://join/<code>` links because no https invitation host is configured
(`EXPO_PUBLIC_INVITE_HOST` is unset in the EAS `preview` environment). WhatsApp, Google Messages
and most chat apps only turn **http(s)** text into links, so a custom-scheme link shows as plain
text. Nothing in the app can change that: a real https address that belongs to the app is needed.

## What this worker provides (free, no secrets)

- `https://<host>/join/<code>` — the link people tap. With the app installed and the domain
  verified, Android opens Trip Prep directly (App Links). Otherwise this page opens in the browser
  with **Open in Trip Prep** (an `intent://` link that falls back to the page), the code to type into
  **Trips → Join**, and an optional download link.
- `https://<host>/.well-known/assetlinks.json` — proves to Android that the domain belongs to
  `com.sreenathsreesree.tripprep`, so the link opens the app without a chooser.
- Nothing is stored or logged. Joining still happens only when the user taps **Join trip** in the app;
  expiry, revocation and the use limit are checked by the database.

## Setup (owner, ~10 minutes)

1. **Signing fingerprint (public).** `npx eas-cli@latest credentials -p android` → *preview* (or
   production) → Keystore → copy **SHA256 Fingerprint** (`AB:CD:…`). If you later publish on Google
   Play with Play App Signing, also add Play's app-signing key fingerprint (Play Console → App
   integrity), comma-separated.
2. **Deploy** (free Cloudflare account):
   ```bash
   npx wrangler@latest login
   npx wrangler@latest deploy --config server/invite-links/wrangler.toml \
     --var ANDROID_CERT_SHA256:"AB:CD:…" --var APP_DOWNLOAD_URL:"https://expo.dev/…"
   ```
   It prints the host, e.g. `trip-prep-invite.<account>.workers.dev`. (A custom domain works too.)
3. **Check:** open `https://<host>/.well-known/assetlinks.json` (shows the package and fingerprint)
   and `https://<host>/join/abcdefghijklmnop0123` (shows the fallback page).
4. **Configure the app:** in expo.dev → project → Environment variables → `preview` (and
   `production`), add `EXPO_PUBLIC_INVITE_HOST` = the bare host (no `https://`, no path).
5. **Build a new APK.** `app.config.ts` then adds the verified App Link intent filter for
   `https://<host>/join/…`, and new invitations put the https link first, on its own line.
6. **On the phone:** `adb shell pm get-app-links com.sreenathsreesree.tripprep` should list the
   host as `verified`. Send an invitation by WhatsApp and tap it: Trip Prep opens on Join.

Until step 5, invitations still work by code (Trips → Join, paste the message or code), and old
`tripprep:///join/…` links still open the Join screen when tapped where they are clickable.

Tests: `server/invite-links/worker.test.mjs` (assetlinks, fallback page, intent link, rejected
tokens) and `src/features/sharing/__tests__/inviteLinks.test.ts`.
