# Phase 2: Route Planner, Group Trip and My Trip

## Planner tabs
- **Destinations — organise**: places and their hierarchy (unchanged).
- **Route — plan the journey**: travel order (drag), road distance and driving time per leg and in
  total, how many legs could be measured, stops without a location, live/saved source, how Google
  Maps will split the journey, and an opt-in "Suggest a shorter order" (proposal → "Use this
  order" → "Restore previous order"). Visited stops keep their places.
- **Navigation — travel**: unchanged (Google Maps app first, browser legs fallback, 10 places per
  app route, encoding, visited skipped).

Routing uses **OSRM** (Open Source Routing Machine) on OpenStreetMap data. The public server
(router.project-osrm.org) is free and keyless; its policy asks for light use and ≤ 1 request per
second, attribution, and no production-scale load. Requests are spaced, results cached 30 days and
shown as saved when offline. `EXPO_PUBLIC_ROUTING_URL` switches to a self-hosted OSRM. Google
Directions needs billing and is not used. There is **no interactive map**: native maps on Android
need a Google Maps key and billing; the route opens in Google Maps instead.

## Group Trip and My Trip
- **Group Trip** (shared trips only): shared itinerary (an owner/editor publishes names, nesting,
  route order, planned days and locations — never notes, memories, photos or tags; members can add
  it to their own plan without duplicates), shared route and group visited state, navigation,
  group checklist with assignees, shared documents/bookings (common types only), group notes,
  readiness ("3 of 4 members are ready" — only a flag is shared), members and roles (existing Share
  screen), group expenses (existing calculator, joined automatically through membership).
- **My Trip** (always private): private documents (passport, ID, visa, insurance, medical, own
  tickets) stored only on the phone, plus personal packing, checklist, journal/memories and
  personal expenses.

Roles: owner and editors change the Group Trip; viewers read it and set only their own readiness;
membership changes stay owner-only (existing functions).

## Sync and data
- One sync engine: `syncSharedTrip` now also sends queued Group Trip items and pulls
  `shared_trip_items` through the existing `shared_pull`.
- Offline changes queue in `group_items` (local v13) inside the account's own database.
- Concurrent edits: every change carries the version it was based on; the server refuses an update
  based on an outdated copy, the device then keeps both and asks "Keep mine / Take theirs".
- Removed members: the cached Group Trip is cleared; their own trip stays.
- Until the cloud migration is deployed, Group Trip changes wait on the phone (shown as waiting);
  journal and expense sharing keep working.

## Cloud migration (pending, not deployed)
`supabase/pending/20261116090000_shared_workspace.sql` + rollback, tested by
`supabase/tests/workspace.test.mjs` (17 tests on Postgres 17). Additive: one table, trigger,
policies, registration for `shared_pull`; no existing object, grant or default privilege changes.
