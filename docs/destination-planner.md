# Destination Discovery & Visual Trip Planner (Milestone 5)

Status: **parts A and C done** (data model, migration, provider abstraction, planner screens with
manual places, one destination system). No live Google calls yet; nothing talks to Google until a
proxy is configured (part B).

## Concepts

| Concept | Table | Notes |
| --- | --- | --- |
| Place | `places` | A place chosen from a provider (Google) or typed by hand. Shared by all trips; one row per provider Place ID, so a saved place is reused, never duplicated. Provider fields are a time-limited cache (`fetched_at`). |
| Plan node | `trip_plan_nodes` | The trip's organisational hierarchy. `parent_id` nests nodes to any practical depth (12 levels); `position` orders siblings. A place appears at most once per trip (unique index). `name` and `notes` are the user's own and always work offline. |
| Route stop | `trip_route_stops` | An explicitly selected, ordered list of nodes to travel through. Nesting never implies routing. A node is a stop at most once. |
| Planner recency | `trips.planner_opened_at` | Home's "continue planning" shortcut. |

**One destination system.** The planner's main destinations (top-level nodes) *are* the trip's
destinations. After every planner change, inside the same transaction,
`syncTripDestinations` rewrites `trip_destinations` (kept for trip cards, route text and packing
suggestions) to match them in order, keeping row ids stable, and refreshes the legacy
`trips.destination` column:

- adding, reordering, renaming or removing a main destination updates the trip everywhere;
- promoting a nested place adds it as a destination; nesting a main destination removes it;
- places inside main destinations never become destinations;
- the trip form has no destination editor any more: creating a trip needs no destination (empty
  planner with *Add destination*), and editing links to the planner; trip updates never touch
  destinations;
- `TripInput.destinations` only seeds a new trip's first main destinations (used by duplication paths
  and tests).

**Route independence.** Route stops change only through explicit route actions (add / remove /
reorder on the Route screen or a place's menu, or the visible *Add to route* toggle when adding a
place). Moving, nesting, promoting, reordering and renaming never change the route. Removing places
that are route stops removes those stops; the confirmation spells out which stops leave the route
(`removalImpact`) before anything is deleted.

**Migration v4** (`0004_destination_planner`) only creates tables, indexes and one nullable column,
then copies every existing destination into a main-destination node and a route stop in the same
order, inside the migration transaction (failure rolls back to v3). Covered by a v3 → v4 test that
compares trips, checklists, inventory and packing rows before and after.

## Repository operations (`features/planner/plannerRepository.ts`)

`addNode` (under a parent, at an index, optional route stop; duplicate places return the existing
node), `updateNode`, `moveNode` (reorder / nest / unnest; refuses cycles and over-deep trees),
`promote` (to a main destination right after its former main destination), `removeNode`
(`keepChildren` moves contents up a level; `withChildren` removes the subtree), route stops (`add`,
`remove`, `move`, `setRoute`), `listPlaces` (reuse), `markOpened` / `lastOpenedTripId`,
`expireProviderCache`. Every multi-row change runs in one transaction.

## Google Places integration — secure key strategy

The app is offline-first with no backend today. **No Google key is shipped for Places.**

1. **Places proxy (to build in B).** A small serverless endpoint holds the Places API key as a
   secret and exposes only what the app needs: `autocomplete`, `details`, `nearby`, `textSearch`,
   `photo`. It enforces the field masks (so the app cannot request expensive fields), caps radius and
   result counts, rate-limits per install, and maps Google errors to `quota` / `denied` / etc.
   Recommended host: **Cloudflare Workers** (secrets via `wrangler secret put`, built-in rate
   limiting, free tier). Equivalent options: Supabase Edge Functions, Google Cloud Run functions.
   The app only knows the proxy URL (`EXPO_PUBLIC_PLACES_PROXY_URL`, not a secret).
2. **Places key** (server-side): restricted to *Places API (New)* only; daily quotas and budget
   alerts set in Google Cloud.
3. **Maps SDK key** (for the in-app map, sub-milestone E): necessarily embedded in the APK, so it is
   restricted to *Maps SDK for Android* and to package `com.sreenathsreesree.tripprep` plus the EAS
   keystore's SHA-1 fingerprint (`npx eas-cli@latest credentials`). It cannot call Places.
4. Later hardening: Play Integrity / App Check tokens verified by the proxy.

Session tokens: one UUID per search session, sent with every autocomplete call and the final
details call, then discarded.

## Caching and attribution policy (to confirm against current Google terms before release)

- Place IDs: stored indefinitely.
- Coordinates and other Places content: kept at most **30 days** (`features/places/cachePolicy.ts`),
  then cleared by `expireProviderCache` until the next refresh. The user's labels, notes, hierarchy
  and route are the user's data and are kept.
- Ratings, rating counts, reviews, photos and summaries: shown live, never stored.
- Required attributions ("Google Maps" logo/text, photo author attributions) are shown wherever
  Places content appears.

## Costs (check the current Google Maps Platform pricing page)

- Autocomplete with session tokens followed by one Place Details call per selection.
- Field masks decide the billing tier: basic fields (id, location, address, types) cost least;
  rating / rating count, editorial summary and photos move details and nearby calls into higher
  tiers; each photo image is billed separately. The detail screen therefore loads ratings and photos
  only when shown, and the proxy enforces the masks.
- Nearby / Text Search per request; results limited (e.g. 10) and radius capped.
- Routes API (route lines and times) is billed per request; the plan is to start with straight lines
  between stops on the map plus Google Maps URLs for real directions, and add Routes API via the
  proxy only if needed.
- Set budget alerts and per-API daily quotas in Google Cloud.

## Sub-milestones

| | Scope | Depends on |
| --- | --- | --- |
| **A** | Schema v4, plan/route model, repository, provider interface, cache policy, tests | — (done) |
| B | Proxy (`server/places-proxy`), proxy-backed provider, debounced autocomplete controller (350 ms, ≥ 3 chars, stale-request cancellation, session tokens), manual entry fallback | Google Cloud project + Places API (New) key; proxy host account |
| **C** | One destination system; planner screen (trip menu → Plan destinations, dashboard card, post-create "Start planning", Home "Continue planning"), expandable list, add / move / reorder / nest / promote / rename / remove with explained route impact, separate route screen, manual places, same-name warning, saved-place reuse | A (done) |
| D | Destination detail screen, live details, nearby/text search with add-under / add-as-stop / make-main, duplicate state | B, C |
| E | Map view (`react-native-maps`, Google Maps SDK key), markers, route polyline, list/map toggle, Google Maps directions URLs | C; Maps SDK key; new dev build |
| F | Offline states, cache refresh, reliability, e2e at 360 px, Android bundle and build verification | all |

## Screens (part C)

| Route | Screen |
| --- | --- |
| `/trips/[tripId]/plan` | Planner: counts, *Add destination*, *Route*, expandable tree (main destinations vs nested places, route-stop badges), reorder mode, per-place action sheet |
| `/trips/[tripId]/plan/add?parentId=` | Add a main destination or a place inside one: name, notes, *Add to route* toggle, saved-place reuse, "search not set up" notice |
| `/trips/[tripId]/plan/place/[nodeId]` | Place: trail, main/nested and route badges, map details if any, Google Maps link, rename/notes, add to / remove from route, make main destination, places inside |
| `/trips/[tripId]/plan/move/[nodeId]` | Move into another place or to the top level (own sub-places disabled) |
| `/trips/[tripId]/plan/route` | Route stops in order (reorder / remove) and places to add |
