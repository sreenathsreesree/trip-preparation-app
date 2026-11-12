-- ROLLBACK for 20261112090000_personal_backup.sql — NOT A MIGRATION; run only if a rollback is approved.
--
-- Removes the 16 G3 backup tables and their 16 rows in public.sync_tables. Nothing else:
-- G1 tables, rows, functions, policies and grants are untouched (tested in supabase/tests/backup.test.mjs).
-- Consequence: the cloud copies of journal entries, memories metadata, destination details, Navigation
-- and the trip calculator are deleted. Phones keep all their data; the app forgets what it had sent to
-- these tables and uploads everything again if they come back.
--
-- To stop deployments re-applying the migration, also delete its history row (same transaction), e.g.
--   delete from supabase_migrations.schema_migrations where version = '20261112090000';
-- and move the file back to supabase/pending/ in git.

begin;

delete from public.sync_tables where name in (
  'expense_participants', 'expense_categories', 'expense_settings', 'expense_budgets', 'inventory_category_details',
  'trip_navigation_items', 'plan_node_profiles', 'plan_node_tasks', 'plan_node_notes', 'plan_node_alerts', 'plan_node_memories',
  'journal_entries', 'expenses', 'expense_settlements', 'journal_photos', 'packing_entry_units');

-- Children first (foreign keys).
drop table if exists public.journal_photos;
drop table if exists public.packing_entry_units;
drop table if exists public.expense_settlements;
drop table if exists public.expenses;
drop table if exists public.journal_entries;
drop table if exists public.plan_node_memories;
drop table if exists public.plan_node_alerts;
drop table if exists public.plan_node_notes;
drop table if exists public.plan_node_tasks;
drop table if exists public.plan_node_profiles;
drop table if exists public.trip_navigation_items;
drop table if exists public.inventory_category_details;
drop table if exists public.expense_budgets;
drop table if exists public.expense_settings;
drop table if exists public.expense_categories;
drop table if exists public.expense_participants;

commit;
