-- Trip Prep: shared expenses, settlements and budget for shared trips (Phase M).
--
-- PENDING APPROVAL — NOT DEPLOYED. Requires 20261113090000_shared_trips.sql.
-- Lives in supabase/pending/ so the deploy workflow cannot apply it.
--
-- Only GROUP records of a SHARED trip are stored here. Personal expenses never
-- leave the device, so no table here has a personal scope.
--
-- Rules enforced by the database (same membership model as Phase L):
--   * members read; owners and editors write; viewers and everyone else cannot;
--   * no hard deletes (tombstones), no changing a record's trip or creator;
--   * amounts are positive integers in minor units with an ISO currency code —
--     no conversion, no exchange rates;
--   * a split must name participants of the same trip once each, with
--     non-negative shares that add up exactly to the amount.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.shared_expense_participants (
  trip_id uuid not null references public.shared_trips (id) on delete cascade,
  id text not null check (char_length(id) between 1 and 64),
  name text not null check (char_length(btrim(name)) between 1 and 60),
  user_id uuid references auth.users (id) on delete set null,
  archived boolean not null default false,
  created_by uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  deleted_at timestamptz,
  revision bigint not null default 0,
  txid xid8 not null default pg_current_xact_id(),
  primary key (trip_id, id)
);

create table public.shared_expenses (
  trip_id uuid not null references public.shared_trips (id) on delete cascade,
  id text not null check (char_length(id) between 1 and 64),
  title text not null check (char_length(btrim(title)) between 1 and 120),
  amount_minor bigint not null check (amount_minor > 0 and amount_minor <= 100000000000),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  category text not null check (char_length(category) between 1 and 80),
  category_name text not null default '' check (char_length(category_name) <= 40),
  spent_on date not null,
  paid_by text not null,
  split_method text not null check (split_method in ('equal', 'exact', 'percent', 'shares')),
  splits jsonb not null,
  notes text not null default '' check (char_length(notes) <= 1000),
  created_by uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  deleted_at timestamptz,
  revision bigint not null default 0,
  txid xid8 not null default pg_current_xact_id(),
  primary key (trip_id, id),
  foreign key (trip_id, paid_by) references public.shared_expense_participants (trip_id, id)
);

create table public.shared_expense_settlements (
  trip_id uuid not null references public.shared_trips (id) on delete cascade,
  id text not null check (char_length(id) between 1 and 64),
  from_id text not null,
  to_id text not null,
  amount_minor bigint not null check (amount_minor > 0 and amount_minor <= 100000000000),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  settled_on date not null,
  note text not null default '' check (char_length(note) <= 200),
  created_by uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  deleted_at timestamptz,
  revision bigint not null default 0,
  txid xid8 not null default pg_current_xact_id(),
  primary key (trip_id, id),
  check (from_id <> to_id),
  foreign key (trip_id, from_id) references public.shared_expense_participants (trip_id, id),
  foreign key (trip_id, to_id) references public.shared_expense_participants (trip_id, id)
);

-- One budget per trip and currency; `id` is the currency code.
create table public.shared_expense_budgets (
  trip_id uuid not null references public.shared_trips (id) on delete cascade,
  id text not null check (id ~ '^[A-Z]{3}$'),
  total_minor bigint check (total_minor is null or total_minor between 0 and 100000000000),
  daily_limit_minor bigint check (daily_limit_minor is null or daily_limit_minor between 0 and 100000000000),
  lines jsonb not null default '[]'::jsonb check (jsonb_typeof(lines) = 'array' and jsonb_array_length(lines) <= 50),
  created_by uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  deleted_at timestamptz,
  revision bigint not null default 0,
  txid xid8 not null default pg_current_xact_id(),
  primary key (trip_id, id)
);

create index shared_expense_participants_pull on public.shared_expense_participants (trip_id, txid, revision);
create index shared_expenses_pull on public.shared_expenses (trip_id, txid, revision);
create index shared_expense_settlements_pull on public.shared_expense_settlements (trip_id, txid, revision);
create index shared_expense_budgets_pull on public.shared_expense_budgets (trip_id, txid, revision);

insert into public.shared_content_tables (name) values
  ('shared_expense_participants'), ('shared_expenses'), ('shared_expense_settlements'), ('shared_expense_budgets');

-- ---------------------------------------------------------------------------
-- Validation and stamping
-- ---------------------------------------------------------------------------

-- A split: [{participant_id, share_minor, input_value}], each participant once,
-- shares >= 0, adding up exactly to the amount.
create or replace function public.shared_split_is_valid(p_splits jsonb, p_amount bigint) returns boolean
language sql immutable
set search_path = public
as $$
  select jsonb_typeof(p_splits) = 'array'
    and jsonb_array_length(p_splits) between 1 and 100
    and not exists (
      select 1 from jsonb_array_elements(p_splits) e
      where jsonb_typeof(e) <> 'object'
         or jsonb_typeof(e -> 'participant_id') <> 'string'
         or jsonb_typeof(e -> 'share_minor') <> 'number'
         or (e ->> 'share_minor')::numeric < 0
         or (e ->> 'share_minor')::numeric <> trunc((e ->> 'share_minor')::numeric))
    and (select count(distinct e ->> 'participant_id') from jsonb_array_elements(p_splits) e) = jsonb_array_length(p_splits)
    and (select sum((e ->> 'share_minor')::numeric) from jsonb_array_elements(p_splits) e) = p_amount;
$$;

alter table public.shared_expenses add constraint shared_expenses_split_valid check (shared_split_is_valid(splits, amount_minor));

-- Every participant in a split belongs to the same trip.
create or replace function public.shared_expense_check_split() returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from jsonb_array_elements(new.splits) e
    where not exists (select 1 from shared_expense_participants p where p.trip_id = new.trip_id and p.id = e ->> 'participant_id')
  ) then
    raise exception 'Everyone in the split must be a participant of this trip' using errcode = '23503';
  end if;
  return new;
end;
$$;

-- Creator from the session, immutable creator and trip, stale-write guard, pull bookkeeping.
create or replace function public.shared_stamp_record() returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
  else
    if new.created_by is distinct from old.created_by or new.trip_id is distinct from old.trip_id or new.id is distinct from old.id then
      raise exception 'trip, id and creator cannot change' using errcode = '42501';
    end if;
    if new.updated_at < old.updated_at then
      raise exception 'stale write: the shared copy is newer' using errcode = '40001';
    end if;
  end if;
  if new.created_by is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  new.revision := nextval('public.shared_revision_seq');
  new.txid := pg_current_xact_id();
  return new;
end;
$$;

create trigger shared_expense_participants_stamp before insert or update on public.shared_expense_participants
  for each row execute function public.shared_stamp_record();
create trigger shared_expenses_stamp before insert or update on public.shared_expenses
  for each row execute function public.shared_stamp_record();
create trigger shared_expenses_split_members before insert or update on public.shared_expenses
  for each row execute function public.shared_expense_check_split();
create trigger shared_expense_settlements_stamp before insert or update on public.shared_expense_settlements
  for each row execute function public.shared_stamp_record();
create trigger shared_expense_budgets_stamp before insert or update on public.shared_expense_budgets
  for each row execute function public.shared_stamp_record();

-- ---------------------------------------------------------------------------
-- Row Level Security: members read, owners and editors write, nobody deletes
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['shared_expense_participants', 'shared_expenses', 'shared_expense_settlements', 'shared_expense_budgets'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('create policy %I on public.%I for select to authenticated using (shared_trip_role(trip_id) is not null)', t || '_select', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (shared_trip_can_write(trip_id) and created_by = auth.uid())', t || '_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (shared_trip_can_write(trip_id)) with check (shared_trip_can_write(trip_id))', t || '_update', t);
    execute format('revoke all on public.%I from anon, public', t);
    execute format('grant select, insert, update on public.%I to authenticated', t);
  end loop;
end;
$$;

revoke all on function public.shared_split_is_valid(jsonb, bigint), public.shared_expense_check_split(), public.shared_stamp_record()
  from public, anon, authenticated;
grant execute on function public.shared_split_is_valid(jsonb, bigint) to authenticated;
