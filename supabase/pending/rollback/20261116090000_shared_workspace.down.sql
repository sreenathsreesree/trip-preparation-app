-- Rollback for 20261116090000_shared_workspace.sql (not a migration).
-- Removes the group workspace table and everything stored in it. Other shared
-- data (members, journal, expenses) and all personal data are untouched.
delete from public.shared_content_tables where name = 'shared_trip_items';
drop table if exists public.shared_trip_items;
drop function if exists public.shared_trip_item_guard();
