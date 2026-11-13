-- Security hardening: remove table privileges the app never uses.
--
-- Supabase's default privileges give every table created by `postgres` in
-- schema public TRUNCATE, REFERENCES, TRIGGER and (Postgres 17) MAINTAIN for
-- anon and authenticated. TRUNCATE ignores Row Level Security, so a signed-in
-- caller able to run SQL could empty a table for every user. The app only
-- needs SELECT / INSERT / UPDATE (granted per table by earlier migrations) and
-- EXECUTE on its functions; those are not touched.
--
-- Additive and data-safe: only REVOKEs and default-privilege changes. No
-- table, column, row, policy, function or owner is changed. Reversal:
-- supabase/pending/rollback/20261115090000_revoke_table_maintenance_privileges.down.sql

do $$
declare
  extra text := case when current_setting('server_version_num')::int >= 170000 then ', maintain' else '' end;
  t record;
begin
  -- Existing tables, views and materialized views in public.
  for t in
    select c.relname from pg_class c
    where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm')
  loop
    execute format('revoke truncate, references, trigger%s on table public.%I from anon, authenticated, public', extra, t.relname);
  end loop;

  -- Future tables created by postgres (the role that runs the migrations).
  execute format('alter default privileges for role postgres in schema public revoke truncate, references, trigger%s on tables from anon, authenticated, public', extra);
end
$$;
