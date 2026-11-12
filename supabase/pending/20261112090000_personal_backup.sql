-- Trip Prep G3: personal cloud backup for the data added after G1 (local schema v5–v10).
--
-- PENDING APPROVAL — NOT DEPLOYED. Lives in supabase/pending/ so the deploy workflow
-- cannot apply it. Independent of the shared-trip migrations (it needs only G1).
--
-- Additive only: no G1 table, column, policy or function is changed. New tables follow
-- the G1 conventions exactly and are registered in public.sync_tables, so G1's own
-- sync_push / sync_pull (base revisions, tombstones, commit-order cursor) and
-- sync_prepare_table (owner-only RLS, stamping trigger, pull index) serve them unchanged.
--
-- Every row belongs to its owner (user_id = auth.uid(), never trusted from the client);
-- every foreign key includes user_id, so a row can only reference the same user's rows.
-- Photos are never stored here: only Google Drive file ids (the user's own Drive).

-- ---------------------------------------------------------------------------
-- v5 additions to G1 tables, kept in side tables (G1 tables stay unchanged)
-- ---------------------------------------------------------------------------
create table public.inventory_category_details (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  category_id text not null,
  description text not null default '' check (char_length(description) <= 500),
  revision bigint not null default 0,
  txid xid8 not null default pg_current_xact_id(),
  deleted_at timestamptz,
  server_updated_at timestamptz not null default now(),
  primary key (user_id, category_id),
  foreign key (user_id, category_id) references public.inventory_categories (user_id, id)
);

create table public.packing_entry_units (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  entry_id text not null,
  unit text not null check (char_length(unit) between 1 and 20),
  revision bigint not null default 0,
  txid xid8 not null default pg_current_xact_id(),
  deleted_at timestamptz,
  server_updated_at timestamptz not null default now(),
  primary key (user_id, entry_id),
  foreign key (user_id, entry_id) references public.packing_entries (user_id, id)
);

-- ---------------------------------------------------------------------------
-- Destination companion (v6)
-- ---------------------------------------------------------------------------
create table public.trip_navigation_items (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null,
  trip_id text not null,
  node_id text not null,
  parent_id text, -- same-table reference: kept consistent by the client (as in G1)
  position integer not null default 0,
  created_at text not null,
  updated_at text not null,
  revision bigint not null default 0,
  txid xid8 not null default pg_current_xact_id(),
  deleted_at timestamptz,
  server_updated_at timestamptz not null default now(),
  primary key (user_id, id),
  foreign key (user_id, trip_id) references public.trips (user_id, id),
  foreign key (user_id, node_id) references public.trip_plan_nodes (user_id, id)
);

create table public.plan_node_profiles (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  node_id text not null,
  trip_id text not null,
  visit_status text not null default 'upcoming' check (visit_status in ('upcoming', 'visited')),
  visited_at text,
  saved integer not null default 0 check (saved in (0, 1)),
  cover_image_uri text check (cover_image_uri is null or cover_image_uri ~ '^drive:[A-Za-z0-9_-]{10,200}$'),
  tags text not null default '[]',
  about text not null default '',
  best_season text not null default '',
  entry_fee text not null default '',
  travel_info text not null default '',
  visit_minutes integer check (visit_minutes is null or visit_minutes between 0 and 10080),
  best_time text not null default '',
  created_at text not null,
  updated_at text not null,
  revision bigint not null default 0,
  txid xid8 not null default pg_current_xact_id(),
  deleted_at timestamptz,
  server_updated_at timestamptz not null default now(),
  primary key (user_id, node_id),
  foreign key (user_id, trip_id) references public.trips (user_id, id),
  foreign key (user_id, node_id) references public.trip_plan_nodes (user_id, id)
);

create table public.plan_node_tasks (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null,
  trip_id text not null,
  node_id text not null,
  category text not null,
  title text not null,
  notes text not null default '',
  is_done integer not null default 0 check (is_done in (0, 1)),
  position integer not null default 0,
  completed_at text,
  created_at text not null,
  updated_at text not null,
  revision bigint not null default 0,
  txid xid8 not null default pg_current_xact_id(),
  deleted_at timestamptz,
  server_updated_at timestamptz not null default now(),
  primary key (user_id, id),
  foreign key (user_id, trip_id) references public.trips (user_id, id),
  foreign key (user_id, node_id) references public.trip_plan_nodes (user_id, id)
);

create table public.plan_node_notes (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null,
  trip_id text not null,
  node_id text not null,
  kind text not null,
  body text not null,
  position integer not null default 0,
  created_at text not null,
  updated_at text not null,
  revision bigint not null default 0,
  txid xid8 not null default pg_current_xact_id(),
  deleted_at timestamptz,
  server_updated_at timestamptz not null default now(),
  primary key (user_id, id),
  foreign key (user_id, trip_id) references public.trips (user_id, id),
  foreign key (user_id, node_id) references public.trip_plan_nodes (user_id, id)
);

create table public.plan_node_alerts (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null,
  trip_id text not null,
  node_id text not null,
  kind text not null,
  title text not null,
  body text not null default '',
  source text not null,
  source_url text,
  confirmed integer not null default 0 check (confirmed in (0, 1)),
  status text not null default 'saved',
  observed_at text,
  created_at text not null,
  updated_at text not null,
  revision bigint not null default 0,
  txid xid8 not null default pg_current_xact_id(),
  deleted_at timestamptz,
  server_updated_at timestamptz not null default now(),
  primary key (user_id, id),
  foreign key (user_id, trip_id) references public.trips (user_id, id),
  foreign key (user_id, node_id) references public.trip_plan_nodes (user_id, id)
);

-- Memory photos are a JSON array of Drive references ("drive:<file id>"), never device paths.
create table public.plan_node_memories (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  node_id text not null,
  trip_id text not null,
  visited_on text,
  rating integer check (rating is null or rating between 1 and 5),
  notes text not null default '',
  moments text not null default '',
  -- Only a JSON array of Drive references, e.g. ["drive:1AbC…","drive:2DeF…"] (allow-list, not a block-list).
  photos text not null default '[]' check (photos ~ '^\[("drive:[A-Za-z0-9_-]{10,200}"(,"drive:[A-Za-z0-9_-]{10,200}")*)?\]$'),
  created_at text not null,
  updated_at text not null,
  revision bigint not null default 0,
  txid xid8 not null default pg_current_xact_id(),
  deleted_at timestamptz,
  server_updated_at timestamptz not null default now(),
  primary key (user_id, node_id),
  foreign key (user_id, trip_id) references public.trips (user_id, id),
  foreign key (user_id, node_id) references public.trip_plan_nodes (user_id, id)
);

-- ---------------------------------------------------------------------------
-- Journey Journal (v7): text in the cloud, photos in the user's Drive
-- ---------------------------------------------------------------------------
create table public.journal_entries (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null,
  trip_id text not null,
  node_id text, -- plan node, cleared when the node is removed (no FK: removal is a tombstone)
  entry_date text not null,
  title text not null default '',
  body text not null default '',
  mood text,
  visibility text not null default 'private' check (visibility in ('private', 'shared')),
  created_at text not null,
  updated_at text not null,
  revision bigint not null default 0,
  txid xid8 not null default pg_current_xact_id(),
  deleted_at timestamptz,
  server_updated_at timestamptz not null default now(),
  primary key (user_id, id),
  foreign key (user_id, trip_id) references public.trips (user_id, id)
);

create table public.journal_photos (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null,
  entry_id text not null,
  drive_file_id text not null check (drive_file_id ~ '^[A-Za-z0-9_-]{10,200}$'),
  caption text not null default '',
  position integer not null default 0,
  created_at text not null,
  revision bigint not null default 0,
  txid xid8 not null default pg_current_xact_id(),
  deleted_at timestamptz,
  server_updated_at timestamptz not null default now(),
  primary key (user_id, id),
  foreign key (user_id, entry_id) references public.journal_entries (user_id, id)
);

-- ---------------------------------------------------------------------------
-- Trip Calculator (v10): the user's own ledger (amounts in integer minor units)
-- ---------------------------------------------------------------------------
create table public.expense_participants (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null,
  trip_id text not null,
  name text not null,
  member_user_id text, -- the participant's account in a shared trip (local column user_id)
  is_me integer not null default 0 check (is_me in (0, 1)),
  position integer not null default 0,
  archived_at text,
  created_at text not null,
  updated_at text not null,
  revision bigint not null default 0,
  txid xid8 not null default pg_current_xact_id(),
  deleted_at timestamptz,
  server_updated_at timestamptz not null default now(),
  primary key (user_id, id),
  foreign key (user_id, trip_id) references public.trips (user_id, id)
);

create table public.expense_categories (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null,
  trip_id text not null,
  name text not null,
  created_at text not null,
  updated_at text not null,
  revision bigint not null default 0,
  txid xid8 not null default pg_current_xact_id(),
  deleted_at timestamptz,
  server_updated_at timestamptz not null default now(),
  primary key (user_id, id),
  foreign key (user_id, trip_id) references public.trips (user_id, id)
);

create table public.expense_settings (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  trip_id text not null,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  updated_at text not null,
  revision bigint not null default 0,
  txid xid8 not null default pg_current_xact_id(),
  deleted_at timestamptz,
  server_updated_at timestamptz not null default now(),
  primary key (user_id, trip_id),
  foreign key (user_id, trip_id) references public.trips (user_id, id)
);

-- One budget per trip and currency: id = '<trip_id>:<currency>'.
create table public.expense_budgets (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null,
  trip_id text not null,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  total_minor bigint check (total_minor is null or total_minor >= 0),
  daily_limit_minor bigint check (daily_limit_minor is null or daily_limit_minor >= 0),
  lines text not null default '[]',
  updated_at text not null,
  revision bigint not null default 0,
  txid xid8 not null default pg_current_xact_id(),
  deleted_at timestamptz,
  server_updated_at timestamptz not null default now(),
  primary key (user_id, id),
  check (id = trip_id || ':' || currency),
  foreign key (user_id, trip_id) references public.trips (user_id, id)
);

-- Splits travel with their expense (JSON) so an expense and its shares are always one change.
create table public.expenses (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null,
  trip_id text not null,
  scope text not null check (scope in ('personal', 'group')),
  title text not null,
  amount_minor bigint not null check (amount_minor > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  category text not null,
  category_name text not null default '',
  spent_on text not null,
  paid_by text,
  split_method text not null default 'equal',
  splits text not null default '[]',
  notes text not null default '',
  created_by text,
  created_at text not null,
  updated_at text not null,
  revision bigint not null default 0,
  txid xid8 not null default pg_current_xact_id(),
  deleted_at timestamptz,
  server_updated_at timestamptz not null default now(),
  primary key (user_id, id),
  check ((scope = 'personal' and paid_by is null) or (scope = 'group' and paid_by is not null)),
  foreign key (user_id, trip_id) references public.trips (user_id, id),
  foreign key (user_id, paid_by) references public.expense_participants (user_id, id)
);

create table public.expense_settlements (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null,
  trip_id text not null,
  from_id text not null,
  to_id text not null,
  amount_minor bigint not null check (amount_minor > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  settled_on text not null,
  note text not null default '',
  created_by text,
  created_at text not null,
  updated_at text not null,
  revision bigint not null default 0,
  txid xid8 not null default pg_current_xact_id(),
  deleted_at timestamptz,
  server_updated_at timestamptz not null default now(),
  primary key (user_id, id),
  check (from_id <> to_id),
  foreign key (user_id, trip_id) references public.trips (user_id, id),
  foreign key (user_id, from_id) references public.expense_participants (user_id, id),
  foreign key (user_id, to_id) references public.expense_participants (user_id, id)
);

-- ---------------------------------------------------------------------------
-- Register with the G1 sync protocol and apply the G1 table preparation
-- (RLS forced, owner-only select/insert/update, no delete, stamping trigger, pull index).
-- ---------------------------------------------------------------------------
insert into public.sync_tables (name, pk_column, rank) values
  ('expense_participants', 'id', 2),
  ('expense_categories', 'id', 2),
  ('expense_settings', 'trip_id', 2),
  ('expense_budgets', 'id', 2),
  ('inventory_category_details', 'category_id', 2),
  ('trip_navigation_items', 'id', 3),
  ('plan_node_profiles', 'node_id', 3),
  ('plan_node_tasks', 'id', 3),
  ('plan_node_notes', 'id', 3),
  ('plan_node_alerts', 'id', 3),
  ('plan_node_memories', 'node_id', 3),
  ('journal_entries', 'id', 3),
  ('expenses', 'id', 3),
  ('expense_settlements', 'id', 3),
  ('journal_photos', 'id', 4),
  ('packing_entry_units', 'entry_id', 5);

select public.sync_prepare_table(name) from public.sync_tables
where name in ('expense_participants', 'expense_categories', 'expense_settings', 'expense_budgets', 'inventory_category_details',
  'trip_navigation_items', 'plan_node_profiles', 'plan_node_tasks', 'plan_node_notes', 'plan_node_alerts', 'plan_node_memories',
  'journal_entries', 'expenses', 'expense_settlements', 'journal_photos', 'packing_entry_units');
