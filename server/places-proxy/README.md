# Trip Prep places proxy (reference — not deployed)

Live Google Places data (recommendations, place search, linking a destination to a Google Place)
goes through this small proxy so that **no Google key is ever shipped in the app**.

Status: **not deployed. Nothing is billed.** The app works fully without it: recommendations and
search say "not set up" and places are added by name (or with coordinates the user enters).

## What is needed (owner's decision and approval)

1. **Google Cloud project** with **Places API (New)** enabled (already done).
2. **Billing account linked to the project.** Google requires billing for Places API (New) even
   inside any free usage allowance. Set a **budget with alerts** and **per-API daily quotas**
   (APIs & Services → Places API (New) → Quotas) before deploying.
3. A **server-side API key** restricted to *Places API (New)* only (API restrictions). It lives
   only in the proxy as a secret.
4. A host for `worker.mjs` — written for **Cloudflare Workers** (free tier):
   ```bash
   npx wrangler@latest secret put GOOGLE_PLACES_KEY
   npx wrangler@latest deploy server/places-proxy/worker.mjs --name trip-prep-places
   ```
5. Set **`EXPO_PUBLIC_PLACES_PROXY_URL`** (the worker's https URL — not a secret) in the EAS
   environments and build. Until it is set, the app never calls Google.

Before deploying, check the endpoints and field names in `worker.mjs` against the current
Places API (New) documentation, and the caching / attribution rules
(`src/features/places/cachePolicy.ts`).

## Cost controls built in

- Fixed field masks (identity, location, address, types, rating, rating count, up to 3 photos,
  Maps link, summary, open-now). No reviews.
- Radius capped at 50 km; at most 20 results; queries capped at 100 characters.
- Photos are fetched only when shown; the app stores only a place's ID, name, address and
  coordinates (coordinates for at most 30 days), never ratings, photos or summaries.
- Recommended next steps once live: per-install rate limiting (Cloudflare rate-limit binding) and
  App Check / Play Integrity.

## Contract with the app

See `src/features/places/proxyProvider.ts`: `POST /nearby`, `POST /text`, `POST /details`,
`POST /autocomplete`, `GET /photo?name=…&maxWidthPx=…`; errors as `{ "error": kind }` where kind is
one of `not_configured`, `quota`, `denied`, `not_found`, `invalid_request`, `network`, `unknown`.
