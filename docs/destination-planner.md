# Destination Discovery & Visual Trip Planner (Milestone 5)

Status: **parts A, C and F (offline / reliability) done** (data model, migration, provider abstraction, planner screens with
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

1. **Places proxy** (reference implementation in `server/places-proxy/`, **not deployed**; the app
   client is `src/features/places/proxyProvider.ts`). A small serverless endpoint holds the Places API key as a
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

| | Scope | Status |
| --- | --- | --- |
| A | Schema v4, plan/route model, repository, provider interface, cache policy, tests | Done |
| B | Places proxy + proxy-backed provider, manual entry fallback | App side done; proxy written, not deployed (needs billing and approval) |
| C | One destination system; planner screen, add / move / nest / promote / rename / remove, route, saved-place reuse | Done |
| D | Destination detail page, nearby recommendations with placement and duplicate detection | Done (live data waits for the proxy) |
| E | In-app map view (`react-native-maps`, Maps SDK key, new dev build) | Not started |
| F | Offline states, reliability, e2e at 360 px | Done |
| Upgrade | Drag-and-drop tree/route/Navigation, visited status, arrival prompts, destination page, saved & compare | Done (see below) |

## Destination planner upgrade

Local schema **v6** (`src/db/migrations/0006_destination_companion.ts`, additive only):
`trip_navigation_items`, `plan_node_profiles`, `plan_node_tasks`, `plan_node_notes`,
`plan_node_alerts`, `plan_node_memories`. All are local-only for now (registered in
`LOCAL_ONLY_TABLES`); matching cloud tables need separate approval.

**Three independent orders.** The plan tree (`trip_plan_nodes.parent_id`/`position`), the route
(`trip_route_stops.position`) and Navigation (`trip_navigation_items.parent_id`/`position`) never
change each other. Removing a place from Navigation or the route leaves the plan alone.

**Drag-and-drop** (`components/DraggableList.tsx`, pure `dragDrop.ts`): the pointer position within
a row decides the drop — top 30 % before, middle inside, bottom 30 % after (halves for flat lists).
An indicator line shows the target; the list auto-scrolls near the edges in the drag direction.
Drops over the dragged place's own subtree, or deeper than 12 levels, are refused. Every drag has
an accessible alternative: screen-reader actions on the drag handle (move up, move down, move out)
and the *Move* screen.

**Navigation** (`features/places/mapsLinks.ts`): per-place `…/maps/dir/?api=1&destination=…`;
the journey is split into legs of at most 3 waypoints and 2,048 characters (conservative: Google's
documented URL limit is 2,048 characters and mobile apps honour fewer waypoints), each leg starting
where the previous one ended, so no stop is dropped. Visited places are left out.

**Visited and arrival prompts** (`arrival.ts`, `arrivalStore.ts`, `ArrivalWatcher.tsx`): marking
visited is always an explicit action. Optional prompts use foreground location only while the app
is open (no background tracking): within ~150 m (plus GPS accuracy credit) for about 4 minutes, then
"You've reached X. Mark as visited?" with *Yes, mark as visited* / *Not yet* (30-minute snooze).
Off by default; permission is requested only when switched on. Best effort: phones may throttle
GPS, and nothing happens while the app is closed.

**Destination page** (`PlaceScreen.tsx`, `detail/*`): hero (the user's cover photo, favourite,
share), quick actions (visited, route add/remove with confirmation, Navigation, promote, add inside),
location card (Open in Maps; choose/change from a full Google Maps link or coordinates — short
`maps.app.goo.gl` links are explained, not guessed; Places search only when configured), and tabs:

| Tab | Contents |
| --- | --- |
| Overview | Name and quick notes, description, best season, entry fee, getting there, tags, saved notices with source, link, checked date and an out-of-date flag after 7 days; weather marked as not connected; what is stored offline |
| Explore | Places inside (drag-and-drop subtree), live recommendations |
| Prepare | Tasks by category, progress, generic suggestions added only when picked |
| Plan | Route position, previous stop and straight-line distance (labelled as such), time needed, best time, sunrise/sunset computed on the device for the first trip day (phone's time zone, terrain ignored), notes by kind |
| Memories | Visit date, 1–5 rating, notes, moments, photos — device only, never shared |

**Saved & compare** (`/trips/[tripId]/plan/compare`, pure `compare.ts`): All / Saved / tag filters
and a side-by-side table for up to three places; "—" marks anything not filled in.

**Recommendations** (`components/Recommendations.tsx`, `places/discovery.ts`): 5/10/25/50 km,
categories (attractions, viewpoints, waterfalls, nature, tea estates, restaurants), sort by
relevance/distance/rating; one tap opens an explicit placement choice (inside the current place, as
a route stop, as a main destination). Places already in the plan (same Place ID) are marked and
cannot be added twice; a hand-entered place can be linked to a Place later (`setNodePlace`). Only
identity and location are saved. Without `EXPO_PUBLIC_PLACES_PROXY_URL` the section says "not set
up" and shows no sample data.

**Not invented:** ratings, opening hours, weather, road distance and drive time, alerts and facts
come only from a live provider (with its source) or from the user.

## Screens

| Route | Screen |
| --- | --- |
| `/trips/[tripId]/plan?tab=destinations\|route\|navigation` | Planner with Destinations, Route and Navigation tabs |
| `/trips/[tripId]/plan/add?parentId=` | Add a place: name, notes, route toggle, saved-place reuse, recommendations |
| `/trips/[tripId]/plan/place/[nodeId]?tab=` | Destination page (tabs above) |
| `/trips/[tripId]/plan/compare` | Saved & compare |
| `/trips/[tripId]/plan/move/[nodeId]` | Move into another place or to the top level |
| `/trips/[tripId]/plan/route` | Opens the planner on the Route tab |

## Reliability (part F)

- **No network dependency.** The planner, place details, route and Home's *Continue planning* use
  only the on-device database. Google is reached only through the explicit *Open in Google Maps*
  link. Verified in the browser with the network cut (`e2e/web-planner-reliability.mjs`). On web,
  Expo Router loads each screen's code on first visit, so a never-opened screen needs a connection
  once; Android ships a single bundle (verified by the Android export), so this is web-only.
- **Transactions are queued** (`src/db/serialize.ts`). expo-sqlite's `withTransactionAsync` is not
  exclusive; two quick actions could start a second transaction while one is open. All app writes
  go through one queue, so rapid taps run one after another. Never start a transaction inside
  another (it would wait for itself) — every test runs through the same queue to catch that.
- **Invariants** (`test/planInvariants.ts`): parents in the same trip, no cycles, depth within the
  limit, sibling and route positions contiguous, unique stops in the right trip, a place once per
  trip, trip destinations exactly equal to main destinations in order, legacy column in step, no
  orphan rows anywhere. Checked after every step of 900 seeded random operations, and route order is
  checked to change only through route actions or removing stops' places.
- **Interrupted writes** (simulated storage failures while adding, reordering, removing and moving)
  roll back completely: plan, route and trip are byte-identical to before.
- **Lifecycle**: database close/reopen, duplication of deep plans (same tree, route order, shared
  places), deletion (no planner rows left; saved places stay for reuse), empty trips, and trips
  created before Milestone 5 (original destination ids survive planner edits).
- **Scale**: a 300-place plan through the repository; a 100-place plan through the UI at 360 px
  (expand/collapse, scrolling, sheets, reorder — about 40–150 ms per action in headless desktop
  Chromium; phones will be slower). The list computes sibling positions and nested counts in one pass.
- Double taps on *Add* / *Move* are ignored while a save is in flight.
