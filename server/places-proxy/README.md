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
   npx wrangler@4 secret put GOOGLE_PLACES_KEY --config server/places-proxy/wrangler.toml
   npx wrangler@4 deploy --config server/places-proxy/wrangler.toml
   ```
5. Set **`EXPO_PUBLIC_PLACES_PROXY_URL`** (the worker's https URL — not a secret) in the EAS
   environments and build. Until it is set, the app never calls Google.

Before deploying, check the endpoints and field names in `worker.mjs` against the current
Places API (New) documentation, and the caching / attribution rules
(`src/features/places/cachePolicy.ts`).

## Exact configuration still missing (checked Nov 2026)

Nothing below exists yet in this repository or its build settings, so **no live Google request has
been made or verified**:

| Item | Where | Status |
|---|---|---|
| Google Cloud project with **Places API (New)** enabled | Google Cloud console | owner to confirm |
| **Billing account** linked to that project, with a budget alert and per-API quotas | Google Cloud console → Billing / Quotas | missing — Google requires it even within the free allowance |
| Server API key restricted to **Places API (New)** only (API restriction). As a server key it has no app restriction; keep it out of the app | Google Cloud console → Credentials | missing |
| `GOOGLE_PLACES_KEY` secret on the worker | `npx wrangler@4 secret put GOOGLE_PLACES_KEY --config server/places-proxy/wrangler.toml` | missing |
| Worker deployed (`trip-prep-places`) | `npx wrangler@4 deploy --config server/places-proxy/wrangler.toml` (needs a Cloudflare token with **Workers Scripts: Edit**) | not deployed |
| `EXPO_PUBLIC_PLACES_PROXY_URL=https://trip-prep-places.<subdomain>.workers.dev` | EAS environment variables (preview / production) | missing |

Until all of these are in place the app uses free open map data (OpenStreetMap) automatically, and
says so honestly when something isn't available. When the proxy answers `not_configured` (deployed
without the key) the app also falls back to open data; quota, network and refusal errors are shown,
never hidden behind other data.

## Endpoints (all POST JSON unless noted)

| Path | Google API (New) | Notes |
|---|---|---|
| `/autocomplete` | `places:autocomplete` | `{ input, sessionToken, bias?, regionCode? }`; the session token groups typing with the one details call after a pick |
| `/details` | `places/{id}` | `{ placeId, sessionToken? }`; adds address components (district, state, locality) and the Plus Code |
| `/nearby` | `places:searchNearby` | `{ location, radiusMeters ≤ 50 km, includedTypes, rankPreference: POPULARITY \| DISTANCE }`, max 20 |
| `/text` | `places:searchText` | `{ query, bias?, radiusMeters?, rankPreference: RELEVANCE \| DISTANCE, pageToken? }` → `nextPageToken` |
| `/resolve-link` | none (no key used) | `{ url }` — only `https://maps.app.goo.gl/…`, `goo.gl/maps/…`, `g.co/kgs/…`; follows at most 6 redirects and only through Google hosts |
| `GET /photo?name=…&maxWidthPx=…` | `…/media` | photos are fetched only when shown |

Tests: `node --test server/places-proxy/worker.test.mjs` (part of `npm run test:cloud`; Google is faked).

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
