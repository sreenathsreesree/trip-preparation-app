# Trip Prep — Complete Travel Preparation App

> **Nothing forgotten. Everything ready.**

An offline-first mobile app that prepares everything before a trip: packing, travel documents,
vehicle readiness, preparation tasks, shopping and home-departure checks. India is the launch
market; the architecture is ready for global expansion.

Built with Expo SDK 58, React Native 0.88, TypeScript, Expo Router, expo-sqlite, Zustand,
Reanimated 4, Gesture Handler 3 and Expo Image.

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
| `npm test` | Jest (`jest-expo` preset) — domain, readiness, migrations (incl. v1 → v2 data upgrade), repositories, templates and stores |
| `npm run check` | All three of the above |
| `npm run build:web` | Static web export to `dist/` |
| `npm run e2e:web` | Browser smoke test against `dist/`, or a running server via `BASE_URL` (needs Playwright + Chromium installed separately) |
| `npm run doctor` | `expo-doctor` (needs network access to Expo's API) |
| `npm run build:android:dev` | EAS cloud build of the Android development APK (needs an Expo account) |
| `npm run build:android:preview` | EAS cloud build of a standalone Android APK |

Repository and migration tests run against a **real SQLite engine** (Node's built-in
`node:sqlite`, Node 22.3+), including a cold-restart test that closes and reopens a database file.
The web smoke test drives the exported app at a 360 px phone width through trip creation, editing,
checklist and template flows, a full browser restart and deletion.

## Features

**Trips**

- **Create Trip flow** — three validated steps: name, ordered destinations (multi-stop routes) and
  category; dates (custom range calendar that behaves identically on iOS, Android and web) and named
  travellers (adult/child); transport mode (Car, Bike, Train, Bus, Flight, Mixed) plus where the
  checklist comes from (recommended starter checklist and/or your templates).
- **Edit trips** — one prefilled form for name, stops (add, rename, reorder, remove), dates,
  travellers (add, rename, switch adult/child, remove) and transport. Destination and traveller ids
  are preserved, and editing details never touches the checklist or its ticks.
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

**Everything else**

- Tabs: Home (next-trip hero, countdown, stats incl. open essentials), Trips, Inventory (clearly
  marked as not yet available — no fake controls), Checklists (upcoming trips and templates) and
  Profile (on-device storage stats, schema version, app version).
- Loading, empty, error (with retry) and confirmation states throughout; a root error boundary.

## Architecture

```
src/
  app/                    Expo Router routes only — thin files that render feature screens
    _layout.tsx           Fonts, splash, DB bootstrap, gesture/safe-area/theme providers, Stack
    (tabs)/               Home, Trips, Inventory, Checklists, Profile + custom tab bar
    trips/new.tsx         Create Trip flow (modal)
    trips/[tripId]/       Dashboard, edit, sections (manage + [sectionId]), tasks/[taskId],
                          templates (apply), save-template
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
    home/ inventory/ profile/
  lib/                    Dates, ids, haptics, confirm dialog, errors
  theme/                  Colour, typography, spacing/radii tokens, navigation theme
test/                     Node SQLite adapter and fixtures used by tests
e2e/                      Web smoke test
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

Components consume semantic tokens (`colors.surface`, `colors.accent`, …) rather than raw hex.
Headings use **Space Grotesk**, body text **Inter** (both bundled via `@expo-google-fonts`).
The topographic contour artwork (`assets/images/topo-pattern.svg`) is generated by
`node scripts/generate-topo-pattern.mjs` and rendered with Expo Image. The provisional app icon,
Android adaptive/monochrome icon layers, splash image and favicon are generated by
`node scripts/generate-app-icons.mjs` (requires Playwright).

## Not yet built

Inventory, AI recommendations, weather, accounts and cloud sync, household sharing, reminders and
notifications, and localisation are planned for later milestones.
