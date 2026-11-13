-- Group Trip workspace (not deployed): the shared itinerary, group checklist,
-- shared documents and bookings, group notes and member readiness.
--
-- One table, `shared_trip_items`, typed by `kind`:
--   place      a destination of the shared itinerary (name, parent, order, route position, day, coordinates, visited)
--   checklist  a group checklist item (title, category, assignee, done)
--   document   a shared document or booking (title, type, date, reference, link, expiry, place)
--   note       a group note (title, body, category)
--   readiness  one row per member (id = their user id): only { "ready": true|false }
--
-- Access (enforced here, not in the app):
--   members read everything of their trip; non-members and removed members nothing;
--   owners and editors write places, checklist items, documents and notes;
--   every member, including viewers, writes only their own readiness row;
--   nobody deletes (tombstones via deleted_at); creator, trip and id never change;
--   an older write never replaces a newer one (shared_stamp_record).
-- Private data (packing, personal checklist, private notes, documents, memories,
-- personal expenses) has no table here and cannot be sent.
--
-- Additive: creates one table, its trigger, index and policies, and registers it
-- for shared_pull. Nothing existing is changed.

create table public.shared_trip_items (
  trip_id uuid not null references public.shared_trips (id) on delete cascade,
  id text not null check (char_length(id) between 1 and 80),
  kind text not null check (kind in ('place', 'checklist', 'document', 'note', 'readiness')),
  data jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object' and pg_column_size(data) <= 16384),
  author_name text not null default '' check (char_length(author_name) <= 80),
  created_by uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  deleted_at timestamptz,
  revision bigint not null default 0,
  txid xid8 not null default pg_current_xact_id(),
  primary key (trip_id, id),
  -- Readiness says only whether the member is ready: no item details can be stored in it.
  constraint shared_trip_items_readiness check (
    kind <> 'readiness' or (id = created_by::text and data - 'ready' = '{}'::jsonb and jsonb_typeof(data -> 'ready') = 'boolean')
  ),
  -- Shared documents are common trip papers; personal IDs and medical papers are never a shared type.
  constraint shared_trip_items_document_type check (
    kind <> 'document' or data ->> 'type' in ('hotel', 'vehicle', 'transport_ticket', 'group_ticket', 'epass', 'activity', 'other')
  )
);

create index shared_trip_items_pull on public.shared_trip_items (trip_id, txid, revision);

-- The kind of an item never changes (a note cannot become a readiness row or the reverse).
create or replace function public.shared_trip_item_guard() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.kind is distinct from old.kind then
    raise exception 'kind cannot change' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger shared_trip_items_kind before update on public.shared_trip_items
  for each row execute function public.shared_trip_item_guard();
create trigger shared_trip_items_stamp before insert or update on public.shared_trip_items
  for each row execute function public.shared_stamp_record();

alter table public.shared_trip_items enable row level security;
alter table public.shared_trip_items force row level security;

create policy shared_trip_items_select on public.shared_trip_items for select to authenticated
  using (shared_trip_role(trip_id) is not null);

create policy shared_trip_items_insert on public.shared_trip_items for insert to authenticated
  with check (
    created_by = auth.uid() and (
      (kind <> 'readiness' and shared_trip_can_write(trip_id))
      or (kind = 'readiness' and shared_trip_role(trip_id) is not null and id = auth.uid()::text)
    )
  );

create policy shared_trip_items_update on public.shared_trip_items for update to authenticated
  using (
    (kind <> 'readiness' and shared_trip_can_write(trip_id))
    or (kind = 'readiness' and shared_trip_role(trip_id) is not null and created_by = auth.uid())
  )
  with check (
    (kind <> 'readiness' and shared_trip_can_write(trip_id))
    or (kind = 'readiness' and shared_trip_role(trip_id) is not null and created_by = auth.uid())
  );

revoke all on public.shared_trip_items from anon, authenticated, public;
grant select, insert, update on public.shared_trip_items to authenticated;
revoke all on function public.shared_trip_item_guard() from public, anon, authenticated;

insert into public.shared_content_tables (name) values ('shared_trip_items');
