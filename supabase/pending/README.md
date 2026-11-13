# Pending cloud migrations — not deployed

Migrations here are written and tested (`npm run test:cloud` applies them on top of
`supabase/migrations/` in PGlite) but **must not be deployed without explicit approval**.

The deploy workflow (`.github/workflows/supabase-deploy.yml`) applies only
`supabase/migrations/`, so nothing here can be deployed by accident. To deploy after
approval: move the file into `supabase/migrations/` (keeping its timestamp order),
rebuild the SQL-editor bundle if that path is used, and run the workflow.

| File | Phase | What it adds |
| --- | --- | --- |
| ~~`20261113090000_shared_trips.sql`~~ (moved to `supabase/migrations/` for deployment) | L | Shared trips, members and roles, hashed invitations, shared journal entries, membership functions, `shared_pull` |
| ~~`20261114090000_shared_expenses.sql`~~ (moved to `supabase/migrations/` for deployment) | M | Shared expense participants, group expenses with exact splits, settlements and budgets; members read, owners/editors write; requires the shared-trips migration |
| `20261116090000_shared_workspace.sql` | Phase 2 | Group Trip workspace: `shared_trip_items` (itinerary places, group checklist, shared documents/bookings, group notes, member readiness). Forced RLS: members read, owners/editors write, everyone only their own readiness flag; personal document types refused; compare-and-set (`base_updated_at`) so concurrent edits never overwrite; no deletes. Rollback: `rollback/…down.sql`. Tests: `supabase/tests/workspace.test.mjs` |
| ~~`20261115090000_revoke_table_maintenance_privileges.sql`~~ (moved to `supabase/migrations/` for deployment) | Security | Revokes TRUNCATE, REFERENCES, TRIGGER, MAINTAIN from anon/authenticated/PUBLIC on all public tables and in postgres' default privileges. No data, policy or function change. Rollback: `rollback/…down.sql` |
| ~~`20261112090000_personal_backup.sql`~~ (moved to `supabase/migrations/` for deployment) | G3 | Personal backup tables for the data added after G1 (destination details, journal, memories metadata, trip calculator, v5 columns in side tables); registered with the G1 sync protocol; independent of the shared-trip files |

Deployment order when approved: `20261112090000_personal_backup.sql` (G3) sorts after G1 and before the
shared-trip files, so it can be deployed alone now and the shared-trip files later, still in order (the
Supabase CLI refuses migrations older than the last one applied). The shared-trip files go together, in
timestamp order.

**Deploying G3:** the commit is only `git mv supabase/pending/20261112090000_personal_backup.sql
supabase/migrations/` — the SQL-editor bundle stays the G1-only setup bundle and every test is written to
pass in both layouts (verified by simulating the move). Then run *Deploy Supabase migrations (Trip Prep)*:
dry run first, then deploy. Rollback script (not a migration): `rollback/20261112090000_personal_backup.down.sql`.
