# Trip Prep — Complete Travel Preparation App

> **Nothing forgotten. Everything ready.**

An offline-first mobile app that prepares everything before a trip: packing, travel documents,
vehicle readiness, preparation tasks, shopping and home-departure checks. India is the launch
market; the architecture is ready for global expansion.

Built with Expo SDK 58, React Native 0.88, TypeScript, Expo Router, expo-sqlite, Zustand,
Reanimated 4, Gesture Handler 3, Expo Image, expo-image-picker and expo-file-system.

## Getting started

```bash
npm install
npm start          # Expo dev server — press i (iOS), a (Android) or w (web)
```

- **Android device**: use the development build (`npm run build:android:dev`, EAS Build) — see
  [docs/android-device-testing.md](docs/android-device-testing.md) for account setup, installing the
  APK and connecting to the dev server. Expo Go only works if its installed version supports SDK 58.
- **Local native builds** (Android Studio / Xcode installed): `npx expo run:android` / `npx expo run:ios`.
- **Web**: `npm run web`. Following the expo-sqlite web guidance, `metro.config.js` adds
  `COEP`/`COOP` headers and the `expo-router` plugin config adds them for EAS Hosting. Note: with
  SDK 58's dev server the Metro hook only reaches bundle responses, not the HTML page, so the dev
  page is not cross-origin isolated — the full create/persist/restart flow was nevertheless
  verified to work there. Serve the same headers from any production web host.

### Checks

| Command | What it does |
| --- | --- |
| `npm run typecheck` | `tsc --noEmit` (strict, `noUncheckedIndexedAccess`) |
| `npm run lint` | `expo lint` (ESLint 9 flat config, `eslint-config-expo`) |
| `npm test` | Jest (`jest-expo` preset) — domain, readiness, migrations (incl. v1 → v2 … v4 → v5 data upgrades), repositories, templates, inventory, packing (grouping, progress, add options, coverage), reservations, recommendation rules and purchases |
| `npm run test:cloud` | Supabase migrations, Row Level Security and sync functions against real Postgres (PGlite) |
| `npm run check` | Typecheck, lint, Jest and the cloud tests |
| `npm run build:web` | Static web export to `dist/` |
| `npm run e2e:web` | Browser smoke test (trips, checklists, templates) against `dist/`, or a running server via `BASE_URL` (needs Playwright + Chromium installed separately) |
| `npm run e2e:inventory` | Browser test of inventory, packing, reservations, suggestions, shopping and luggage (same requirements) |
| `npm run e2e:packing` | Browser test of two-level packing: category list and screens, adding (owned, suggested, trip-only, quick add), units, edit/remove, custom categories (create, rename, starter protection, reorder, delete), need to buy → bought → inventory → packed, covered suggestions, multi-trip reuse and offline use (same requirements) |
| `npm run e2e:planner` | Browser test of the destination planner, route stops and its entry points (same requirements) |
| `npm run e2e:auth` | Account routes in a build without Supabase configuration: guest-only, no sign-in control, protected account screen (same requirements) |
| `npm run e2e:planner-reliability` | Planner offline (network cut) and with a 100-place plan, plus rapid taps (same requirements) |
| `npm run e2e:planner-dnd` | Drag-and-drop tree, route and Navigation, journey legs, visited status, arrival permission denied, restart persistence (same requirements) |
| `npm run e2e:journal` | Journey Journal: entries with mood, place and photos, timeline with destination memories, validation, offline, delete confirmation, restart persistence (same requirements) |
| `npm run e2e:destination` | Destination page tabs, location, notices, tasks, notes, memories, quick actions, saved & compare, restart persistence (same requirements) |
| `npm run doctor` | `expo-doctor` (needs network access to Expo's API) |
| `npm run build:android:dev` | EAS cloud build of the Android development APK (needs an Expo account) |
| `npm run build:android:preview` | EAS cloud build of a standalone Android APK |

Repository and migration tests run against a **real SQLite engine** (Node's built-in
`node:sqlite`, Node 22.3+), including a cold-restart test that closes and reopens a database file.
Both browser tests drive the exported app at a 360 px phone width and include a full browser restart
to check persistence: the smoke test covers trip creation, editing, checklist and template flows and
deletion; the inventory test covers categories, items, the three inventory views, packing two
overlapping trips, reservation conflicts, suggestions (accept/skip/regenerate), the shopping list,
bags and deleting a trip while keeping its shopping history. Set `SCREENSHOT_DIR` to keep
screenshots.

## Features

**Trips**

- **Create Trip flow** — three validated steps: name and category (destinations are planned right
  after, in the planner — a trip can be saved before deciding them); dates (custom range calendar that behaves identically on iOS, Android and web) and named
  travellers (adult/child); transport mode (Car, Bike, Train, Bus, Flight, Mixed) plus where the
  checklist comes from (recommended starter checklist and/or your templates).
- **Edit trips** — one prefilled form for name, dates, travellers (add, rename, switch adult/child,
  remove) and transport, with a link to the planner for destinations. Traveller ids are preserved,
  and editing details never touches destinations, the checklist or its ticks.
- **Manage trips** — from the dashboard or a trip card's menu: duplicate (copies details and
  checklist with nothing ticked), mark completed / reopen, archive / restore, and delete with an
  explicit confirmation that lists what will be removed. The Trips tab groups **Active**,
  **Done** and **Archived** trips; trips whose dates have passed are flagged with a prompt to
  complete them.

**Reusable checklist engine**

- **Checklist templates** (Checklists → Templates): create, rename, describe, duplicate and delete;
  organise them into sections; add, edit, delete and reorder tasks. Each task has a title,
  description, notes and a priority — **Essential**, **Recommended** or **Optional**.
- **Reuse across trips** — apply templates when creating a trip or later with *Add from template*.
  The trip gets its own copy, so completion is independent per trip and trips can be customised
  freely. **Template edits never change existing trips**; re-applying a template only adds tasks
  that are missing (matched by origin or title) and reports what was skipped.
- **Save as template** turns any trip's checklist into a new template (structure and details, not
  ticks).
- **Trip checklists** use the same engine: manage sections (rename, reorder, add, delete), quick-add
  tasks with a priority, edit details, move tasks between sections, reorder, tick, swipe to delete.
- **Recommended starter checklist** (optional) tailored to transport, category, duration and
  travellers — e.g. FASTag top-up for car trips, PNR for trains, gas-regulator and milk-delivery
  checks before leaving home — now with priorities.

**Readiness**

- **Departure readiness vs task completion** — readiness counts essential + recommended tasks only
  (optional tasks never block it); completion counts every task. Percentages never round up to 100%
  before everything is done.
- **Departure status** — *Not ready to depart* while any essential task is open, *Ready to depart*
  once all essentials are done, *Fully prepared* when recommended tasks are done too.
- **Open essentials are highlighted** on the dashboard (tickable in place), on section cards and in
  section lists; section-level progress everywhere; updates instantly when tasks change.

**Personal inventory** (Inventory tab)

- **Inventory items are your belongings**, recorded once and reused on every trip: name, description,
  picture, brand, model, quantity, weight, condition and storage location. Create, edit, duplicate,
  archive/restore and delete (with a confirmation that explains trip lists keep their own entries).
- **Categories** — 11 starter categories (Clothing, Footwear, Toiletries, Electronics, Documents,
  Medicines and first aid, Travel accessories, Camping and outdoor, Photography, Food and essentials,
  Miscellaneous) plus your own, one level of subcategories, each with an icon, colour, order and an
  optional cover image. Deleting a category keeps its items (they become uncategorised).
- **Three synchronised views** of the same data and filters: **Folders** (category folders with item
  counts and picture mosaics), **Gallery** (image grid) and **List** (details with inline quantity
  adjustment). Search by name/brand/model/location/category, filter by status and sort.
- **Statuses**: Available, Reserved and Packed (derived from trips), Borrowed (lent out), Damaged and
  Archived.
- **Pictures, honestly labelled** — priority is: your photo (camera or library) → an illustration you
  picked from the built-in library → a suggested illustration **only after you tap "Use it"** →
  the category icon. Illustrations are generic icons and are labelled "not a photo"; no product photo
  is ever assigned automatically. Photos are copied into the app's private storage on the device.

**Packing** (trip dashboard → Packing)

- **Two levels: categories, then items.** The Items tab lists every category of the trip with its
  icon, item count, packed count and progress; categories with items come first, empty ones are
  compact rows with *Add items*, and items whose category was deleted appear under *Uncategorised*.
  Tapping a category opens its own screen with progress, subcategory and traveller filters and the
  items. On an item, the **checkbox** toggles packed; the row itself opens nothing; the **⋯ menu**
  offers *Edit*, *Need to buy* (then *Mark as bought*, *Add to My Inventory*) and *Remove*.
- **One shared category list** for My Inventory and trip packing (per user, reusable on every trip,
  ready for account sync). Starter categories can be renamed, recoloured and reordered but not
  deleted; your own categories (name, icon, colour, optional description, order) can also be deleted
  — inventory items and trip items are never deleted with them. *Travel accessories* is where
  personal-care items such as wallet, sunglasses and watch live.
- **Adding items** (from a category): things you own in that category first (with how many are free
  for the trip's dates; damaged or lent-out items cannot be picked), other owned items while
  searching (they keep their own category), default suggestions for the category, and *Create …* for
  a trip-only item that never touches My Inventory. Each category screen also offers one-tap *Quick
  add* chips for owned items and suggestions not yet on the list. Nothing is added automatically and
  new items always start unpacked.
- **Packing entries are trip-specific decisions.** An entry may point at an inventory item but owns
  its own name, category, quantity and unit (pieces, pairs, sets, bottles, packs), traveller, bag,
  notes and packed state; the same item can be on several trips with independent packed states;
  removing it never touches the inventory, and deleting an inventory item leaves trip entries as
  trip-only items. Progress counts items (e.g. 4 of 6 packed, 67%) per category and for the trip.
- **Reservations** — a draft list reserves nothing. *Confirm list* reserves the inventory for the
  trip's dates; overlapping trips can never hold more units than you own (checked inside the
  transaction), and damaged, lent-out or archived items cannot be reserved. Conflicts are explained
  item by item. Removing an entry releases its reservation; *Back to draft*, completing, archiving or
  deleting the trip closes them; moving a trip onto clashing dates returns it to draft with a reason.
- **Luggage** — Main suitcase, Cabin bag, Backpack, Daypack, Camera bag or a custom bag, optionally
  per traveller; item counts, packed progress and a weight estimate that only adds known weights and
  says when items have none.
- **Suggestions** — a transparent, deterministic rules engine (no AI, no network) using trip length,
  destinations (cold/high-altitude/beach places), season, travellers (adult/child), transport,
  category, activities, accommodation, laundry and your packing style. Each suggestion shows the item,
  quantity, priority, reason, category, traveller and whether you own it. Nothing is added until you
  accept it. Suggestions already covered by something on the list (same inventory item, same name or
  a matching word, e.g. a hand-added "Phone charger") leave the review queue for a collapsed *Already
  on your list* group; accepting or *Link all* links them instead of duplicating. *Check for
  changes* previews what regenerating would change (new, updated, no longer suggested, skipped) and
  applies only after you confirm; your list, quantities and skipped suggestions are preserved.
- **Shopping list** — per trip and across trips (Inventory → Shopping list): add items or send
  suggestions, or choose *Need to buy* on an item of the packing list (linked to that item; one
  shopping entry per item); mark them purchased, already owned, borrowing or skipped; then add a
  purchase to the inventory (which also links the packing item to it) and/or the trip's list (never
  auto-packed). Duplicates are prevented, and history is kept when a trip is deleted.

**Everything else**

- Tabs: Home (next-trip hero, countdown, stats incl. open essentials), Trips, Inventory, Checklists
  (upcoming trips and templates) and Profile (on-device storage stats, schema version, app version).
- Loading, empty, error (with retry) and confirmation states throughout; a root error boundary.

## Architecture

```
src/
  app/                    Expo Router routes only — thin files that render feature screens
    _layout.tsx           Fonts, splash, DB bootstrap, gesture/safe-area/theme providers, Stack
    (tabs)/               Home, Trips, Inventory, Checklists, Profile + custom tab bar
    trips/new.tsx         Create Trip flow (modal)
    trips/[tripId]/       Dashboard, edit, sections (manage + [sectionId]), tasks/[taskId],
                          templates (apply), save-template, packing (index, category/, add, entry/, bag/)
    inventory/            item (new, [itemId], [itemId]/edit), category/[categoryId],
                          categories (index, new, [categoryId]), shopping
    templates/            new, [templateId] (editor, edit, sections, tasks/[taskId])
  components/
    ui/                   Design-system primitives (AppText, Button, Card, TextField, …)
    layout/               Screen, ScreenHeader, TopoBackdrop
    navigation/           ExpeditionTabBar
  db/
    client.ts             Single shared expo-sqlite connection (open → pragmas → migrate)
    migrate.ts            PRAGMA user_version migration runner
    migrations/           Ordered, append-only migrations
    repositories.ts       Binds repositories to the shared connection
    types.ts              Minimal `Database` interface the data layer depends on
  features/
    trips/                Model, validation, repository, stores (trips, form draft), hooks, components
    preparation/          Checklist engine: model + merge, readiness, starter checklist, checklist and
                          template repositories, stores, components (also used by templates)
    inventory/            Inventory model, repository, store, screens and views
    packing/              Packing entries, luggage, reservations, recommendation rules, purchases,
                          preferences: models, repositories, store, screens
    home/ profile/
  lib/                    Dates, ids, haptics, confirm dialog, errors, image storage
  theme/                  Colour, typography, spacing/radii tokens, navigation theme
test/                     Node SQLite adapter and fixtures used by tests
e2e/                      Browser tests (shared harness, smoke test, inventory & packing test)
```

**Data flow:** screens → Zustand stores → repositories → `Database` interface → expo-sqlite.
Screens never write SQL; repositories never import React.

Key decisions:

- **Offline-first, local source of truth.** All data lives in SQLite on the device. There is no
  auth, network or cloud sync in this milestone, and no secrets or API keys.
- **UUID primary keys** (`expo-crypto`) so records stay globally unique when sync is added.
- **Calendar dates as `YYYY-MM-DD` strings**; timestamps as ISO-8601 UTC. Day arithmetic uses UTC
  internally so it is immune to time-zone and DST shifts.
- **Migrations** use `PRAGMA user_version`; each migration and its version bump run in one
  transaction, so a failure rolls back cleanly. A database newer than the app is refused rather
  than corrupted. Enum-like columns are validated in the domain layer (no `CHECK` lists) so new
  values ship without table rebuilds.
- **One queued connection.** The shared expo-sqlite connection runs transactions one at a time
  (`src/db/serialize.ts`), because `withTransactionAsync` is not exclusive; quick repeated actions
  cannot collide.
- **Repositories are factories over a minimal `Database` interface**, which `SQLiteDatabase`
  satisfies structurally. Tests inject a Node SQLite implementation.
- **Stores**: `useTripsStore` (trip summaries with readiness, lifecycle actions),
  `useChecklistStore` (sections and tasks per owner — trip or template; optimistic ticks that revert
  on failure and push readiness to the trip list immediately), `useTemplatesStore` (template
  library) and `useTripDraftStore` (create/edit form state).
- **One checklist engine for trips and templates.** `checklist_sections` belong to exactly one
  trip *or* one template (enforced by a `CHECK`), and `checklist_tasks` belong to a section. Applying
  a template copies its tasks into the trip (with `source_template_id` / `source_task_id` provenance
  but no foreign key), which is why completion is per trip and template edits or deletes never
  reach existing trips. Merging is a pure function (`planMerge`) shared by trip creation and
  *Add from template*.
- **Schema v2** (`0002_trip_management_and_checklists`) adds ordered `trip_destinations` and
  `trip_travellers`, `trips.completed_at` / `archived_at`, and the checklist tables. Existing data is
  migrated in the same transaction: each trip's destination, its adult/child counts as editable
  placeholder travellers ("Adult 1", "Child 1"), its standard sections and every checklist item (ids,
  ticks and order preserved). `trips.destination`, `adults` and `children` are kept as derived columns
  maintained by the repository.
- **Tabs** use `expo-router/js-tabs` (SDK 58's replacement for the deprecated root `Tabs` export)
  with a custom `ExpeditionTabBar`.
- **Schema v3** (`0003_inventory_and_packing`) adds `inventory_categories` (seeded with the starter
  categories, identified by `system_key`), `inventory_items`, `trip_packing` (per-trip profile and
  confirmation), `trip_luggage`, `packing_entries`, `inventory_reservations`,
  `packing_recommendations`, `purchase_items` and `user_preferences`. It only creates tables, so v2
  data is untouched (covered by a v2 → v3 upgrade test).
- **Schema v5** (`0005_packing_units_and_category_descriptions`) adds `packing_entries.unit` (default
  `pcs`) and `inventory_categories.description` (default empty) with two `ADD COLUMN`s — no row is
  rewritten (covered by a v4 → v5 test comparing every row). Both columns are local-only in the sync
  registry until a matching cloud migration is approved (needed before G4).
- **Two-level packing** is derived, not stored: `features/packing/categories.ts` groups entries by
  top-level category (subcategories roll up) and computes progress; `addOptions.ts`, `catalogue.ts`
  and `suggestionCoverage.ts` decide what can be added and what is already covered. All are pure and
  unit-tested.
- **InventoryItem vs PackingEntry** are separate tables and types. Entries copy the item's name and
  category when added and reference it with `ON DELETE SET NULL`; trip quantities never change the
  inventory quantity.
- **Reservations are rows**, created only when a list is confirmed, and checked with a
  write-then-verify-then-rollback pattern inside one transaction so concurrent changes cannot
  over-book. Inventory status (reserved/packed) is derived from active, not-yet-ended reservations and
  the packed state of the entries they cover, rather than stored.
- **Recommendations** are a pure function (`generateSuggestions`) over a rule table, each rule with a
  stable key, scope (trip / each traveller / adults / children), condition, quantity, priority and
  reason; inventory matching is whole-word. Decisions are stored per trip and key, and
  `planRegeneration` is a pure diff, so the engine is fully unit-tested and can later be swapped or
  augmented without changing the UI.
- **Purchases** snapshot the trip name and keep `trip_id` as `SET NULL`, so shopping history survives
  trip deletion; a partial unique index prevents duplicate open entries per trip.
- **Images** are stored as `file://` copies in the app's document directory on Android/iOS (data URIs
  on web); built-in illustrations use `library:<key>` URIs that map to icons. Orphaned photos are
  deleted when an item or category no longer references them.

## Design system — Expedition Tech

Dark-first palette defined in `src/theme/colors.ts`:

| Token | Hex |
| --- | --- |
| Expedition Charcoal | `#202832` |
| Slate | `#34424E` |
| Signal Lime | `#B8F36B` |
| Glacier Blue | `#9DCBE5` |
| Ice White | `#E8EDF0` |
| Trail Amber | `#F2B85B` |

Components consume semantic tokens (`colors.surface`, `colors.accent`, …) rather than raw hex;
category colours come from `categoryPalette`, and animated indicators share `springs.indicator`
(Reanimated 4 springs always specify `mass`, whose default is now 4).
Headings use **Space Grotesk**, body text **Inter** (both bundled via `@expo-google-fonts`).
The topographic contour artwork (`assets/images/topo-pattern.svg`) is generated by
`node scripts/generate-topo-pattern.mjs` and rendered with Expo Image. The provisional app icon,
Android adaptive/monochrome icon layers, splash image and favicon are generated by
`node scripts/generate-app-icons.mjs` (requires Playwright).

**Destination planner** (trip → *Plan destinations*; also from the dashboard card, right after
creating a trip, and Home's *Continue planning*)

- **One destination system** — the planner's main destinations are the trip's destinations on trip
  cards, route text and packing suggestions. Places nested inside them (as deep as needed) are for
  organising only.
- **Destinations tab** — an expandable tree up to 12 levels deep with *Add place* at every level.
  Drag the handle to reorder, drop onto a place to nest it, next to a main destination to promote
  it, or anywhere else to move it between parents (cycles and over-deep moves are refused). Also
  rename, notes, move screen and remove (keeping or removing what is inside).
- **Route tab** — an explicitly ordered list of stops, reordered by drag-and-drop and renumbered;
  visited stops move to a collapsible *Completed* section with undo and progress. Hierarchy changes
  never alter it.
- **Navigation tab** — an independent list (own order and nesting) of places to navigate to:
  per-place Google Maps directions and whole-journey directions split into legs within the Maps URL
  waypoint limit, never dropping a stop; visited places are skipped.
- **Visited status** shared by Route, Navigation and the destination page; optional on-device
  arrival prompts ("You've reached X. Mark as visited?") using foreground location only, off by
  default, permission asked only when switched on.
- **Destination page** — cover photo, favourite, share, quick actions, location (Google Maps link or
  coordinates), and tabs: Overview (description, season, fee, getting there, tags, saved notices
  with source and date), Explore (places inside, recommendations), Prepare (tasks and progress),
  Plan (previous stop and straight-line distance, time needed, best time, on-device
  sunrise/sunset, notes by kind) and Memories (rating, notes, photos).
- **Saved & compare** — saved-for-later and tag filters, side-by-side comparison of up to three
  places using only the user's own information.
- **Google Places recommendations** (5/10/25/50 km, categories, add with an explicit placement,
  duplicate detection by Place ID) appear only once a places proxy is configured; until then the
  app says "not set up" and never shows sample data. See
  [docs/destination-planner.md](docs/destination-planner.md) and `server/places-proxy/`.

**Journey Journal** (trip dashboard → *Journey journal*)

- Day-by-day entries with title, text, mood, an optional destination and photos; a timeline grouped
  by trip day that also shows destination memories. Private, on the device, works offline.
- Optional backup to the user's **own Google Drive** (`drive.file` scope: Trip Prep sees only the files
  it creates) and additive restore on another device. Needs the Drive API and scope configured in
  Google Cloud plus `EXPO_PUBLIC_GOOGLE_DRIVE_ENABLED=true`; until then the journal says Drive isn't
  set up. See [docs/journal-sharing-expenses.md](docs/journal-sharing-expenses.md).

## In progress — Google sign-in & cloud sync (Milestone G)

G1 is done and deployed: the Supabase cloud schema with Row Level Security and the sync protocol
(`supabase/migrations/`), tested against real Postgres with `npm run test:cloud`. G2 adds optional
Google sign-in (Supabase Auth, PKCE) with secure session storage, restore and offline-safe sign-out
on the Profile tab; guests keep using the app exactly as before and no data is uploaded. Google
sign-in still has to be enabled in Supabase and needs a new development build — see
[docs/cloud-sync.md](docs/cloud-sync.md). Moving guest data to an account (G3) and sync (G4) are next.

## In progress — Milestone 5

The destination planner upgrade (drag-and-drop tree, route, Navigation, visited status, arrival
prompts, destination page, saved & compare) is done. Live Google Places data needs the places
proxy deployed, which needs Google Cloud billing (owner's decision). The in-app map view (E) is
still to come.

## Not yet built

AI recommendations and image recognition, weather, external shopping integrations, cloud sync,
household sharing, subscriptions, reminders and notifications, and localisation are
planned for later milestones.
