# Journey Journal, Shared Trips and Trip Calculator (Phases K–N)

Technical audit and plan, written before implementation. Status per phase is at the end.

## 1. Starting point (audit, commit `1b810ee`)

| Area | What exists | Consequence |
| --- | --- | --- |
| Local storage | SQLite schema **v6** (`src/db/migrations/0001–0006`), repositories, Zustand stores; photos copied into the app's document folder (`src/lib/imageStore.ts`, data URIs on web) | New features add versioned migrations (v7, v8, …) and follow screen → store → repository |
| Memories | `plan_node_memories` (v6): one record per destination — date, rating, notes, moments, photo URIs. Device-only, local-only in the sync registry | The journal **reuses** these (shown in the trip timeline), it does not replace them |
| Google sign-in | G2: Supabase Auth, Google provider, PKCE, `tripprep://auth/callback`, session in SecureStore. Scopes: Supabase defaults (email, profile) | Drive needs an extra scope (`drive.file`) obtained with explicit consent |
| Supabase | G1 schema deployed: every table is **owner-partitioned** (`primary key (user_id, id)`, RLS `user_id = auth.uid()`), sync RPCs. Nothing in the app reads or writes data yet | Sharing cannot use these tables (one owner per row). It needs its own membership-based tables and policies |
| Sync | Registry only (`src/features/sync/tables.ts`). G3 (upload) and G4 (bidirectional sync) **not built** | Personal data does not reach the cloud yet. Shared trips therefore get their own, smaller sync path (shared tables only) |
| Travellers | `trip_travellers` (local names, no accounts) | Expense participants are travellers locally; in a shared trip they can be linked to members |

## 2. Principles

1. **Offline first.** Every journal entry, expense and split is written to SQLite first. Cloud and Drive
   are background copies with visible status and retry.
2. **Private by default.** Every new record has `visibility = 'private'`. Only records the user marks
   *shared*, in a trip they have shared, ever leave the device for the shared space.
3. **Privacy enforced on the server, not only in the app.** Shared data lives in separate cloud
   tables whose RLS allows access only to members of that trip, by role. Private personal data never
   enters those tables. Security-definer functions do membership checks; clients never supply a user id.
4. **Google Drive is the user's own storage**, separate from Supabase. Trip Prep uses the
   `drive.file` scope, so it can see only files it created — never the rest of the user's Drive.
5. **Nothing invented.** No made-up exchange rates, balances or sample entries.
6. **Approvals.** Cloud migrations are written and tested against Postgres (PGlite) but **not
   deployed**. Google Cloud changes (Drive API, consent-screen scope) are listed for the owner. No
   billing, no APK.

## 3. Phase K — Journey Journal and personal Google Drive storage

**Scope (assumed; the detailed brief was not in this session):** a per-trip journal of dated entries
(title, text, mood, optional destination, photos), a day-by-day timeline that also shows the
existing destination memories, and an optional backup of the journal and its photos to the user's
own Google Drive, with restore on another device.

**Local schema v7** (additive):

- `journal_entries` — id, trip_id → trips (cascade), node_id → trip_plan_nodes (set null),
  entry_date (YYYY-MM-DD), title, body, mood (`great|good|okay|tired|bad` or null), visibility
  (`private|shared`, default private), position, created_at, updated_at.
- `journal_photos` — id, entry_id (cascade), uri, caption, position, created_at.
- `drive_files` (v7) and `drive_photo_uploads` (v8, see the correction below) — local_kind (`journal|photo`), local_id, drive_file_id, content_hash, synced_at;
  the record of what is already in Drive, so backups upload only what changed.

All three are local-only in the sync registry (personal journal; Drive is its backup).

**Drive design:**

- Folder `Trip Prep` → one folder per trip; `journal.json` (entries, captions, photo file names)
  plus one file per photo. Every file carries `appProperties` (`tripprep`, `tripId`, `kind`,
  `localId`) so restore finds them without browsing.
- Uploads: multipart for JSON and photos (resumable only if a photo exceeds 5 MB). Content hashes
  skip unchanged files; failures leave the local data untouched and are retried on the next backup.
- Restore: lists the app's own files, downloads `journal.json`, **adds** entries and photos that are
  missing locally; an entry that exists on both sides with different content is kept as it is on
  the device and reported (never silently overwritten).
- Token: *Connect Google Drive* re-runs the Google sign-in with the extra `drive.file` scope
  (`include_granted_scopes`, `login_hint` = signed-in email). The Google access token from that
  exchange is kept in SecureStore with its expiry (~1 hour) and never logged or synced. Refreshing it
  without asking again would need the Google client secret on a server (an Edge Function) — deferred;
  until then an expired token shows *Reconnect* (one tap).
- If the user picks a different Google account than the signed-in one, the Drive token is discarded
  and they are told to use the same account.

**Built:** `src/features/journal/` — `model.ts` (validation, timeline, backup format, additive restore
plan), `journalRepository.ts`, `journalStore.ts`, `drive/driveClient.ts` (Drive v3 REST, error
mapping), `drive/driveAuth.ts` (scoped consent, token in SecureStore, account check, expiry),
`drive/driveBackup.ts` (folders, change detection, recreate-if-deleted, restore), `drive/driveStore.ts`;
screens `/trips/[tripId]/journal` and `/trips/[tripId]/journal/entry?entryId=`; dashboard card and trip
menu entry. The Drive token is also cleared on sign-out. Tests: `journal.test.ts`, `drive.test.ts`,
`driveAuth.test.ts`, migration list; browser suite `npm run e2e:journal`.

**Not verifiable here:** the live Drive calls (no Drive-enabled project or real Google account in
this environment) and native photo byte reads/writes on Android — both need a device check once
configured. Endpoints follow Drive API v3 (`files`, `upload/drive/v3/files?uploadType=media`,
`alt=media`, `appProperties` queries); confirm against Google's documentation before release.

**Owner configuration (no billing):** enable **Google Drive API** in the Trip Prep Google Cloud
project; add `.../auth/drive.file` to the OAuth consent screen; set
`EXPO_PUBLIC_GOOGLE_DRIVE_ENABLED=true` in EAS. Until then the journal works fully and the Drive card
says "not set up".

### Phase K correction — automatic photo upload (requirements audit)

Approved requirement: *photos selected in Memories upload automatically to the user's own Google
Drive immediately after selection.*

| Check | Committed Phase K (`a0eaa0f`) | After the correction |
| --- | --- | --- |
| Automatic per-photo upload | **Missing.** Only a manual *Back up now* for journal photos; destination Memories photos never reached Drive | Picking a photo in Memories or the journal queues it and starts the upload at once (when Drive is connected and *Upload photos automatically* is on — default on) |
| Originals in the user's Drive, not Supabase Storage | Drive only (manual); Supabase Storage never used | Same: Drive only. No Supabase Storage bucket, no Trip Prep server sees photos |
| Trip Prep keeps only references and metadata | `drive_files` (id, hash) for backups | `drive_photo_uploads` (local v8): Drive file id, status, attempts, timestamps per photo and Google account. A device copy is kept for offline use until the user frees space |
| Progress, retry, offline queue/resume | Backup progress bar only; offline backup simply failed | Persistent queue; retries after 1, 2, 5, 15, 30, 60 min; after 8 tries waits for *Retry*; resumes on launch, on returning to the app, every minute while photos wait, and after reconnecting; per-photo badges and a status line |
| Photos display in Memories from Drive | Device copies only | Device copy when present; otherwise downloaded from the user's Drive (cached), or a clear "In Drive — connect to view" |
| Disconnect / reconnect / expiry | Reconnect prompt for backup | Expired or revoked access pauses the queue without failing anything; reconnecting continues it. Disconnect keeps the queue on the device. Photos are tied to the Google account that queued them and never go to another account's Drive |
| Journal deletion vs Drive original | Entry deletion removed device photos; Drive copies stayed (stated) | Unchanged and explicit: removing a photo or an entry removes it from Trip Prep and forgets its upload record; **the original in Drive is never deleted by Trip Prep** |
| No upload to Trip Prep infrastructure | None | None: the only network destination for photos is `googleapis.com` with the user's own token |

Also added: *Upload N earlier photos* for photos picked before Drive was connected (never uploaded
silently), *Free up space on this phone* (Android/iOS) for photos already in Drive, and the manual
journal backup now skips photos the queue already uploaded (and vice versa). Tests:
`photoUploads.test.ts` (upload into the trip folder, offline backoff and resume, expiry pause and
resume, Drive off / full, account isolation, missing device copy, deleted Drive folder recreated,
removal keeps the original, display from Drive and cache, earlier photos, setting).

**Not verifiable here:** real uploads to Google Drive and native file reads/writes (needs the Drive
API configured and a device).

## 4. Phase L — Shared Trips, invitations, roles, private/shared spaces

**Cloud migration** (new file, not deployed), separate from the G1 owner tables:

- `shared_trips` — id, created_by, name, dates, created_at, updated_at, revision.
- `shared_trip_members` — trip_id, user_id, role (`owner|editor|viewer`), display_name, joined_at.
  Exactly one owner; the owner cannot leave without transferring ownership.
- `shared_trip_invites` — id, trip_id, token **hash** (SHA-256; the raw token exists only in the
  invite link), role (`editor|viewer`), expires_at, max_uses, uses, revoked_at, created_by.
- Shared content tables (`shared_journal_entries`, later `shared_expenses`, `shared_expense_splits`,
  `shared_settlements`), each keyed `(trip_id, id)`, with `author_id` stamped from `auth.uid()`.
- RLS through security-definer helpers `trip_role(trip_id)`: members read; editors and owner write;
  authors edit their own journal entries; viewers read only. Invite/accept/leave/remove/role changes
  only through RPCs (`create_trip_invite`, `accept_trip_invite`, `revoke_trip_invite`,
  `set_member_role`, `remove_member`, `leave_shared_trip`) with checks inside; direct table writes to
  membership are denied.

**App:** *Share this trip* (signed-in only) creates the shared trip and an invite link
(`tripprep://join/<token>`, also shareable as text); members list with roles; leave / remove;
per-record *Private / Shared* switch with the private default. A local outbox (`shared_outbox`)
pushes shared records and pulls changes by revision when online; conflicts follow the G4 rule
(no silent overwrite of newer local edits).

**Approval needed before it works live:** deploying the shared-trip migration to Supabase.

## 5. Phase M — Trip Calculator and Splitwise-style expenses

- **Personal workspace** (private, per trip, local only) and **shared workspace** (per shared trip,
  synced through Phase L's tables and policies).
- Expenses: amount in **minor units** (integers, no floating point), currency, date, category,
  note, payer, split method `equal | exact | percent | shares`, participants. Splits computed with
  largest-remainder rounding so they always add up exactly.
- Balances per currency (no invented exchange rates; an optional user-entered rate converts for a
  summary, labelled as such), *simplify debts* (minimum transfers), settlements recorded as
  payments, budget per trip with totals by category and by day, and a plain calculator for quick sums.
- Participants: trip travellers locally; members in a shared trip (with unlinked travellers allowed).

## 6. Phase N — integration and regression

Full `npm run check`, cloud (PGlite) tests for every new policy and RPC — including attempts by
non-members, viewers and removed members — all browser suites at 360 px, offline runs, restart
persistence, Android bundle export, docs and a final report.

## 7. Phase status

| Phase | Status |
| --- | --- |
| K | Done — journal, timeline, Drive backup/restore (Drive live once configured) |
| L | Planned |
| M | Planned |
| N | Planned |
