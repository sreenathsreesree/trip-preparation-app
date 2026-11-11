-- Trip Prep sync protocol (G1). Both functions run as the caller (SECURITY
-- INVOKER), so Row Level Security applies to every statement; the owner is
-- always auth.uid(), never a client-supplied id. Table names come only from
-- public.sync_tables.

-- Columns a client may write for a table (everything except server bookkeeping).
create or replace function public.sync_writable_columns(p_table text) returns text[]
language sql stable
set search_path = public
as $$
  select array_agg(attname::text order by attnum)
  from pg_attribute
  where attrelid = ('public.' || p_table)::regclass
    and attnum > 0 and not attisdropped
    and attname not in ('user_id', 'revision', 'txid', 'deleted_at', 'server_updated_at');
$$;

-- ---------------------------------------------------------------------------
-- Push: apply a batch of local changes.
--
-- p_changes: [{ table, pk, op: 'upsert' | 'delete', base_revision: bigint | null, data: {...} }]
--   base_revision is the server revision the device last saw for the row (null = never synced).
-- Each change is applied independently (its own savepoint) and reported:
--   applied   - written (or already identical on the server: safe to retry after a lost response)
--   conflict  - the server row changed since base_revision (or vanished); server_row is returned
--   rejected  - invalid (unknown table, constraint/FK violation, ...); reason given
-- Clients send changes ordered by sync_tables.rank so parents precede children.
-- ---------------------------------------------------------------------------
create or replace function public.sync_push(p_changes jsonb) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_change jsonb;
  v_table text;
  v_pk_col text;
  v_pk text;
  v_op text;
  v_base bigint;
  v_data jsonb;
  v_row jsonb;
  v_cols text[];
  v_col_list text;
  v_excluded text;
  v_revision bigint;
  v_results jsonb := '[]'::jsonb;
  v_system constant text[] := array['user_id', 'revision', 'txid', 'deleted_at', 'server_updated_at'];
begin
  if v_uid is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  if jsonb_typeof(p_changes) <> 'array' then
    raise exception 'changes must be an array' using errcode = '22023';
  end if;
  if jsonb_array_length(p_changes) > 500 then
    raise exception 'Too many changes in one batch (max 500)' using errcode = '54000';
  end if;

  for v_change in select value from jsonb_array_elements(p_changes) loop
    v_table := v_change ->> 'table';
    v_pk := v_change ->> 'pk';
    v_op := v_change ->> 'op';
    v_base := nullif(v_change ->> 'base_revision', '')::bigint;
    v_data := coalesce(v_change -> 'data', '{}'::jsonb) - v_system;
    select pk_column into v_pk_col from sync_tables where name = v_table;

    if v_pk_col is null or v_pk is null or v_op not in ('upsert', 'delete') then
      v_results := v_results || jsonb_build_object('table', v_table, 'pk', v_pk, 'status', 'rejected',
        'reason', 'invalid_change');
      continue;
    end if;

    begin
      execute format('select to_jsonb(t) from public.%I t where user_id = $1 and %I = $2 for update', v_table, v_pk_col)
        into v_row using v_uid, v_pk;

      if v_row is not null and v_base is distinct from (v_row ->> 'revision')::bigint then
        -- Stale base. Still fine if the server already holds exactly this change (retry after a lost response).
        if (v_op = 'delete' and v_row ->> 'deleted_at' is not null)
           or (v_op = 'upsert' and v_row ->> 'deleted_at' is null and v_row @> (v_data || jsonb_build_object(v_pk_col, v_pk))) then
          v_results := v_results || jsonb_build_object('table', v_table, 'pk', v_pk, 'status', 'applied',
            'revision', (v_row ->> 'revision')::bigint, 'note', 'already_applied');
        else
          v_results := v_results || jsonb_build_object('table', v_table, 'pk', v_pk, 'status', 'conflict',
            'revision', (v_row ->> 'revision')::bigint, 'server_row', v_row - array['user_id', 'txid']);
        end if;
        continue;
      end if;

      if v_row is null and v_base is not null then
        v_results := v_results || jsonb_build_object('table', v_table, 'pk', v_pk, 'status', 'conflict',
          'reason', 'missing_on_server', 'server_row', null);
        continue;
      end if;

      if v_op = 'delete' then
        if v_row is null then
          v_revision := null; -- never reached the server: nothing to delete
        else
          execute format('update public.%I set deleted_at = now() where user_id = $1 and %I = $2 returning revision',
            v_table, v_pk_col) into v_revision using v_uid, v_pk;
        end if;
      else
        v_cols := sync_writable_columns(v_table);
        select string_agg(quote_ident(c), ', '), string_agg('excluded.' || quote_ident(c), ', ')
          into v_col_list, v_excluded from unnest(v_cols) as c;
        execute format(
          'insert into public.%1$I (%2$s) select %2$s from jsonb_populate_record(null::public.%1$I, $1)
           on conflict (user_id, %3$I) do update set (%2$s, deleted_at) = row(%4$s, null::timestamptz)
           returning revision',
          v_table, v_col_list, v_pk_col, v_excluded)
          into v_revision using v_data || jsonb_build_object(v_pk_col, v_pk);
      end if;

      v_results := v_results || jsonb_build_object('table', v_table, 'pk', v_pk, 'status', 'applied',
        'revision', v_revision);
    exception when others then
      v_results := v_results || jsonb_build_object('table', v_table, 'pk', v_pk, 'status', 'rejected',
        'reason', sqlstate, 'message', sqlerrm);
    end;
  end loop;

  return jsonb_build_object('results', v_results);
end;
$$;

-- ---------------------------------------------------------------------------
-- Pull: rows changed since a cursor, oldest first, in pages.
--
-- The cursor is (txid, revision) of the last row received. Only rows written by
-- transactions that are already complete (txid < xmin of the current snapshot)
-- are returned, so a slow transaction that commits later is never skipped: its
-- rows simply appear in a later pull. Tombstones are included (deleted = true).
-- ---------------------------------------------------------------------------
create or replace function public.sync_pull(p_after_txid text default '0', p_after_revision bigint default 0,
  p_limit integer default 500) returns jsonb
language plpgsql
security invoker
stable
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_xmin xid8 := pg_snapshot_xmin(pg_current_snapshot());
  v_after xid8 := coalesce(nullif(p_after_txid, ''), '0')::xid8;
  v_limit integer := least(greatest(coalesce(p_limit, 500), 1), 1000);
  v_union text;
  v_rows jsonb;
  v_count integer;
  v_last jsonb;
begin
  if v_uid is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;

  select string_agg(format(
    'select %L as tbl, %s as rank, t.%I::text as pk, t.revision, t.txid, t.deleted_at is not null as deleted,
            to_jsonb(t) - array[''user_id'', ''revision'', ''txid'', ''deleted_at'', ''server_updated_at''] as data
     from public.%I t
     where t.user_id = $1 and t.txid < $2 and (t.txid, t.revision) > ($3, $4)',
    name, rank, pk_column, name), ' union all ')
  into v_union from sync_tables;

  execute format(
    'select coalesce(jsonb_agg(jsonb_build_object(''table'', tbl, ''rank'', rank, ''pk'', pk, ''revision'', revision,
       ''txid'', txid::text, ''deleted'', deleted, ''data'', data) order by txid, revision), ''[]''::jsonb), count(*)::int
     from (select * from (%s) u order by txid, revision limit $5) page', v_union)
    into v_rows, v_count using v_uid, v_xmin, v_after, coalesce(p_after_revision, 0), v_limit + 1;

  if v_count > v_limit then
    v_rows := v_rows - v_limit; -- drop the look-ahead row
  end if;
  v_last := v_rows -> (jsonb_array_length(v_rows) - 1);

  return jsonb_build_object(
    'rows', v_rows,
    'has_more', v_count > v_limit,
    'cursor', case when v_last is null
      then jsonb_build_object('txid', v_after::text, 'revision', coalesce(p_after_revision, 0))
      else jsonb_build_object('txid', v_last ->> 'txid', 'revision', (v_last ->> 'revision')::bigint) end
  );
end;
$$;

revoke all on function public.sync_push(jsonb) from public, anon;
revoke all on function public.sync_pull(text, bigint, integer) from public, anon;
revoke all on function public.sync_writable_columns(text) from public, anon;
revoke all on function public.sync_prepare_table(text) from public, anon, authenticated;
grant execute on function public.sync_push(jsonb) to authenticated;
grant execute on function public.sync_pull(text, bigint, integer) to authenticated;
grant execute on function public.sync_writable_columns(text) to authenticated;
