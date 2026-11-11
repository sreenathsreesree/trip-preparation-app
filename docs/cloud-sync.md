# Google sign-in & cloud sync (Milestone G)

Status: **G1 done** — cloud schema, Row Level Security and the sync protocol, tested against real
Postgres. Nothing in the app talks to Supabase yet. G2 onwards needs the configuration in
[What you need to configure](#what-you-need-to-configure).

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

### A. Create the Supabase project
1. supabase.com → your organisation → **New project** → name `trip-prep`, region **South Asia (Mumbai)**,
   strong database password (store it in your password manager).
2. Project Settings → API: note the **Project URL** and the **publishable (anon) key**. Never use the
   `service_role`/secret key in the app.

### B. Apply the migrations (choose one)
- **Supabase CLI** on your computer: `npx supabase@latest login`, `npx supabase@latest link --project-ref <ref>`,
  `npx supabase@latest db push` (applies `supabase/migrations/`).
- **SQL editor**: run the two files in `supabase/migrations/` in name order.
- **Or let me apply them** from this cloud session: allow host `api.supabase.com` and save a Supabase
  personal access token through the secure credential form when I ask (it is injected by the proxy;
  I never see it). You can revoke the token afterwards.

### C. Google OAuth client (Google Cloud console)
1. Create or pick a project (e.g. "Trip Prep"). **APIs & Services → OAuth consent screen**: External,
   app name *Trip Prep*, support email, scopes `openid`, `email`, `profile`; while in *Testing*, add
   your Google accounts as test users.
2. **Credentials → Create credentials → OAuth client ID → Web application** (Supabase talks to
   Google with this client):
   - Authorised JavaScript origins: `https://<ref>.supabase.co`
   - Authorised redirect URI: `https://<ref>.supabase.co/auth/v1/callback`
3. Copy the **Client ID** and **Client secret** into Supabase → **Authentication → Sign In / Providers
   → Google** → enable. The secret stays in Supabase.

### D. Supabase redirect settings
Authentication → **URL Configuration**:
- Site URL: `tripprep://auth/callback`
- Additional redirect URLs: `tripprep://auth/callback`, `com.sreenathsreesree.tripprep://auth/callback`,
  `http://localhost:8081/auth/callback`

### E. App configuration
Set `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
(see [`.env.example`](../.env.example)) as EAS environment variables for the `development` and
`preview` environments, and tell me the **Project URL** (not secret) so I can configure and verify
the app. The publishable key is designed to ship inside apps; I can read it from EAS rather than chat.
