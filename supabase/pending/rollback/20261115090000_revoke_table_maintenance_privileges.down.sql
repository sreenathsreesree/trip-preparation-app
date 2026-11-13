-- Rollback for 20261115090000_revoke_table_maintenance_privileges.sql (not a migration).
-- Restores the privileges exactly as Supabase's defaults had granted them:
-- authenticated (not anon, not PUBLIC) on every public table, plus the
-- postgres default privileges for anon and authenticated. Data is unaffected.
do $$
declare
  extra text := case when current_setting('server_version_num')::int >= 170000 then ', maintain' else '' end;
  t record;
begin
  for t in select c.relname from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' loop
    execute format('grant truncate, references, trigger%s on table public.%I to authenticated', extra, t.relname);
  end loop;
  execute format('alter default privileges for role postgres in schema public grant truncate, references, trigger%s on tables to anon, authenticated', extra);
end
$$;
