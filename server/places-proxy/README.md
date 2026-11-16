# Trip Prep places proxy — Google Places with a controlled budget

Status: **not deployed. No billing, no Google key, no Cloudflare resources.** Until Stage B is
approved and carried out, the app uses free OpenStreetMap search everywhere.

> **This is an internal cost control, not a billing ceiling.** The proxy estimates cost per request
> and blocks Google calls at the ₹70 internal allowance, but Google's invoice decides what is
> actually charged (exchange rate, taxes, price changes, requests made outside this proxy, and any
> difference between Google's SKU classification and ours). Google Cloud budgets only send alerts;
> they do not stop spending. Daily API quotas (Stage B, step 6) are an additional hard limit.

## How it works

```
App ──(debounced, session token)──► Proxy (Cloudflare Worker)
                                     │ 1. Google switched on? endpoint allowed? key present?
                                     │ 2. Budget & pricing config valid and verified?
                                     │ 3. SKU from endpoint + field mask (unknown → refuse)
                                     │ 4. Durable Object "PlacesBudget": atomic check + reserve
                                     │    (monthly ₹70 allowance, daily limits) — refuse if over
                                     │ 5. Google request; outcome recorded; never refunded
                                     ▼
                               places.googleapis.com
Refusals return { error, code } (e.g. budget_exhausted / GOOGLE_BUDGET_EXHAUSTED); the app then
uses free map data for a while (no retry loop) and shows the reason under Profile → Data sources.
```

| Endpoint | Google API | In this rollout |
|---|---|---|
| `POST /autocomplete` | Autocomplete (New) | **on** — session token required |
| `POST /details` | Place Details (New) | **on** — Essentials fields only; `displayName` (Pro) only when the app has no name |
| `POST /resolve-link` | none (follows a Maps short link) | on — free, no key, no budget |
| `POST /nearby`, `POST /text`, `GET /photo` | Nearby / Text Search / Photos | **off** — refused, recommendations use free data |
| `GET /admin/usage` | — | protected by `ADMIN_TOKEN` |

Files: `worker.mjs` (routes), `budget.mjs` (SKU classification, pricing, ledger, Durable Object),
`wrangler.toml` (bindings, variables), tests `budget.test.mjs` and `worker.test.mjs`
(`npm run test:cloud`).

### Cost model (conservative by design)

- Every Autocomplete request is counted at the *Autocomplete Requests* SKU. Google bills only
  the first 12 per session that ends in a Place Details call (the rest are *Session Usage*, free),
  so real cost is lower; we never count on that.
- Place Details is classified from the exact field mask, at the highest tier of any field:
  IDs Only → Essentials → Pro → Enterprise → Enterprise + Atmosphere. Unknown field → refused.
- Free monthly usage caps are **not** subtracted.
- `INR per request = USD per 1000 ÷ 1000 × usdToInr × (1 + fxBufferPct%) × (1 + taxPct%)`.
- Reservations are made **before** each Google call and are never refunded, even if Google fails.

With the default (global list, ₹90/USD, +10 % FX buffer, +18 % GST):

| SKU | USD / 1000 (list) | ≈ ₹ per request (estimate) |
|---|---|---|
| Autocomplete Requests | 2.83 | 0.33 |
| Place Details Essentials | 5.00 | 0.58 |
| Place Details Pro | 17.00 | 1.99 |
| Place Details Enterprise | 20.00 | 2.34 |
| Enterprise + Atmosphere | 25.00 | 2.92 |

A typical pick (≈4 Autocomplete requests + 1 Essentials details) ≈ ₹1.91 → the ₹70 allowance
covers ≈ 36 picks a month on these numbers. Google's **India price list** (for Indian billing
accounts) is lower — about $0.85 (Autocomplete) and $1.50 (Essentials) per 1000 as last seen in
search results of Google's India pricing page — which would allow ≈ 120 picks. Neither figure is
verified here: the proxy refuses Google until you confirm the prices (Stage A, step 4).

## Stage A — Preparation (no billing, nothing deployed)

1. **Google Cloud project** (existing Trip Prep project). IAM you need on it:
   *Service Usage Admin* (enable APIs, quotas), *API Keys Admin* (create/restrict keys);
   on the billing account (Stage B only): *Billing Account User* to link, *Billing Account
   Costs Manager* for budgets.
2. **API needed:** *Places API (New)* only (`places.googleapis.com`). Not the legacy Places API,
   not Maps JavaScript, not Geocoding.
3. **Key restrictions (Stage B):** API restriction = *Places API (New)* only. It is a server key
   used from Cloudflare, so no Android/iOS app restriction applies; never put it in the app.
4. **Verify pricing** for the billing account's country:
   - Global list: https://developers.google.com/maps/billing-and-pricing/pricing
   - India list: https://developers.google.com/maps/billing-and-pricing/pricing-india
   - SKU field tiers: https://developers.google.com/maps/billing-and-pricing/sku-details/places
   - Session pricing: https://developers.google.com/maps/documentation/places/web-service/session-pricing
   Put the confirmed prices, today's `usdToInr`, buffer and tax into `PLACES_PRICING` in
   `wrangler.toml`, and set `"verifiedOn": "YYYY-MM-DD"`. With `verifiedOn: null` (as committed)
   every Google call is refused (`GOOGLE_BUDGET_CONFIG_INVALID`).
5. **Budget settings** (`wrangler.toml` `[vars]`): `BUDGET_TOTAL_INR=100`,
   `BUDGET_ALLOWANCE_INR=70`, `BUDGET_RESERVE_INR=30` (allowance + reserve may not exceed the total;
   the proxy never spends the reserve), `BILLING_TIMEZONE=America/Los_Angeles` (Google Cloud
   Billing's reporting time zone), `DAILY_LIMITS={"autocomplete_request":120,"details":30}`.
6. **Cloudflare:** Workers free plan with SQLite-backed Durable Objects. `wrangler.toml` already
   declares the `PLACES_BUDGET` binding and the `v1` migration (`new_sqlite_classes`); they are
   created only by a deploy. Deploying needs a token with **Workers Scripts: Edit** (the current
   token lacks it).
7. **Secrets** (never in git): `GOOGLE_PLACES_KEY`, `ADMIN_TOKEN` (≥ 32 random characters).
   Variables (not secret): the `[vars]` above. App: `EXPO_PUBLIC_PLACES_PROXY_URL` (EAS).
8. **Local testing** (no Google calls unless you add a key yourself):
   ```bash
   npm run test:cloud                                    # includes budget + worker tests
   npx wrangler@4 deploy --dry-run --config server/places-proxy/wrangler.toml   # bundles, uploads nothing
   printf 'ADMIN_TOKEN=local-admin-token-123456789012\n' > server/places-proxy/.dev.vars
   npx wrangler@4 dev --config server/places-proxy/wrangler.toml --local
   curl -s localhost:8787/admin/usage -H 'Authorization: Bearer local-admin-token-123456789012'
   curl -s -X POST localhost:8787/autocomplete -d '{"input":"Munnar","sessionToken":"1a2b3c4d-1111-4222-a333-444455556666"}'
   # → {"error":"disabled","code":"GOOGLE_DISABLED"} while GOOGLE_PLACES_ENABLED="false"
   ```
   (`.dev.vars` is git-ignored by Wrangler convention; do not commit it.)

## Stage B — Activation (only after the owner's explicit approval; NOT done)

Steps marked 💳 can create charges.

1. 💳 **Enable billing:** Google Cloud console → Billing → link a billing account to the project.
2. **Budget alert:** Billing → Budgets & alerts → Create budget: ₹100/month for this project,
   alerts at 50 %, 90 %, 100 % (email). Alerts only — not a cap.
3. 💳 **Create the server key:** APIs & Services → Credentials → Create credentials → API key →
   Edit → API restrictions → *Restrict key* → *Places API (New)* → Save.
4. **Store it on the Worker:**
   ```bash
   npx wrangler@4 secret put GOOGLE_PLACES_KEY --config server/places-proxy/wrangler.toml
   npx wrangler@4 secret put ADMIN_TOKEN       --config server/places-proxy/wrangler.toml
   ```
5. **Confirm pricing and switch on** in `wrangler.toml`: `PLACES_PRICING.verifiedOn`, prices,
   `usdToInr`; then `GOOGLE_PLACES_ENABLED = "true"`.
6. **Daily quotas (additional hard limit):** APIs & Services → *Places API (New)* → *Quotas &
   System Limits* → filter by method → Edit quota. Recommended:

   | Quota (Places API New) | Per day | Per minute |
   |---|---|---|
   | Autocomplete (`AutocompletePlaces`) requests | 150 | 30 |
   | Place Details (`GetPlace`) requests | 40 | 10 |
   | Nearby Search, Text Search, Photo media | 0 | 0 |

   Keep them at or a little above the proxy's own daily limits (120 / 30); lower if you prefer.
7. 💳 **Deploy** (creates the Worker and the Durable Object):
   ```bash
   npx wrangler@4 deploy --config server/places-proxy/wrangler.toml
   ```
8. **App:** set `EXPO_PUBLIC_PLACES_PROXY_URL=https://trip-prep-places.<subdomain>.workers.dev`
   in the EAS *preview* (and later *production*) environment, then build a new APK.
9. 💳 **Verify:** search one place in the app; check `GET /admin/usage` shows 1 session's
   requests; next day, compare with Google Cloud → Billing → Reports (filter: Places API (New),
   group by SKU). Adjust prices or tiers if Google's SKUs differ from the proxy's estimate.

## Stage C — Monitoring

- **Daily:** `curl -s https://trip-prep-places.<subdomain>.workers.dev/admin/usage -H "Authorization: Bearer $ADMIN_TOKEN"`
  → `estimatedInr`, `remainingAllowanceInr`, `todayUsage`, `skus`, `blocked`, `upstream`,
  `lastAccountingUpdate`, `history` (every month's summary). Logs: `npx wrangler@4 tail --config server/places-proxy/wrangler.toml`
  (JSON lines: `google_request`, `budget_block`, `sku_unknown`, …; no keys, no search text).
- **Monthly:** compare `history` with Google Cloud Billing → Reports for the same month
  (Pacific time). The proxy figure should be higher (it ignores free usage and session savings).
- **Budget exhausted:** the proxy answers `budget_exhausted` / `GOOGLE_BUDGET_EXHAUSTED` (or
  `GOOGLE_DAILY_LIMIT`); the app pauses Google for 6 hours and uses free search; the next month
  (or day) opens automatically. The ₹30 reserve is never used by the proxy.
- **Emergency stop (any one is enough):** set `GOOGLE_PLACES_ENABLED = "false"` and redeploy;
  `npx wrangler@4 secret delete GOOGLE_PLACES_KEY --config server/places-proxy/wrangler.toml`;
  or in Google Cloud delete/restrict the key or disable *Places API (New)*.
- **Key rotation:** create a new key with the same restrictions → `secret put GOOGLE_PLACES_KEY`
  → verify one request → delete the old key in Google Cloud.

## Data and attribution

The app stores only a place's ID, name (the one the user saw), address and coordinates when the
user adds it; Google content in search results is held in memory only. Results are shown with
Google attribution where Google data is displayed.
