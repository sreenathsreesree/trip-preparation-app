# Trip Prep — Phase N audit and November 20 travel readiness

Audited at commit `9b36fac` (the installed preview APK, build `ff3e6e97`). Nothing in this document
has been deployed or configured; every cloud or Google step below needs the owner's approval.

## 1. Phase N findings and fixes

| # | Area | Finding | Severity | Action |
| --- | --- | --- | --- | --- |
| N1 | Data safety | **Delete trip warning under-reported what is lost.** It listed destinations, travellers and checklist tasks only; journal entries, photos, expenses and payments (Phases K–M) were deleted silently with the trip. | High (irreversible data loss without warning) | Fixed: the warning now names journal entries, photos (and that Drive copies stay) and expenses/payments. |
| N2 | Shared trips | **Deleting a shared trip orphaned the cloud copy.** The local delete cascaded the link, leaving the shared trip and its members in the cloud with no way to remove it from the app. | Medium (only once sharing is deployed) | Fixed: a shared trip can't be deleted until the owner stops sharing (or a member leaves); the app says how. |
| N3 | Deployment | The SQL-editor bundle script includes every file in `supabase/migrations/`, so moving the pending migrations there makes the bundle test fail unless the bundle is regenerated in the same commit. | Process | Documented in section 3 (deployment steps). |
| N4 | Storage | Deleting a trip removes its photo rows but leaves the image files in the app's private folder (no data loss; uses storage). | Low | Deferred (not needed for the trip). |
| N5 | Account boundary | Group expenses pulled from a shared trip are stored in the device database and stay visible after sign-out on that device (journal entries from others are hidden). | Low (single-user phone) | Resolved properly by per-account database files in G3 (section 2). |

Verified with no defects found:

- **Database:** foreign keys on in the app and tests; WAL on device; all migrations additive
  (v7–v10 contain no `DROP`/`ALTER`/`DELETE`/`UPDATE`/`INSERT`); upgrade **v6 → v10 with real data
  leaves every existing row unchanged**; `integrity_check` and `foreign_key_check` clean.
- **Cross-feature integrity:** one trip using every feature (planner, route, Navigation, companion
  data, journal and photos, Drive queue, shared link, expenses, settlements, budget, custom category)
  deletes with no orphan rows in 22 trip tables and leaves a second trip byte-identical; duplicating a
  trip copies the plan but never journal, memories, expenses or sharing.
- **Offline and queues:** Drive photo queue (account-scoped, backoff, pause on expired access),
  shared journal outbox and expense outbox (re-read at send time; personal expenses never queued);
  queued work survives restarts. Browser suites cover offline use for planner, packing, journal and
  calculator.
- **Personal vs shared:** private by default; personal expenses never in balances or the cloud
  (tested on device, in the sync engine and by the database schema, which has no personal scope);
  journal entries shared only by explicit switch; leaving/stopping sharing makes entries private.
- **Authentication and ownership:** session in SecureStore; the Google Drive token is bound to the
  signed-in account, never kept from a normal sign-in, cleared on disconnect and sign-out; every
  shared/Drive code path checks the account; no Supabase Storage use anywhere.

## 2. G3/G4 — cross-device synchronization plan

### Principles (as required)

Google account = identity (Supabase Auth). Supabase Postgres = structured personal data. Google
Drive = photos and files. SQLite = the offline-first source the UI reads. Nothing is overwritten
silently; personal data is private (owner-only RLS, already deployed in G1).

### What the deployed G1 cloud already covers

17 tables with owner-only RLS and the push/pull protocol (`sync_push` with base revisions,
`sync_pull` with a commit-order cursor, tombstones, idempotent retries): trips, travellers,
checklist templates/sections/tasks, inventory categories/items/reservations, packing
(trip settings, entries, recommendations, luggage), purchase items, places, plan nodes, route stops,
user preferences.

### What G3 must add

**Cloud migration "G3-schema" (pending approval, additive only, G1 tables untouched):**

| Local table (version) | Cloud table | Notes |
| --- | --- | --- |
| `inventory_categories.description`, `packing_entries.unit` (v5) | add columns | Columns marked local-only today |
| `trip_navigation_items` (v6) | new, rank 4 | `parent_id` self-reference, `node_id` → `trip_plan_nodes` |
| `plan_node_profiles`, `_tasks`, `_notes`, `_alerts`, `_memories` (v6) | new, rank 3 | cover image and memory photos synced as **Drive file ids**, never device paths |
| `journal_entries` (v7) | new, rank 3 | `node_id` → plan node (set null) |
| `journal_photos` (v7) | new, rank 4 | `drive_file_id`, caption, position; `uri` stays local |
| `expense_participants`, `expense_categories`, `expense_settings`, `expense_budgets` (v10) | new, rank 2–3 | personal ledger, owner-only |
| `expenses`, `expense_splits`, `expense_settlements` (v10) | new, rank 4–5 | `paid_by`/split participants → participants |

Never synced (device state): `drive_files`, `drive_photo_uploads` (except the Drive id it produced),
`shared_*` caches/outboxes, `expense_outbox`, `trip_destinations` (derived).

**Local migration v11** (additive):

- `sync_outbox` + triggers on every synced table (insert/update/delete → queued change), `sync_state`
  (per table base revision, pull cursor, last synced), `sync_conflicts`.
- `memory_photos` table (node_id, position, local_uri, drive_file_id) replacing the JSON array of
  device paths in `plan_node_memories.photos` (back-filled from it), so memories reference Drive files
  that a second device can download.
- Deterministic ids for shared reference rows (starter categories by `system_key`, places by Place
  ID, packing suggestions by trip + rule) so two devices never create duplicates.

### Ownership and foreign keys

Cloud keys are `(user_id, id)`; every foreign key includes `user_id`, so references can only point to
the same user's rows (proven in G1 tests). Local ids are random UUID-style and already globally unique,
so they are reused as cloud ids — no id rewriting, so every reference survives. Push in rank order
(parents before children); pull applies in commit order and defers a child whose parent has not
arrived yet. `user_id` is never sent by the client; the server stamps it.

### Shared trips vs personal sync

For a trip linked to a shared space, group expenses, settlements, participants and the budget sync
only through the shared tables (Phase L/M); the personal channel carries personal-scope expenses and
everything else. One owner of each row, no double sources.

### Guest data and account switching

- **Per-account database files:** `trip-prep-guest.db` and `trip-prep-<userId>.db`. Signing out
  closes the account file; another account never sees it.
- **First sign-in (adoption):** ask "Add the trips on this phone to your account?" Yes → the guest
  file is copied into the account file (guest kept as a backup until the upload is confirmed), every
  row queued, uploaded in rank order with progress. No → the guest data stays in the guest file.
- **Second device / reinstall:** download everything into the account file first, then (if chosen)
  add guest rows as new records. Same-id rows that differ become explicit conflicts.

### G4 — bidirectional sync and conflicts

- Triggers: app start, foreground, after local writes (debounced), every few minutes while open,
  manual *Sync now*; exponential backoff on network errors; resumable (outbox-driven, idempotent).
- Conflicts: push carries the base revision. If the server row changed meanwhile, the server copy is
  stored in `sync_conflicts` and the user chooses (keep mine / keep theirs) — no silent overwrite.
  Deletions vs edits: an edit beats a remote tombstone only by explicit choice.
- Status UI: last synced, waiting changes, conflicts, errors (Profile → Account).

### Effort and risk

G3 (schema + v11 + upload + download/restore, adoption): 3–4 focused days with tests. G4 (continuous
two-way sync and conflict UI): 3–5 more days. **Recommendation for November 20:** ship G3 as a
**one-way backup and restore** (upload from the travelling phone; restore onto a second device) and
leave continuous two-way editing (G4) until after the trip.

### G3 as built (backup and restore, automatic, not real-time)

- **Cloud (pending, not deployed):** `supabase/pending/20261112090000_personal_backup.sql` — 16 new
  tables registered with the G1 protocol and prepared by G1's own `sync_prepare_table` (forced RLS,
  owner-only policies, no deletes, stamping trigger). G1 unchanged (tested). 8 Postgres tests: registry
  parity with the client, RLS shape, owner isolation, user-scoped foreign keys (another account cannot
  point at your records), forged owners ignored, device photo paths rejected, idempotent retries,
  conflicts instead of overwrites, tombstones.
- **Device:** local v11 (`sync_meta`, `sync_rows`, `sync_conflicts`, `drive_cache`);
  `src/features/sync/adapters.ts` (table mapping, photos → Drive references), `syncEngine.ts`
  (download then upload, conflicts kept, interrupted uploads resume, server ids adopted for a fresh
  phone's starter categories and places), `syncApi.ts`, `syncStore.ts`, `SyncWatcher` (after sign-in,
  launch, foreground, every 5 minutes), Profile → *Cloud backup* card.
- **Account binding:** this phone's data is linked to one Google account. A fresh install links
  silently and downloads; a phone with data asks *Back up this phone's trips?* first (nothing uploads
  until then); a different account is refused. Data stays on the phone after sign-out.
- **Works today with G1 alone:** trips, travellers, destinations/hierarchy, route, checklists,
  packing, inventory, shopping, places and settings. The journal, memories, destination details,
  Navigation and the calculator join once the G3 migration is deployed (the app detects it).
- **Not supported:** real-time sync; automatic merging of the same record edited on two phones (the
  user picks *keep this phone's* or *use the cloud's*); shared-trip links (a restored shared trip is a
  private copy until re-joined); per-account database files on one phone (one account per phone).
- **Tests:** `src/features/sync/__tests__/syncEngine.test.ts` — full restore with identical ids and
  relationships and no duplicate starter categories, incremental changes, deletions, conflicts and both
  resolutions, interrupted upload, guest adoption with existing cloud data, account isolation, G1-only
  operation; Drive-reference photo display.

## 3. Pending migration readiness (Shared Trips and Expenses)

| Check | Result |
| --- | --- |
| Dependency order | `20261113090000_shared_trips.sql` then `20261114090000_shared_expenses.sql` (timestamp order; expenses reuse `shared_trip_role`, `shared_trip_can_write`, `shared_revision_seq`, `shared_content_tables`) |
| Isolation from G1 | Test proves the G1 catalog (tables, policies, columns) is identical with or without them |
| RLS | Forced on every table; select = members; insert/update = owner/editor (journal entries: author only); no delete policies anywhere (tombstones) |
| Membership changes | Only via security-definer functions checking `auth.uid()`; direct writes to members/invites denied |
| Invitations | 192-bit random token from the device, only its SHA-256 stored; 7-day expiry, 10 uses, revocable; joining needs an explicit *Join* and creates membership only then; rejoining never changes a role |
| Roles | Owner (one, enforced by unique index) / Editor / Viewer; owner-only invite, role change, removal, transfer, delete; owner must transfer before leaving |
| Tests | 38 Postgres tests (17 sharing + 21 expenses) attack the rules as strangers, anonymous, viewers, editors, demoted and removed members |
| Postgres features | `gen_random_uuid`, `sha256`, `xid8`, `pg_current_xact_id` — all available on the project's Postgres 17 |

**Gaps against the requested sharing model** (not built; need new pending migrations and app work):

| Requested | Status |
| --- | --- |
| Shared Trip Space / private My Trip Space | Done (private by default; shared only by explicit action) |
| Shared journal entries, group expenses, settlements, budget | Done |
| Shared itinerary (plan hierarchy), route, Navigation | **Not built** |
| Group checklist | **Not built** |
| Shared documents | **Not built** (needs Drive sharing permissions, a larger scope than `drive.file` alone) |
| Personal packing, documents, journal, photos, expenses private | Done (never sent) |

**Deployment steps (after explicit approval):** move both files into `supabase/migrations/` in one
commit, regenerate the SQL bundle (`npm run supabase:bundle`) or limit that script to the G1 files, run
`npm run check`, then run the existing *Deploy Supabase migrations* workflow (dry run first). No APK
change is needed: the app detects the functions and switches sharing on.

## 4. Google Drive activation checklist

Code status (verified): `drive.file` scope only; connection bound to the signed-in Google account
(another account is refused); automatic upload right after picking a photo in Memories or the journal;
persistent queue with retries, pause on expired access and resume after reconnecting; photos shown
from Drive when the device copy is gone; no Supabase Storage; removing an entry or photo never deletes
the Drive original.

Owner configuration (no billing involved; no secrets need to be shared):

1. **Google Cloud console → APIs & Services → Library → Google Drive API → Enable**, in the same
   project as the OAuth client Supabase uses for Google sign-in.
2. **OAuth consent screen → Data access / Scopes → add `.../auth/drive.file`.** It is a
   non-sensitive scope; while the app is in *Testing*, the travelling accounts must be listed as test
   users (they already are if sign-in works).
3. **Supabase:** no change (the app asks for the extra scope at *Connect Google Drive*).
4. **EAS:** add `EXPO_PUBLIC_GOOGLE_DRIVE_ENABLED` = `true` (plain text, *preview* environment).
5. **Rebuild the preview APK** (the flag is built into the app) — needs your build approval.
6. On the phone: Journal → *Connect Google Drive* → choose the signed-in account → allow Drive. Then
   *Upload N earlier photos* once, and *Back up now* for the journal.

## 5. Dependencies and critical blockers

- **Biggest current risk: all trip data lives only on this phone.** Uninstalling the app, a lost or
  broken phone, or clearing app data loses plans, journal, memories and expenses. Until Drive and G3
  are active there is no backup. **Do not uninstall the app** before the trip; installing a newer
  preview APK over it keeps the data (same package and keystore; same version code is accepted).
- Drive activation depends only on owner configuration + one rebuild.
- G3 depends on approval of a new cloud migration (additive, G1 untouched) and on Drive for photos.
- Shared trips depend on deploying the two pending migrations; full itinerary/checklist sharing needs
  further work (section 3).
- Live Google Places needs billing — out of scope by decision.

## 6. Automated test results (this audit)

| Suite | Result |
| --- | --- |
| Jest (unit and integration) | 48 suites, **390 tests passed** (new: cross-feature integration, v6 → v10 upgrade, additive-migration guard, deletion impact) |
| Postgres (PGlite): G1 + pending sharing + pending expenses | **59 passed** |
| TypeScript, ESLint | clean |
| Browser suites at 360 px | **11 / 11 passed**: web, inventory, packing, planner, planner-reliability, planner-dnd, destination, journal, sharing, calculator, auth |
| Android bundle export | passed |

## 7. Two-device testing procedure (after G3 / sharing activation)

Use two Android phones (A = the traveller's, B = a test phone), the same preview APK on both.

1. **Before anything:** on A, note counts (trips, journal entries, photos, expenses) for comparison.
2. **Guest adoption (G3):** on A sign in with Google → choose *Add the trips on this phone* → wait for
   "N items backed up". Check counts unchanged on A.
3. **Restore:** on B (fresh install) sign in with the same account → everything appears; open a
   memory with photos (downloads from Drive); check expense balances match A to the minor unit.
4. **Offline:** on A turn on flight mode, add a journal entry, a photo and an expense; turn it off →
   they upload (status shows 0 waiting); B receives them after *Sync*.
5. **Interrupted upload:** start uploading several photos on A, force-close the app midway, reopen →
   the queue resumes; no duplicates in Drive.
6. **Conflict (G4 only):** edit the same expense offline on both, sync both → a conflict is shown, not
   overwritten.
7. **Account switch:** sign out on B, sign in with a second Google account → none of A's data is
   visible; sign back in → it returns.
8. **Sharing (after migrations):** A shares a trip and invites B's second account as Editor; B joins,
   sees shared journal entries and group expenses, adds one; A sees it. Change B to Viewer → B can no
   longer edit. Remove B → B loses access, keeps what is already on the phone. Personal expenses on
   either phone never appear on the other.
9. **Drive ownership:** in drive.google.com for each account, the *Trip Prep* folder holds only that
   account's photos; deleting a journal entry in the app leaves its photo in Drive.

## 8. Prioritized plan to November 20, 2026

| When | Priority | Work | Needs |
| --- | --- | --- | --- |
| Now | P0 | Keep the installed APK; **do not uninstall**; this audit's fixes (N1, N2) are committed | — |
| Nov 13 | P1 | **Activate Google Drive** (section 4 steps 1–4), rebuild preview APK, connect on the phone, upload earlier photos, back up the journal | Your Google Cloud + EAS changes, build approval |
| Nov 13–16 | P1 | **G3 backup & restore:** cloud migration for the v5–v10 tables (pending until approved), local v11 (outbox, memory photos table, per-account files, adoption), upload + restore with progress, tests incl. the two-device procedure | Migration deployment approval |
| Nov 16–17 | P2 | Optional: deploy shared trips + expenses if travelling with others who will use the app | Deployment approval |
| Nov 17 | — | Two-device test (section 7, steps 1–5, 7–9); fix only defects found | Second phone |
| Nov 18 | — | **Code freeze**; final preview APK; install over the current one (no uninstall); verify data intact | Build approval |
| Nov 19 | — | Final backup check on the phone (Drive photos, last sync time) | — |
| Nov 20 | — | Travel. No schema changes during the trip | — |
| After the trip | P3 | G4 continuous two-way sync and conflict UI; shared itinerary/route/checklist/documents | — |
