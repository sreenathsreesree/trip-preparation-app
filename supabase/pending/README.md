# Pending cloud migrations — not deployed

Migrations here are written and tested (`npm run test:cloud` applies them on top of
`supabase/migrations/` in PGlite) but **must not be deployed without explicit approval**.

The deploy workflow (`.github/workflows/supabase-deploy.yml`) applies only
`supabase/migrations/`, so nothing here can be deployed by accident. To deploy after
approval: move the file into `supabase/migrations/` (keeping its timestamp order),
rebuild the SQL-editor bundle if that path is used, and run the workflow.

| File | Phase | What it adds |
| --- | --- | --- |
| `20261113090000_shared_trips.sql` | L | Shared trips, members and roles, hashed invitations, shared journal entries, membership functions, `shared_pull` |
| `20261114090000_shared_expenses.sql` | M | Shared expense participants, group expenses with exact splits, settlements and budgets; members read, owners/editors write; requires the shared-trips migration |
