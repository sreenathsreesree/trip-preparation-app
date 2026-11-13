-- Trip Prep: shared trips, members, invitations and shared journal entries (Phase L).
--
-- PENDING APPROVAL — NOT DEPLOYED. This file lives in supabase/pending/ so the
-- deploy workflow (which applies supabase/migrations/) cannot pick it up. Move it
-- into supabase/migrations/ only after explicit approval.
--
-- Separate from the G1 owner-partitioned tables: personal data stays there (or on
-- the device); only what a member deliberately shares in a shared trip is here.
--
-- Privacy rules enforced here, not in the app:
--   * Only members of a shared trip can read anything about it.
--   * Roles: owner (one per trip) > editor (write shared content) > viewer (read only).
--   * Membership, roles and invitations change only through the functions below,
--     which check the caller (auth.uid()); there are no direct write policies on them.
--   * Invitation tokens are never stored: only their SHA-256 hash.
--   * Shared content is stamped with the author from auth.uid(); only the author
--     (while still an owner/editor) can change it; nobody can hard-delete (tombstones).

create sequence public.shared_revision_seq;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.shared_trips (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  start_date date not null,
  end_date date not null,
  created_by uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date >= start_date)
);

create table public.shared_trip_members (
  trip_id uuid not null references public.shared_trips (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('owner', 'editor', 'viewer')),
  display_name text not null default '' check (char_length(display_name) <= 80),
  joined_at timestamptz not null default now(),
  primary key (trip_id, user_id)
);
create unique index shared_trip_members_one_owner on public.shared_trip_members (trip_id) where role = 'owner';
create index shared_trip_members_user on public.shared_trip_members (user_id);

create table public.shared_trip_invites (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.shared_trips (id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  role text not null check (role in ('editor', 'viewer')),
  created_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  max_uses integer not null default 10 check (max_uses between 1 and 50),
  uses integer not null default 0 check (uses >= 0),
  revoked_at timestamptz
);
create index shared_trip_invites_trip on public.shared_trip_invites (trip_id);

-- Shared journal entries: text only. Photos stay in each author's own Google Drive.
create table public.shared_journal_entries (
  trip_id uuid not null references public.shared_trips (id) on delete cascade,
  id text not null check (char_length(id) between 1 and 64),
  author_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  author_name text not null default '' check (char_length(author_name) <= 80),
  entry_date date not null,
  title text not null default '' check (char_length(title) <= 120),
  body text not null default '' check (char_length(body) <= 20000),
  mood text check (mood is null or mood in ('great', 'good', 'okay', 'tired', 'bad')),
  place_name text not null default '' check (char_length(place_name) <= 120),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  deleted_at timestamptz,
  revision bigint not null default 0,
  txid xid8 not null default pg_current_xact_id(),
  primary key (trip_id, id)
);
create index shared_journal_entries_pull on public.shared_journal_entries (trip_id, txid, revision);

-- Shared content tables pulled by shared_pull (Phase M adds expense tables).
create table public.shared_content_tables (
  name text primary key
);
insert into public.shared_content_tables (name) values ('shared_journal_entries');

-- ---------------------------------------------------------------------------
-- Membership helpers (SECURITY DEFINER: read membership without RLS recursion)
-- ---------------------------------------------------------------------------
create or replace function public.shared_trip_role(p_trip uuid) returns text
language sql stable security definer
set search_path = public
as $$
  select role from shared_trip_members where trip_id = p_trip and user_id = auth.uid();
$$;

create or replace function public.shared_trip_can_write(p_trip uuid) returns boolean
language sql stable security definer
set search_path = public
as $$
  select coalesce(shared_trip_role(p_trip) in ('owner', 'editor'), false);
$$;

-- Stamps shared content: author from the session, revision and txid for pulls,
-- refuses author changes and stale writes (a device sending an older version).
create or replace function public.shared_stamp_row() returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.author_id := auth.uid();
  else
    if new.author_id is distinct from old.author_id or new.trip_id is distinct from old.trip_id then
      raise exception 'author and trip cannot change' using errcode = '42501';
    end if;
    if new.updated_at < old.updated_at then
      raise exception 'stale write: the shared copy is newer' using errcode = '40001';
    end if;
  end if;
  if new.author_id is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  new.revision := nextval('public.shared_revision_seq');
  new.txid := pg_current_xact_id();
  return new;
end;
$$;

create trigger shared_journal_entries_stamp before insert or update on public.shared_journal_entries
  for each row execute function public.shared_stamp_row();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.shared_trips enable row level security;
alter table public.shared_trips force row level security;
alter table public.shared_trip_members enable row level security;
alter table public.shared_trip_members force row level security;
alter table public.shared_trip_invites enable row level security;
alter table public.shared_trip_invites force row level security;
alter table public.shared_journal_entries enable row level security;
alter table public.shared_journal_entries force row level security;
alter table public.shared_content_tables enable row level security;

create policy shared_trips_select on public.shared_trips for select to authenticated
  using (shared_trip_role(id) is not null);
create policy shared_trips_update on public.shared_trips for update to authenticated
  using (shared_trip_role(id) = 'owner') with check (shared_trip_role(id) = 'owner');

create policy shared_trip_members_select on public.shared_trip_members for select to authenticated
  using (shared_trip_role(trip_id) is not null);

-- Only the owner sees invitations (never the token, which is not stored).
create policy shared_trip_invites_select on public.shared_trip_invites for select to authenticated
  using (shared_trip_role(trip_id) = 'owner');

create policy shared_journal_select on public.shared_journal_entries for select to authenticated
  using (shared_trip_role(trip_id) is not null);
create policy shared_journal_insert on public.shared_journal_entries for insert to authenticated
  with check (shared_trip_can_write(trip_id) and author_id = auth.uid());
create policy shared_journal_update on public.shared_journal_entries for update to authenticated
  using (author_id = auth.uid() and shared_trip_can_write(trip_id))
  with check (author_id = auth.uid() and shared_trip_can_write(trip_id));

create policy shared_content_tables_select on public.shared_content_tables for select to authenticated using (true);

revoke all on public.shared_trips, public.shared_trip_members, public.shared_trip_invites,
  public.shared_journal_entries, public.shared_content_tables from anon, public;
grant select, update (name, start_date, end_date, updated_at) on public.shared_trips to authenticated;
grant select on public.shared_trip_members, public.shared_trip_invites, public.shared_content_tables to authenticated;
grant select, insert, update on public.shared_journal_entries to authenticated;
revoke all on sequence public.shared_revision_seq from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Functions: the only way to change trips' membership
-- ---------------------------------------------------------------------------
create or replace function public.shared_require_user() returns uuid
language plpgsql stable
set search_path = public
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  return v_uid;
end;
$$;

create or replace function public.shared_require_owner(p_trip uuid) returns uuid
language plpgsql stable security definer
set search_path = public
as $$
declare v_uid uuid := shared_require_user();
begin
  if shared_trip_role(p_trip) is distinct from 'owner' then
    raise exception 'Only the trip owner can do that' using errcode = '42501';
  end if;
  return v_uid;
end;
$$;

-- Creates a shared trip with the caller as its owner.
create or replace function public.create_shared_trip(p_name text, p_start date, p_end date, p_display_name text default '')
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_uid uuid := shared_require_user();
  v_trip uuid;
begin
  insert into shared_trips (name, start_date, end_date, created_by) values (btrim(p_name), p_start, p_end, v_uid)
    returning id into v_trip;
  insert into shared_trip_members (trip_id, user_id, role, display_name)
    values (v_trip, v_uid, 'owner', left(coalesce(btrim(p_display_name), ''), 80));
  return v_trip;
end;
$$;

-- Owner creates an invitation. The client generates a random token and sends only its SHA-256 hash.
create or replace function public.create_shared_trip_invite(p_trip uuid, p_token_hash text, p_role text,
  p_valid_hours integer default 168, p_max_uses integer default 10)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_uid uuid := shared_require_owner(p_trip);
  v_id uuid;
begin
  if p_role not in ('editor', 'viewer') then
    raise exception 'Invitations are for editors or viewers' using errcode = '22023';
  end if;
  if p_valid_hours not between 1 and 720 then
    raise exception 'An invitation can last from 1 hour to 30 days' using errcode = '22023';
  end if;
  insert into shared_trip_invites (trip_id, token_hash, role, created_by, expires_at, max_uses)
    values (p_trip, lower(p_token_hash), p_role, v_uid, now() + make_interval(hours => p_valid_hours), p_max_uses)
    returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.revoke_shared_trip_invite(p_invite uuid) returns void
language plpgsql security definer
set search_path = public
as $$
declare v_trip uuid;
begin
  select trip_id into v_trip from shared_trip_invites where id = p_invite;
  if v_trip is null then
    raise exception 'Invitation not found' using errcode = 'P0002';
  end if;
  perform shared_require_owner(v_trip);
  update shared_trip_invites set revoked_at = coalesce(revoked_at, now()) where id = p_invite;
end;
$$;

-- Joins a trip with an invitation token. Existing members keep their role.
create or replace function public.accept_shared_trip_invite(p_token text, p_display_name text default '')
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v_uid uuid := shared_require_user();
  v_invite shared_trip_invites%rowtype;
  v_role text;
  v_trip shared_trips%rowtype;
begin
  select * into v_invite from shared_trip_invites
    where token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex')
    for update;
  if v_invite.id is null then
    raise exception 'This invitation link is not valid' using errcode = 'P0002';
  end if;
  select role into v_role from shared_trip_members where trip_id = v_invite.trip_id and user_id = v_uid;
  if v_role is null then
    if v_invite.revoked_at is not null then
      raise exception 'This invitation was cancelled' using errcode = '42501';
    end if;
    if v_invite.expires_at <= now() then
      raise exception 'This invitation has expired' using errcode = '42501';
    end if;
    if v_invite.uses >= v_invite.max_uses then
      raise exception 'This invitation has been used up' using errcode = '42501';
    end if;
    insert into shared_trip_members (trip_id, user_id, role, display_name)
      values (v_invite.trip_id, v_uid, v_invite.role, left(coalesce(btrim(p_display_name), ''), 80));
    update shared_trip_invites set uses = uses + 1 where id = v_invite.id;
    v_role := v_invite.role;
  end if;
  select * into v_trip from shared_trips where id = v_invite.trip_id;
  return jsonb_build_object('trip_id', v_trip.id, 'name', v_trip.name, 'start_date', v_trip.start_date,
    'end_date', v_trip.end_date, 'role', v_role);
end;
$$;

create or replace function public.set_shared_trip_member_role(p_trip uuid, p_user uuid, p_role text) returns void
language plpgsql security definer
set search_path = public
as $$
declare v_uid uuid := shared_require_owner(p_trip);
begin
  if p_role not in ('editor', 'viewer') then
    raise exception 'Choose editor or viewer (use transfer to change the owner)' using errcode = '22023';
  end if;
  if p_user = v_uid then
    raise exception 'Transfer ownership before changing your own role' using errcode = '42501';
  end if;
  update shared_trip_members set role = p_role where trip_id = p_trip and user_id = p_user;
  if not found then
    raise exception 'Not a member of this trip' using errcode = 'P0002';
  end if;
end;
$$;

create or replace function public.remove_shared_trip_member(p_trip uuid, p_user uuid) returns void
language plpgsql security definer
set search_path = public
as $$
declare v_uid uuid := shared_require_owner(p_trip);
begin
  if p_user = v_uid then
    raise exception 'The owner cannot be removed; transfer ownership or delete the trip' using errcode = '42501';
  end if;
  delete from shared_trip_members where trip_id = p_trip and user_id = p_user;
  if not found then
    raise exception 'Not a member of this trip' using errcode = 'P0002';
  end if;
end;
$$;

create or replace function public.leave_shared_trip(p_trip uuid) returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_uid uuid := shared_require_user();
  v_role text := shared_trip_role(p_trip);
begin
  if v_role is null then
    raise exception 'Not a member of this trip' using errcode = 'P0002';
  end if;
  if v_role = 'owner' then
    raise exception 'Transfer ownership or delete the trip before leaving' using errcode = '42501';
  end if;
  delete from shared_trip_members where trip_id = p_trip and user_id = v_uid;
end;
$$;

create or replace function public.transfer_shared_trip(p_trip uuid, p_new_owner uuid) returns void
language plpgsql security definer
set search_path = public
as $$
declare v_uid uuid := shared_require_owner(p_trip);
begin
  if p_new_owner = v_uid then
    return;
  end if;
  if not exists (select 1 from shared_trip_members where trip_id = p_trip and user_id = p_new_owner) then
    raise exception 'The new owner must already be a member' using errcode = 'P0002';
  end if;
  update shared_trip_members set role = 'editor' where trip_id = p_trip and user_id = v_uid;
  update shared_trip_members set role = 'owner' where trip_id = p_trip and user_id = p_new_owner;
end;
$$;

create or replace function public.delete_shared_trip(p_trip uuid) returns void
language plpgsql security definer
set search_path = public
as $$
begin
  perform shared_require_owner(p_trip);
  delete from shared_trips where id = p_trip;
end;
$$;

-- ---------------------------------------------------------------------------
-- Pull: shared content of one trip, in commit order (same cursor rules as G1:
-- rows of transactions still in progress are never returned).
-- ---------------------------------------------------------------------------
create or replace function public.shared_pull(p_trip uuid, p_after_txid text default '0', p_after_revision bigint default 0,
  p_limit integer default 500) returns jsonb
language plpgsql security invoker stable
set search_path = public
as $$
declare
  v_xmin xid8 := pg_snapshot_xmin(pg_current_snapshot());
  v_after xid8 := coalesce(nullif(p_after_txid, ''), '0')::xid8;
  v_limit integer := least(greatest(coalesce(p_limit, 500), 1), 1000);
  v_union text;
  v_rows jsonb;
  v_count integer;
  v_last jsonb;
begin
  perform shared_require_user();
  if shared_trip_role(p_trip) is null then
    raise exception 'Not a member of this trip' using errcode = '42501';
  end if;
  select string_agg(format(
    'select %L as tbl, t.id::text as pk, t.revision, t.txid, t.deleted_at is not null as deleted,
            to_jsonb(t) - array[''revision'', ''txid''] as data
     from public.%I t where t.trip_id = $1 and t.txid < $2 and (t.txid, t.revision) > ($3, $4)', name, name), ' union all ')
  into v_union from shared_content_tables;
  execute format(
    'select coalesce(jsonb_agg(jsonb_build_object(''table'', tbl, ''pk'', pk, ''revision'', revision, ''txid'', txid::text,
       ''deleted'', deleted, ''data'', data) order by txid, revision), ''[]''::jsonb), count(*)::int
     from (select * from (%s) u order by txid, revision limit $5) page', v_union)
    into v_rows, v_count using p_trip, v_xmin, v_after, coalesce(p_after_revision, 0), v_limit + 1;
  if v_count > v_limit then
    v_rows := v_rows - v_limit;
  end if;
  v_last := v_rows -> (jsonb_array_length(v_rows) - 1);
  return jsonb_build_object('rows', v_rows, 'has_more', v_count > v_limit,
    'cursor', case when v_last is null
      then jsonb_build_object('txid', v_after::text, 'revision', coalesce(p_after_revision, 0))
      else jsonb_build_object('txid', v_last ->> 'txid', 'revision', (v_last ->> 'revision')::bigint) end);
end;
$$;

revoke all on function public.shared_trip_role(uuid), public.shared_trip_can_write(uuid), public.shared_stamp_row(),
  public.shared_require_user(), public.shared_require_owner(uuid),
  public.create_shared_trip(text, date, date, text), public.create_shared_trip_invite(uuid, text, text, integer, integer),
  public.revoke_shared_trip_invite(uuid), public.accept_shared_trip_invite(text, text),
  public.set_shared_trip_member_role(uuid, uuid, text), public.remove_shared_trip_member(uuid, uuid),
  public.leave_shared_trip(uuid), public.transfer_shared_trip(uuid, uuid), public.delete_shared_trip(uuid),
  public.shared_pull(uuid, text, bigint, integer)
  from public, anon;
grant execute on function public.shared_trip_role(uuid), public.shared_trip_can_write(uuid),
  public.shared_require_user(), public.shared_require_owner(uuid),
  public.create_shared_trip(text, date, date, text), public.create_shared_trip_invite(uuid, text, text, integer, integer),
  public.revoke_shared_trip_invite(uuid), public.accept_shared_trip_invite(text, text),
  public.set_shared_trip_member_role(uuid, uuid, text), public.remove_shared_trip_member(uuid, uuid),
  public.leave_shared_trip(uuid), public.transfer_shared_trip(uuid, uuid), public.delete_shared_trip(uuid),
  public.shared_pull(uuid, text, bigint, integer)
  to authenticated;
