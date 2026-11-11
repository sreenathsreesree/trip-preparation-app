-- Trip Prep cloud schema (G1).
--
-- A separate Supabase project for Trip Prep. SQLite on the device stays the
-- source for the UI; these tables mirror the user-owned local tables so a
-- signed-in user's data can be backed up, restored and synchronised.
--
-- Conventions (every synced table):
--   user_id      owner; forced to auth.uid() on insert and immutable (never trusted from the client)
--   <pk>         the local primary key (text UUIDs; `key` / `trip_id` where the local table uses them)
--   PRIMARY KEY (user_id, <pk>) so two accounts can never collide, even on deterministic ids
--   revision     server-assigned, strictly increasing; the row version used for conflict detection
--   txid         id of the transaction that last wrote the row; the pull cursor (see sync_pull)
--   deleted_at   tombstone; rows are never hard-deleted by clients
--   server_updated_at  when the server last accepted a write
-- Domain columns mirror SQLite names and types (dates and timestamps stay ISO text) so sync is lossless.
-- Local-only / derived columns are not stored (see docs/cloud-sync.md).

create sequence public.sync_revision_seq as bigint;

-- ---------------------------------------------------------------------------
-- Bookkeeping trigger: ownership, revision, txid
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER so clients need no rights on the revision sequence; auth.uid()
-- still reads the caller's JWT from the session settings.
create or replace function public.sync_stamp_row() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    -- Never trust a client-supplied owner.
    if auth.uid() is not null then
      new.user_id := auth.uid();
    end if;
  elsif new.user_id is distinct from old.user_id then
    raise exception 'user_id cannot change' using errcode = '42501';
  end if;
  if new.user_id is null then
    raise exception 'user_id is required' using errcode = '42501';
  end if;
  new.revision := nextval('public.sync_revision_seq');
  new.txid := pg_current_xact_id();
  new.server_updated_at := now();
  return new;
end;
$$;

-- Adds the common columns, trigger, indexes and RLS to a table.
create or replace function public.sync_prepare_table(p_table text) returns void
language plpgsql
set search_path = public
as $$
begin
  execute format('alter table public.%I enable row level security', p_table);
  execute format('alter table public.%I force row level security', p_table);
  execute format(
    'create trigger %I before insert or update on public.%I for each row execute function public.sync_stamp_row()',
    p_table || '_sync_stamp', p_table);
  execute format('create index %I on public.%I (user_id, txid, revision)', p_table || '_pull_idx', p_table);
  -- Owners only. No DELETE policy: clients write tombstones (deleted_at) instead.
  execute format('create policy %I on public.%I for select to authenticated using (user_id = auth.uid())',
    p_table || '_select_own', p_table);
  execute format('create policy %I on public.%I for insert to authenticated with check (user_id = auth.uid())',
    p_table || '_insert_own', p_table);
  execute format(
    'create policy %I on public.%I for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())',
    p_table || '_update_own', p_table);
  execute format('revoke all on public.%I from anon', p_table);
  execute format('grant select, insert, update on public.%I to authenticated', p_table);
end;
$$;

-- Shorthand for the common columns in each CREATE TABLE below.
--   user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
--   revision bigint not null default 0, txid xid8 not null default pg_current_xact_id(),
--   deleted_at timestamptz, server_updated_at timestamptz not null default now()

-- ---------------------------------------------------------------------------
-- Rank 1: roots
-- ---------------------------------------------------------------------------
create table public.trips (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null,
  name text not null check (char_length(name) <= 200),
  start_date text not null,
  end_date text not null,
  adults integer not null default 1,
  children integer not null default 0,
  transport_mode text not null,
  category text not null,
  created_at text not null,
  updated_at text not null,
  completed_at text,
  archived_at text,
  revision bigint not null default 0,
  txid xid8 not null default pg_current_xact_id(),
  deleted_at timestamptz,
  server_updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table public.checklist_templates (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null,
  name text not null check (char_length(name) <= 200),
  description text not null default '' check (char_length(description) <= 2000),
  created_at text not null,
  updated_at text not null,
  revision bigint not null default 0,
  txid xid8 not null default pg_current_xact_id(),
  deleted_at timestamptz,
  server_updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table public.inventory_categories (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null,
  parent_id text, -- same-table reference: kept consistent by the client (no FK, see docs)
  name text not null check (char_length(name) <= 200),
  icon text not null,
  color text not null,
  position integer not null default 0,
  cover_image_uri text check (cover_image_uri is null or (cover_image_uri not like 'file:%' and cover_image_uri not like 'data:%')),
  system_key text,
  created_at text not null,
  updated_at text not null,
  revision bigint not null default 0,
  txid xid8 not null default pg_current_xact_id(),
  deleted_at timestamptz,
  server_updated_at timestamptz not null default now(),
  primary key (user_id, id)
);
create unique index inventory_categories_system_key on public.inventory_categories (user_id, system_key)
  where system_key is not null and deleted_at is null;

create table public.places (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null,
  provider text not null check (provider in ('google', 'manual')),
  provider_place_id text,
  name text not null default '' check (char_length(name) <= 300),
  latitude double precision check (latitude is null or latitude between -90 and 90),
  longitude double precision check (longitude is null or longitude between -180 and 180),
  formatted_address text not null default '',
  types text not null default '[]',
  district text,
  state text,
  country text,
  metadata text not null default '{}' check (char_length(metadata) <= 20000),
  created_at text not null,
  updated_at text not null,
  revision bigint not null default 0,
  txid xid8 not null default pg_current_xact_id(),
  deleted_at timestamptz,
  server_updated_at timestamptz not null default now(),
  primary key (user_id, id),
  -- Google Places content is not stored in our cloud: only the Place ID (allowed indefinitely).
  constraint places_provider_content check (
    provider = 'manual' or (
      provider_place_id is not null and name = '' and latitude is null and longitude is null
      and formatted_address = '' and types = '[]' and district is null and state is null
      and country is null and metadata = '{}'
    )
  )
);
create unique index places_provider_id on public.places (user_id, provider, provider_place_id)
  where provider_place_id is not null and deleted_at is null;

create table public.user_preferences (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  key text not null check (char_length(key) <= 100),
  value text not null check (char_length(value) <= 2000),
  updated_at text not null,
  revision bigint not null default 0,
  txid xid8 not null default pg_current_xact_id(),
  deleted_at timestamptz,
  server_updated_at timestamptz not null default now(),
  primary key (user_id, key)
);

-- ---------------------------------------------------------------------------
-- Rank 2
-- ---------------------------------------------------------------------------
create table public.trip_travellers (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null,
  trip_id text not null,
  name text not null check (char_length(name) <= 200),
  kind text not null default 'adult',
  position integer not null default 0,
  created_at text not null,
  updated_at text not null,
  revision bigint not null default 0,
  txid xid8 not null default pg_current_xact_id(),
  deleted_at timestamptz,
  server_updated_at timestamptz not null default now(),
  primary key (user_id, id),
  foreign key (user_id, trip_id) references public.trips (user_id, id)
);

create table public.checklist_sections (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null,
  trip_id text,
  template_id text,
  title text not null check (char_length(title) <= 200),
  kind text not null,
  position integer not null default 0,
  created_at text not null,
  updated_at text not null,
  revision bigint not null default 0,
  txid xid8 not null default pg_current_xact_id(),
  deleted_at timestamptz,
  server_updated_at timestamptz not null default now(),
  primary key (user_id, id),
  check ((trip_id is null) <> (template_id is null)),
  foreign key (user_id, trip_id) references public.trips (user_id, id),
  foreign key (user_id, template_id) references public.checklist_templates (user_id, id)
);

create table public.inventory_items (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null,
  name text not null check (char_length(name) <= 200),
  description text not null default '' check (char_length(description) <= 2000),
  brand text not null default '',
  model text not null default '',
  quantity integer not null default 1 check (quantity >= 0),
  weight_grams integer check (weight_grams is null or weight_grams >= 0),
  condition text not null default 'good',
  storage_location text not null default '',
  category_id text,
  subcategory_id text,
  availability text not null default 'available',
  -- Device photo files are not synced (only portable built-in illustration ids).
  image_uri text check (image_uri is null or (image_uri not like 'file:%' and image_uri not like 'data:%')),
  image_source text,
  archived_at text,
  created_at text not null,
  updated_at text not null,
  revision bigint not null default 0,
  txid xid8 not null default pg_current_xact_id(),
  deleted_at timestamptz,
  server_updated_at timestamptz not null default now(),
  primary key (user_id, id),
  foreign key (user_id, category_id) references public.inventory_categories (user_id, id),
  foreign key (user_id, subcategory_id) references public.inventory_categories (user_id, id)
);

create table public.trip_packing (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  trip_id text not null,
  activities text not null default '[]',
  accommodation text not null default 'hotel',
  laundry integer not null default 0 check (laundry in (0, 1)),
  confirmed_at text,
  draft_reason text,
  suggestions_generated_at text,
  created_at text not null,
  updated_at text not null,
  revision bigint not null default 0,
  txid xid8 not null default pg_current_xact_id(),
  deleted_at timestamptz,
  server_updated_at timestamptz not null default now(),
  primary key (user_id, trip_id),
  foreign key (user_id, trip_id) references public.trips (user_id, id)
);

create table public.trip_plan_nodes (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null,
  trip_id text not null,
  parent_id text, -- same-table reference: cycles/orphans from concurrent edits are repaired on the device
  place_id text,
  name text not null check (char_length(name) <= 200),
  notes text not null default '' check (char_length(notes) <= 4000),
  position integer not null default 0,
  created_at text not null,
  updated_at text not null,
  revision bigint not null default 0,
  txid xid8 not null default pg_current_xact_id(),
  deleted_at timestamptz,
  server_updated_at timestamptz not null default now(),
  primary key (user_id, id),
  foreign key (user_id, trip_id) references public.trips (user_id, id),
  foreign key (user_id, place_id) references public.places (user_id, id)
);

-- ---------------------------------------------------------------------------
-- Rank 3
-- ---------------------------------------------------------------------------
create table public.checklist_tasks (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null,
  section_id text not null,
  title text not null check (char_length(title) <= 300),
  description text not null default '' check (char_length(description) <= 4000),
  notes text not null default '' check (char_length(notes) <= 4000),
  priority text not null default 'recommended',
  is_done integer not null default 0 check (is_done in (0, 1)),
  position integer not null default 0,
  source_template_id text,
  source_task_id text,
  created_at text not null,
  updated_at text not null,
  revision bigint not null default 0,
  txid xid8 not null default pg_current_xact_id(),
  deleted_at timestamptz,
  server_updated_at timestamptz not null default now(),
  primary key (user_id, id),
  foreign key (user_id, section_id) references public.checklist_sections (user_id, id)
);

create table public.trip_luggage (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null,
  trip_id text not null,
  name text not null check (char_length(name) <= 100),
  kind text not null,
  traveller_id text,
  position integer not null default 0,
  created_at text not null,
  updated_at text not null,
  revision bigint not null default 0,
  txid xid8 not null default pg_current_xact_id(),
  deleted_at timestamptz,
  server_updated_at timestamptz not null default now(),
  primary key (user_id, id),
  foreign key (user_id, trip_id) references public.trips (user_id, id),
  foreign key (user_id, traveller_id) references public.trip_travellers (user_id, id)
);

create table public.trip_route_stops (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null,
  trip_id text not null,
  node_id text not null,
  position integer not null default 0,
  created_at text not null,
  revision bigint not null default 0,
  txid xid8 not null default pg_current_xact_id(),
  deleted_at timestamptz,
  server_updated_at timestamptz not null default now(),
  primary key (user_id, id),
  foreign key (user_id, trip_id) references public.trips (user_id, id),
  foreign key (user_id, node_id) references public.trip_plan_nodes (user_id, id)
);

-- ---------------------------------------------------------------------------
-- Rank 4
-- ---------------------------------------------------------------------------
create table public.packing_entries (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null,
  trip_id text not null,
  inventory_item_id text,
  name text not null check (char_length(name) <= 200),
  category_id text,
  quantity integer not null default 1 check (quantity >= 1),
  traveller_id text,
  luggage_id text,
  is_packed integer not null default 0 check (is_packed in (0, 1)),
  notes text not null default '' check (char_length(notes) <= 2000),
  source text not null default 'manual',
  recommendation_id text, -- no FK (matches SQLite); recommendations sync after entries
  position integer not null default 0,
  created_at text not null,
  updated_at text not null,
  revision bigint not null default 0,
  txid xid8 not null default pg_current_xact_id(),
  deleted_at timestamptz,
  server_updated_at timestamptz not null default now(),
  primary key (user_id, id),
  foreign key (user_id, trip_id) references public.trips (user_id, id),
  foreign key (user_id, inventory_item_id) references public.inventory_items (user_id, id),
  foreign key (user_id, category_id) references public.inventory_categories (user_id, id),
  foreign key (user_id, traveller_id) references public.trip_travellers (user_id, id),
  foreign key (user_id, luggage_id) references public.trip_luggage (user_id, id)
);

-- ---------------------------------------------------------------------------
-- Rank 5
-- ---------------------------------------------------------------------------
create table public.packing_recommendations (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null,
  trip_id text not null,
  rule_key text not null,
  name text not null,
  category_key text not null,
  quantity integer not null default 1,
  priority text not null,
  reason text not null default '',
  traveller_id text,
  inventory_item_id text,
  status text not null default 'pending',
  packing_entry_id text,
  created_at text not null,
  updated_at text not null,
  decided_at text,
  revision bigint not null default 0,
  txid xid8 not null default pg_current_xact_id(),
  deleted_at timestamptz,
  server_updated_at timestamptz not null default now(),
  primary key (user_id, id),
  foreign key (user_id, trip_id) references public.trips (user_id, id),
  foreign key (user_id, traveller_id) references public.trip_travellers (user_id, id),
  foreign key (user_id, inventory_item_id) references public.inventory_items (user_id, id),
  foreign key (user_id, packing_entry_id) references public.packing_entries (user_id, id)
);
create unique index packing_recommendations_rule on public.packing_recommendations (user_id, trip_id, rule_key)
  where deleted_at is null;

create table public.inventory_reservations (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null,
  inventory_item_id text not null,
  trip_id text,
  packing_entry_id text,
  quantity integer not null check (quantity >= 1),
  start_date text not null,
  end_date text not null,
  status text not null default 'active',
  created_at text not null,
  updated_at text not null,
  ended_at text,
  revision bigint not null default 0,
  txid xid8 not null default pg_current_xact_id(),
  deleted_at timestamptz,
  server_updated_at timestamptz not null default now(),
  primary key (user_id, id),
  foreign key (user_id, inventory_item_id) references public.inventory_items (user_id, id),
  foreign key (user_id, trip_id) references public.trips (user_id, id),
  foreign key (user_id, packing_entry_id) references public.packing_entries (user_id, id)
);

-- ---------------------------------------------------------------------------
-- Rank 6
-- ---------------------------------------------------------------------------
create table public.purchase_items (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null,
  trip_id text,
  trip_name text not null default '',
  name text not null check (char_length(name) <= 200),
  normalized_name text not null,
  quantity integer not null default 1 check (quantity >= 1),
  category_id text,
  status text not null default 'needed',
  recommendation_id text,
  inventory_item_id text,
  packing_entry_id text,
  notes text not null default '' check (char_length(notes) <= 2000),
  created_at text not null,
  updated_at text not null,
  purchased_at text,
  resolved_at text,
  revision bigint not null default 0,
  txid xid8 not null default pg_current_xact_id(),
  deleted_at timestamptz,
  server_updated_at timestamptz not null default now(),
  primary key (user_id, id),
  foreign key (user_id, trip_id) references public.trips (user_id, id),
  foreign key (user_id, category_id) references public.inventory_categories (user_id, id),
  foreign key (user_id, inventory_item_id) references public.inventory_items (user_id, id),
  foreign key (user_id, packing_entry_id) references public.packing_entries (user_id, id)
);

-- ---------------------------------------------------------------------------
-- Registry of synced tables (read by the sync functions; readable by clients)
-- ---------------------------------------------------------------------------
create table public.sync_tables (
  name text primary key,
  pk_column text not null,
  rank integer not null
);
insert into public.sync_tables (name, pk_column, rank) values
  ('trips', 'id', 1),
  ('checklist_templates', 'id', 1),
  ('inventory_categories', 'id', 1),
  ('places', 'id', 1),
  ('user_preferences', 'key', 1),
  ('trip_travellers', 'id', 2),
  ('checklist_sections', 'id', 2),
  ('inventory_items', 'id', 2),
  ('trip_packing', 'trip_id', 2),
  ('trip_plan_nodes', 'id', 2),
  ('checklist_tasks', 'id', 3),
  ('trip_luggage', 'id', 3),
  ('trip_route_stops', 'id', 3),
  ('packing_entries', 'id', 4),
  ('packing_recommendations', 'id', 5),
  ('inventory_reservations', 'id', 5),
  ('purchase_items', 'id', 6);
alter table public.sync_tables enable row level security;
create policy sync_tables_read on public.sync_tables for select to authenticated using (true);
revoke all on public.sync_tables from anon;
grant select on public.sync_tables to authenticated;

select public.sync_prepare_table(name) from public.sync_tables;

revoke all on sequence public.sync_revision_seq from public, anon, authenticated;
revoke all on function public.sync_stamp_row() from public, anon, authenticated;
