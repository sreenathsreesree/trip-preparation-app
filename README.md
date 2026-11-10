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
| `npm test` | Jest (`jest-expo` preset) — domain, migrations, repositories and stores |
| `npm run check` | All three of the above |
| `npm run build:web` | Static web export to `dist/` |
| `npm run e2e:web` | Browser smoke test against `dist/`, or a running server via `BASE_URL` (needs Playwright + Chromium installed separately) |
| `npm run doctor` | `expo-doctor` (needs network access to Expo's API) |
| `npm run build:android:dev` | EAS cloud build of the Android development APK (needs an Expo account) |
| `npm run build:android:preview` | EAS cloud build of a standalone Android APK |

Repository and migration tests run against a **real SQLite engine** (Node's built-in
`node:sqlite`, Node 22.3+), including a cold-restart test that closes and reopens a database file.

## Features in this milestone

- **Create Trip flow** — three validated steps: name / destination / category, dates (custom
  range calendar that behaves identically on iOS, Android and web) and travellers, then transport
  mode (Car, Bike, Train, Bus, Flight, Mixed) with a review summary.
- **Recommended starter checklist** (optional) tailored to transport, category, duration and
  travellers — e.g. FASTag top-up for car trips, PNR for trains, gas-regulator and milk-delivery
  checks before leaving home.
- **Trip Preparation Dashboard** — readiness meter plus section cards for Packing, Documents,
  Vehicle readiness (only for Car / Bike / Mixed), Preparation tasks, Shopping and Home departure.
- **Section checklists** — add, tick and delete items (tap, swipe-to-delete, or the delete control).
- **Tabs** — Home (next-trip hero, countdown, stats), Trips (upcoming / past), Checklists (every
  section across active trips), Inventory (clearly marked as not yet available — no fake controls)
  and Profile (on-device storage stats, schema version, app version).
- Loading, empty and error (with retry) states throughout; a root error boundary.

## Architecture

```
src/
  app/                    Expo Router routes only — thin files that render feature screens
    _layout.tsx           Fonts, splash, DB bootstrap, gesture/safe-area/theme providers, Stack
    (tabs)/               Home, Trips, Inventory, Checklists, Profile + custom tab bar
    trips/new.tsx         Create Trip flow (modal)
    trips/[tripId]/       Dashboard (index) and section checklist ([section])
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
    trips/                Model, validation, repository, Zustand stores, hooks, components
    preparation/          Sections model, starter templates, repository, store, components
    home/ inventory/ profile/
  lib/                    Dates, ids, haptics, confirm dialog, errors
  theme/                  Colour, typography, spacing/radii tokens, navigation theme
test/                     Node SQLite adapter used by tests
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
- **Stores**: `useTripsStore` (trip summaries with progress), `usePrepStore` (per-trip checklist
  items; optimistic toggles that revert on failure and keep trip progress in sync) and
  `useTripDraftStore` (Create Trip wizard state).
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

Inventory, editing an existing trip, accounts and cloud sync, reminders and notifications, and
localisation are planned for later milestones.
