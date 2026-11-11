# Google sign-in & cloud sync (Milestone G)

Status: **G1 done** — cloud schema, Row Level Security and the sync protocol, tested against real
Postgres. Project `okudcunrqusrzppqnppm` (Trip-prep, ap-southeast-1, Postgres 17) created; deployment
in progress (see [Deploying the schema](#deploying-the-schema)). Nothing in the app talks to Supabase yet.

## 1. Architecture

```
 Device (offline-first)                               Supabase project "trip-prep" (separate from SVALAYA)
 ┌──────────────────────────────┐                    ┌───────────────────────────────────────────┐
 │ Screens → stores → repos     │                    │ Auth: Google provider (OAuth, PKCE)       │
 │        → SQLite (unchanged)  │  sync_push (RPC) → │ Postgres: mirror of user-owned tables     │
 │ sync engine (G4):            │ ← sync_pull (RPC)  │   PK (user_id, id), RLS on every table    │
 │  outbox (SQLite triggers)    │                    │   revision + txid per row, tombstones     │
 │  base revisions, conflicts   │                    │ sync_push / sync_pull: SECURITY INVOKER   │
 │ supabase-js session (G2)     │ ← Google sign-in → │                                           │
 └──────────────────────────────┘                    └───────────────────────────────────────────┘
```

- **Google OAuth only proves who the user is** (via Supabase Auth). Data lives in Supabase Postgres —
  not in Google Drive.
- **SQLite stays the source for the UI.** Screens never wait for the network; the sync engine runs in
  the background and reconciles.
- **Two RPCs, no table-by-table REST calls.** `sync_push(changes)` and `sync_pull(cursor)` keep the
  protocol small, transactional per change, and testable.
- **Separate Supabase project** for Trip Prep; SVALAYA's database is never touched. (SVALAYA's source
  is not available to this session, so the auth flow follows Supabase's standard Expo PKCE flow; we
  can align details once you share it.)

## 2. Cloud schema and ownership

Migrations: [`supabase/migrations/`](../supabase/migrations). Every synced table:

| Column | Purpose |
| --- | --- |
| `user_id` | Owner. Defaults to `auth.uid()`, **forced** to `auth.uid()` on insert by trigger, immutable. Client-supplied ids are ignored. |
| `<pk>` | The local primary key (UUID text; `key` for preferences, `trip_id` for trip packing). |
| `PRIMARY KEY (user_id, <pk>)` | Accounts can never collide, even with deterministic ids. |
| Foreign keys | Composite `(user_id, parent_id) → parent (user_id, id)`: a row can only reference the **same user's** rows. Same-table parents (`parent_id` of categories and plan nodes) have no FK; the device repairs cycles/orphans from concurrent edits. |
| `revision` | Server-assigned, strictly increasing row version (one sequence). Used for conflict detection. |
| `txid` | Transaction that last wrote the row. Used by the pull cursor. |
| `deleted_at` | Tombstone. Clients cannot hard-delete (no DELETE grant or policy). |
| `server_updated_at` | When the server accepted the write. |

Domain columns mirror SQLite names and types (dates and timestamps stay ISO text), so sync is lossless.
Limits (`char_length`) cap abuse. Two content rules are enforced by the database:
- **Google Places content is never stored in our cloud** — a `google` place row may hold only its
  Place ID (allowed indefinitely). Hand-entered places keep their name/coordinates.
- **Device photo paths** (`file:`, `data:`) are refused; built-in illustrations (`library:`) sync.
  Photo upload (Supabase Storage) is a later step.

## 3. Mapping of local tables

The registry [`src/features/sync/tables.ts`](../src/features/sync/tables.ts) is the single source of
truth; tests check it against both the SQLite schema and the Postgres schema.

| Local table | Cloud | Rank | Not synced (local only) |
| --- | --- | --- | --- |
| `trips` | `trips` | 1 | `destination` (derived), `planner_opened_at` (per device) |
| `checklist_templates` | same | 1 | |
| `inventory_categories` | same | 1 | |
| `places` | same | 1 | `fetched_at`; Google content (see above) |
| `user_preferences` | same, key `key` | 1 | |
| `trip_travellers` | same | 2 | |
| `checklist_sections` | same | 2 | |
| `inventory_items` | same | 2 | device photo files |
| `trip_packing` | same, key `trip_id` | 2 | |
| `trip_plan_nodes` | same | 2 | `trip_destination_id`, `origin` (derived) |
| `checklist_tasks` (incl. ticks) | same | 3 | |
| `trip_luggage` | same | 3 | |
| `trip_route_stops` | same | 3 | |
| `packing_entries` | same | 4 | |
| `packing_recommendations` | same | 5 | |
| `inventory_reservations` | same | 5 | |
| `purchase_items` | same | 6 | |
| `trip_destinations` | — | — | derived from the planner's main destinations, rebuilt after sync |

Rank = push order (parents before children); within a batch the server checks foreign keys per row.

## 4. Guest-to-account migration (G3)

Principles: **never delete local data, never overwrite cloud data blindly, never upload twice.**

1. **One database file per account on the device.** Guest data stays in `trip-prep.db`; a signed-in
   account uses `trip-prep-<user id>.db`. Accounts on a shared device are isolated by file; signing
   out switches back to the guest file and keeps the account file for the next sign-in.
2. **First sign-in with guest data:** the app asks *"Add this device's trips and inventory to your
   account?"*
   - **Yes** → the guest file is copied to the account file (the guest file is kept untouched until
     the upload is confirmed, then retained as a backup for a while), every row is queued for upload,
     and the upload proceeds in rank order, in batches.
   - **Not now** → stay signed in with the account's (cloud) data; guest data stays on the device,
     available when signed out, and can be added later.
3. **If the account already has cloud data** (second device or reinstall): the device first
   downloads the account's data into the account file, then (if the user chose *Yes*) the guest rows
   are added as new records. Trips are distinct records, so nothing is replaced. Shared reference
   data merges instead of duplicating, because those ids are made deterministic first (local
   migration v5): starter categories (`system_key`), Google places (Place ID) and packing suggestions
   (trip + rule). Same-id rows that differ become explicit conflicts (section 5).
4. **Retries are safe:** the upload is driven by the outbox; each row is pushed with its base revision
   (`null` for new rows) and the server treats an identical retry as already applied. An interrupted
   upload resumes where it stopped. Progress and a final "N items backed up" summary are shown.

## 5. Sync and conflict model (G4)

**Local tracking.** SQLite triggers on every synced table record changes in an outbox
(`table, pk, op`, one entry per row, latest wins). Triggers also catch cascaded deletes and
`SET NULL` updates. While remote changes are being applied, a control flag silences the triggers.
A per-row table stores the last server `revision` seen (the base).

**Push** (after local writes, debounced; on app foreground; on reconnect; *Sync now*): read the
outbox in rank order, send current full rows (or deletes) with their base revision in batches of
≤ 500. Per row result:
- `applied` → store the new revision; clear the outbox entry unless the row changed again meanwhile.
- `conflict` → keep the local row as it is, record a conflict with the server row; do not retry.
- `rejected` → keep queued, back off; after repeated failures show it in Sync status.
Network/server errors: retry the whole batch with exponential backoff (2 s … 5 min, jitter).

**Pull:** page through `sync_pull` with the stored cursor. For each row: if the device has a pending
change for it and the server revision differs from the base → **conflict** (nothing is overwritten);
if it is our own echo → skip; otherwise apply (upsert or delete). After each page, run repairs:
rebuild trip destinations from main destinations, fix plan cycles/orphans and positions, and
re-check reservations (a list confirmed on two devices offline that now over-books returns to
draft with a reason).

**Conflict resolution** is explicit: Account → Sync shows each conflict (e.g. "Trip *Kerala*: name
changed on this device and in the cloud") with **Keep this device** (push with the server's revision
as the new base) or **Use cloud version** (apply the server row). Automatic only where nothing can be
lost: identical content, or a cloud delete of a row not changed locally.

**Why the cursor is safe:** `sync_pull` only returns rows whose writing transaction has finished
(`txid < xmin` of the current snapshot), ordered by `(txid, revision)`. A slow transaction that
commits after a faster one is not skipped — its rows appear in a later pull.

**Status:** last synced time, items waiting, conflicts, and the last error, with *Sync now*.

## 6. Google OAuth setup

Flow (G2): `supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo, skipBrowserRedirect: true } })`
→ open the URL with `expo-web-browser` (`openAuthSessionAsync`) → Google → Supabase
`/auth/v1/callback` → redirect to the app's deep link with a PKCE code →
`supabase.auth.exchangeCodeForSession(code)`. PKCE means an intercepted code is useless without the
verifier kept in the app.

Redirect URIs used by the app: `tripprep://auth/callback` (Android/iOS builds; also a dedicated
`com.sreenathsreesree.tripprep://auth/callback` scheme is planned in G2, which needs a new APK), and
`http://localhost:8081/auth/callback` for web development.

## 7. Security and RLS

- RLS **enabled and forced** on every synced table; policies: select / insert / update where
  `user_id = auth.uid()`; **no delete** (tombstones only).
- Owner forced by trigger; `user_id` immutable; composite foreign keys keep references inside one
  account; Google content and device paths blocked by `CHECK` constraints.
- `sync_push` / `sync_pull` are `SECURITY INVOKER` (RLS applies), take table names only from
  `sync_tables`, pass values as parameters, cap batch sizes, and require a signed-in user. The
  stamping trigger is `SECURITY DEFINER` only to use the revision sequence; clients get no rights on
  the sequence or helper functions. `anon` has no access to anything.
- The app holds only the project URL and publishable key. **No service-role key, no OAuth client
  secret** in the app or the repository (the Google secret lives in Supabase's provider settings).
- Session (G2): stored with `expo-secure-store` (encrypted; large sessions split/encrypted as
  Supabase recommends), refreshed automatically; signing out clears it.

Tested (`npm run test:cloud`, real Postgres 17 via PGlite with a stand-in for Supabase's `auth`
schema): RLS isolation, forged owners, cross-account references, anonymous access, idempotent
retries, conflicts, tombstones, per-row rejection, Google-content and photo-path rules, a full trip
graph round trip, cursor paging over 1,200 rows, and exclusion of in-progress transactions.

## 8. Implementation breakdown

| Part | Scope | Needs from you | Native change (new APK) |
| --- | --- | --- | --- |
| **G1** | Cloud schema, RLS, sync RPCs, registry, tests, this design | — | No |
| G2 | supabase-js client, Google sign-in / guest / sign-out, session restore, Account screen, deep-link callback, error states | Supabase project + Google OAuth client (below) | Yes (secure store, web browser, scheme) |
| G3 | Local migration v5 (outbox triggers, base revisions, deterministic ids), per-account database files, guest adoption, initial upload with progress | Migrations applied to the project | No |
| G4 | Push/pull engine, backoff, reconnect, conflicts UI, repairs, Sync status | — | Possibly (network state module) |
| G5 | Second-device restore, incremental sync, sign-out / account switching, reliability tests (multi-device simulation against PGlite) | A second test Google account | No |

## What you need to configure

Do these yourself in the dashboards; never paste passwords, the database password, service-role keys,
or the Google client secret into chat.

### A. Supabase project — done
Project **Trip-prep**, ref `okudcunrqusrzppqnppm`, URL `https://okudcunrqusrzppqnppm.supabase.co`,
region **Southeast Asia (Singapore, `ap-southeast-1`)**. Keep the database password in your password
manager. Never use the `service_role` / secret key in the app.

### B. Apply the migrations (choose one)
- **SQL editor (chosen; works from a phone)**: run `supabase/deploy/g1_bundle.sql` once — see
  [Deploying the schema](#deploying-the-schema).
- **Supabase CLI** on a computer: `npx supabase@latest login`,
  `npx supabase@latest link --project-ref okudcunrqusrzppqnppm`, `npx supabase@latest db push`.
- The access token saved for this cloud session is **read-only** (verification only).

### C. Google OAuth client (Google Cloud console)
1. Create or pick a project (e.g. "Trip Prep"). **APIs & Services → OAuth consent screen**: External,
   app name *Trip Prep*, support email, scopes `openid`, `email`, `profile`; while in *Testing*, add
   your Google accounts as test users.
2. **Credentials → Create credentials → OAuth client ID → Web application** (Supabase talks to
   Google with this client):
   - Authorised JavaScript origins: `https://okudcunrqusrzppqnppm.supabase.co`
   - Authorised redirect URI: `https://okudcunrqusrzppqnppm.supabase.co/auth/v1/callback`
3. Copy the **Client ID** and **Client secret** into Supabase → **Authentication → Sign In / Providers
   → Google** → enable. The secret stays in Supabase.

### D. Supabase redirect settings
Authentication → **URL Configuration**:
- Site URL: `tripprep://auth/callback`
- Additional redirect URLs: `tripprep://auth/callback`, `com.sreenathsreesree.tripprep://auth/callback`,
  `http://localhost:8081/auth/callback`

### E. App configuration (EAS environment variables — not set yet)
expo.dev → SreeDream Labs → project → **Environment variables** → add, for the **development** and
**preview** environments (production later):

| Name | Value | Visibility |
| --- | --- | --- |
| `EXPO_PUBLIC_SUPABASE_URL` | `https://okudcunrqusrzppqnppm.supabase.co` | Plain text |
| `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | the project's publishable key (`sb_publishable_…`) | Plain text or Sensitive |

`EXPO_PUBLIC_` variables are compiled into the app bundle, so they are public by design (Row Level
Security protects the data). Never add the `sb_secret_…` / `service_role` key, the database password
or the Google client secret to EAS or the repository. For local web development the same names go in
a git-ignored `.env.local` (see [`.env.example`](../.env.example)).

## Deploying the schema

Project: **`okudcunrqusrzppqnppm`** — `https://okudcunrqusrzppqnppm.supabase.co` (organisation
`cjwefisfeadtirbqbcwz`, region `ap-southeast-1`). A separate project and Postgres database from
SVALAYA; the access token used for checks can see only this project.

### Chosen path: GitHub Actions with the official Supabase CLI

Workflow: [`.github/workflows/supabase-deploy.yml`](../.github/workflows/supabase-deploy.yml)
(manual `workflow_dispatch` only; nothing runs on push).

| Job | Secrets | Approval | What it does |
| --- | --- | --- | --- |
| `guard` | none | — | Requires the typed ref `okudcunrqusrzppqnppm`; checks the pooler user belongs to it; lists the committed migrations (checksum, size) in order |
| `dry-run` | `SUPABASE_DB_PASSWORD` | **#1** (environment `supabase-production`) | `supabase migration list` (remote history) and `supabase db push --dry-run` — changes nothing |
| `deploy` | `SUPABASE_DB_PASSWORD` | **#2**, requested only after the dry run succeeded | `supabase db push`, then the migration history |

- **Connection** — Supavisor **session pooler**, `aws-1-ap-southeast-1.pooler.supabase.com:5432`,
  user `postgres.okudcunrqusrzppqnppm`, database `postgres`. Confirmed in Dashboard → Connect →
  Session pooler; host, user and database also match the Management API pooler config. (Session mode
  suits migrations; the direct host is IPv6-only and GitHub runners use IPv4.)
- **Secret** — `SUPABASE_DB_PASSWORD`, an *environment* secret of `supabase-production` (readable
  only by approved jobs on branch `ccr-65197697-95agwo`). Masked in logs, also in its URL-encoded
  form and inside the connection string. No Supabase access token is used by the workflow.
- **Environment** — required reviewer `sreenathsreesree`, self-review allowed, deployment limited to
  branch `ccr-65197697-95agwo`. Required reviewers on environments are available for public
  repositories on every GitHub plan.
- **Supabase CLI** pinned to 2.58.5 (the version tested locally: the dry run lists exactly the two
  committed files; the push applies them in order and records versions `20261111090000` and
  `20261111090100`). Actions logs of a public repository are public; they contain no secrets.
- **After deploying** — run the read-only verification below, then optionally reset the database
  password so the stored secret stops working.

**Running it from the GitHub app or a mobile browser:** Actions → *Deploy Supabase migrations (Trip
Prep)* → **Run workflow** → branch `ccr-65197697-95agwo` → type `okudcunrqusrzppqnppm` → **Run
workflow**. Then on the run page → **Review deployments** → tick `supabase-production` →
**Approve and deploy** (once for the dry run; read its log; again for the deploy).

### Alternative: SQL editor bundle

[`supabase/deploy/g1_bundle.sql`](../supabase/deploy/g1_bundle.sql) is generated from
`supabase/migrations/` (`npm run supabase:bundle`; a test fails if it is out of date). It runs every
migration in one transaction, records the same migration history as `supabase db push`, and refuses
to run if Trip Prep tables already exist. Paste once into Supabase → SQL Editor → Run.

### Verification (read-only)

`npm run supabase:verify -- okudcunrqusrzppqnppm` builds the expected catalog from the migrations in
local Postgres and compares it exactly with the live project: tables and columns, RLS flags, policies
(with definitions), indexes, triggers, constraints, functions (security mode and settings),
privileges for `anon` / `authenticated`, and migration history. It uses the Management API with a
read-only token (queries run as `supabase_read_only_user`).
