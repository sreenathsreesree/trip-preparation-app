// Tests for supabase/pending/20261116090000_shared_workspace.sql on real
// Postgres (PGlite): who can read and write the group workspace, readiness
// privacy, invitations, removal, and that nothing deployed changes.
import { createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { before, describe, it } from 'node:test';

const ROOT = join(import.meta.dirname, '..');
const [OWNER, EDITOR, VIEWER, STRANGER] = ['1', '2', '3', '4'].map((n) => `${n.repeat(8)}-${n.repeat(4)}-4${n.repeat(3)}-8${n.repeat(3)}-${n.repeat(12)}`);
const T = '2026-11-13T10:00:00Z';
const LATER = '2026-11-13T11:00:00Z';
const STUB = `
  create role anon nologin; create role authenticated nologin; create schema auth;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated; grant usage on schema public to anon, authenticated;
  insert into auth.users (id) values ('${OWNER}'), ('${EDITOR}'), ('${VIEWER}'), ('${STRANGER}');
`;
const files = (dir) => readdirSync(join(ROOT, dir)).filter((f) => f.endsWith('.sql')).sort().map((f) => join(ROOT, dir, f));
async function database({ workspace = true } = {}) {
  const db = new PGlite();
  await db.exec(STUB);
  for (const f of [...files('migrations'), ...files('pending')].filter((f) => workspace || !f.includes('shared_workspace'))) await db.exec(readFileSync(f, 'utf8'));
  return db;
}
async function as(db, user, fn) {
  await db.exec('reset role');
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [user ?? '']);
  await db.exec(`set role ${user ? 'authenticated' : 'anon'}`);
  try {
    return await fn();
  } finally {
    await db.exec('reset role');
  }
}
const q = (db, user, sql, params = []) => as(db, user, () => db.query(sql, params));
const hash = (t) => createHash('sha256').update(t).digest('hex');
const put = (db, user, trip, id, kind, data, at = T) =>
  q(db, user, `insert into public.shared_trip_items (trip_id, id, kind, data, created_at, updated_at) values ($1, $2, $3, $4, $5, $5)`, [trip, id, kind, JSON.stringify(data), at]);
const denied = /permission denied|row-level security|violates/;

async function sharedTrip(db) {
  const trip = (await q(db, OWNER, `select public.create_shared_trip('Kerala', '2026-11-20', '2026-11-24', 'Asha') as id`)).rows[0].id;
  await q(db, OWNER, `select public.create_shared_trip_invite($1, $2, 'editor')`, [trip, hash('e')]);
  await q(db, OWNER, `select public.create_shared_trip_invite($1, $2, 'viewer')`, [trip, hash('v')]);
  await q(db, EDITOR, `select public.accept_shared_trip_invite('e', 'Ben')`);
  await q(db, VIEWER, `select public.accept_shared_trip_invite('v', 'Vee')`);
  return trip;
}

describe('group workspace: roles', () => {
  let db;
  let trip;
  before(async () => {
    db = await database();
    trip = await sharedTrip(db);
  });

  it('owner and editor add itinerary places, checklist items, documents, bookings and notes', async () => {
    await put(db, OWNER, trip, 'p1', 'place', { name: 'Munnar', position: 0 });
    await put(db, EDITOR, trip, 'c1', 'checklist', { title: 'Hotel confirmation', done: false });
    await put(db, EDITOR, trip, 'd1', 'document', { title: 'Tea County Resort booking', type: 'hotel', reference: 'ABC123' });
    await put(db, OWNER, trip, 'd2', 'document', { title: 'Jeep safari', type: 'activity' });
    await put(db, EDITOR, trip, 'n1', 'note', { title: 'Meeting point', body: 'Airport gate 2' });
    assert.equal((await db.query('select count(*) n from public.shared_trip_items')).rows[0].n, 5);
    assert.equal((await db.query(`select created_by from public.shared_trip_items where id = 'c1'`)).rows[0].created_by, EDITOR);
  });

  it('every member, including the viewer, reads the whole workspace', async () => {
    for (const user of [OWNER, EDITOR, VIEWER]) assert.equal((await q(db, user, 'select count(*) n from public.shared_trip_items')).rows[0].n, 5);
    const pulled = (await q(db, VIEWER, 'select public.shared_pull($1) as r', [trip])).rows[0].r;
    assert.equal(pulled.rows.filter((r) => r.table === 'shared_trip_items').length, 5);
  });

  it('the viewer cannot add, change or remove shared content', async () => {
    await assert.rejects(put(db, VIEWER, trip, 'x1', 'note', { title: 'x' }), denied);
    assert.equal((await q(db, VIEWER, `update public.shared_trip_items set data = '{"title":"hacked"}', updated_at = $1, base_updated_at = updated_at where id = 'n1'`, [LATER])).affectedRows, 0);
    await assert.rejects(q(db, VIEWER, `delete from public.shared_trip_items where id = 'n1'`), denied);
  });

  it('non-members and signed-out callers see and write nothing, also through direct table access', async () => {
    assert.equal((await q(db, STRANGER, 'select count(*) n from public.shared_trip_items')).rows[0].n, 0);
    await assert.rejects(put(db, STRANGER, trip, 'x2', 'note', { title: 'x' }), denied);
    await assert.rejects(q(db, STRANGER, 'select public.shared_pull($1)', [trip]), /Not a member/);
    await assert.rejects(q(db, null, 'select count(*) from public.shared_trip_items'), /permission denied/);
  });

  it('nobody hard-deletes; removal is a tombstone that members pull', async () => {
    await assert.rejects(q(db, OWNER, `delete from public.shared_trip_items where id = 'd2'`), /permission denied/);
    await q(db, EDITOR, `update public.shared_trip_items set deleted_at = $1, updated_at = $1, base_updated_at = updated_at where id = 'd2'`, [LATER]);
    const pulled = (await q(db, VIEWER, 'select public.shared_pull($1) as r', [trip])).rows[0].r;
    assert.equal(pulled.rows.find((r) => r.pk === 'd2').deleted, true);
  });

  it('an older write never replaces a newer one; creator and kind cannot change', async () => {
    await q(db, EDITOR, `update public.shared_trip_items set data = '{"title":"Meeting point","body":"Gate 4"}', updated_at = $1, base_updated_at = updated_at where id = 'n1'`, [LATER]);
    await assert.rejects(q(db, OWNER, `update public.shared_trip_items set data = '{"title":"old"}', updated_at = $1, base_updated_at = updated_at where id = 'n1'`, [T]), /stale write/);
    await assert.rejects(q(db, OWNER, `update public.shared_trip_items set kind = 'place', updated_at = now(), base_updated_at = updated_at where id = 'n1'`), /kind cannot change/);
    await assert.rejects(q(db, OWNER, `update public.shared_trip_items set created_by = '${OWNER}', updated_at = now(), base_updated_at = updated_at where id = 'n1'`), /cannot change/);
    assert.equal((await db.query(`select data ->> 'body' b from public.shared_trip_items where id = 'n1'`)).rows[0].b, 'Gate 4');
  });

  it('an edit based on an outdated copy is refused even with a later clock (concurrent edits become conflicts)', async () => {
    const seen = (await db.query(`select updated_at from public.shared_trip_items where id = 'c1'`)).rows[0].updated_at;
    await q(db, EDITOR, `update public.shared_trip_items set data = '{"title":"Hotel confirmation","done":true}', updated_at = '2026-11-13T12:00:00Z', base_updated_at = $1 where id = 'c1'`, [seen]);
    // The owner edited the same copy offline, with a much later clock: refused, nothing overwritten.
    await assert.rejects(q(db, OWNER, `update public.shared_trip_items set data = '{"title":"Hotel","done":false}', updated_at = '2026-11-14T00:00:00Z', base_updated_at = $1 where id = 'c1'`, [seen]), /stale write/);
    assert.equal((await db.query(`select data ->> 'done' d from public.shared_trip_items where id = 'c1'`)).rows[0].d, 'true');
  });

  it('personal document types cannot be shared', async () => {
    for (const type of ['passport', 'id', 'insurance', 'medical']) await assert.rejects(put(db, OWNER, trip, `bad-${type}`, 'document', { title: 'x', type }), /shared_trip_items_document_type/);
  });
});

describe('group readiness without private details', () => {
  let db;
  let trip;
  before(async () => {
    db = await database();
    trip = await sharedTrip(db);
  });

  it('each member, also a viewer, sets only their own ready flag', async () => {
    await put(db, VIEWER, trip, VIEWER, 'readiness', { ready: true });
    await put(db, EDITOR, trip, EDITOR, 'readiness', { ready: false });
    await assert.rejects(put(db, EDITOR, trip, OWNER, 'readiness', { ready: true }), denied);
    assert.equal((await q(db, EDITOR, `update public.shared_trip_items set data = '{"ready":false}', updated_at = $1, base_updated_at = updated_at where id = $2`, [LATER, VIEWER])).affectedRows, 0);
    const ready = (await q(db, OWNER, `select count(*) filter (where data ->> 'ready' = 'true') r, count(*) n from public.shared_trip_items where kind = 'readiness'`)).rows[0];
    assert.deepEqual([Number(ready.r), Number(ready.n)], [1, 2]);
  });

  it('a readiness row can hold nothing but the flag (no packed items, no notes)', async () => {
    await assert.rejects(put(db, OWNER, trip, OWNER, 'readiness', { ready: true, packed: ['passport'] }), /shared_trip_items_readiness/);
    await assert.rejects(put(db, OWNER, trip, OWNER, 'readiness', { ready: 'yes' }), /shared_trip_items_readiness/);
  });

  it('a stranger cannot mark readiness on a trip they are not in', async () => {
    await assert.rejects(put(db, STRANGER, trip, STRANGER, 'readiness', { ready: true }), denied);
  });
});

describe('membership changes', () => {
  it('a removed member loses the workspace at once; a member of another trip never sees it', async () => {
    const db = await database();
    const trip = await sharedTrip(db);
    await put(db, OWNER, trip, 'n1', 'note', { title: 'Secret plan' });
    await q(db, OWNER, 'select public.remove_shared_trip_member($1, $2)', [trip, EDITOR]);
    assert.equal((await q(db, EDITOR, 'select count(*) n from public.shared_trip_items')).rows[0].n, 0);
    await assert.rejects(put(db, EDITOR, trip, 'n2', 'note', { title: 'x' }), denied);
    const other = (await q(db, STRANGER, `select public.create_shared_trip('Goa', '2027-01-01', '2027-01-03', 'Sam') as id`)).rows[0].id;
    await put(db, STRANGER, other, 'n1', 'note', { title: 'Goa only' });
    assert.deepEqual((await q(db, OWNER, `select data ->> 'title' t from public.shared_trip_items`)).rows, [{ t: 'Secret plan' }]);
  });

  it('expired and revoked invitations give no access to the workspace', async () => {
    const db = await database();
    const trip = (await q(db, OWNER, `select public.create_shared_trip('Kerala', '2026-11-20', '2026-11-24', 'Asha') as id`)).rows[0].id;
    await put(db, OWNER, trip, 'n1', 'note', { title: 'Members only' });
    const invite = (await q(db, OWNER, `select public.create_shared_trip_invite($1, $2, 'editor') as id`, [trip, hash('revoked')])).rows[0].id;
    await q(db, OWNER, 'select public.revoke_shared_trip_invite($1)', [invite]);
    await assert.rejects(q(db, EDITOR, `select public.accept_shared_trip_invite('revoked', 'Ben')`));
    await q(db, OWNER, `select public.create_shared_trip_invite($1, $2, 'viewer')`, [trip, hash('old')]);
    await db.query(`update public.shared_trip_invites set expires_at = now() - interval '1 hour' where token_hash = $1`, [hash('old')]);
    await assert.rejects(q(db, VIEWER, `select public.accept_shared_trip_invite('old', 'Vee')`));
    for (const user of [EDITOR, VIEWER]) assert.equal((await q(db, user, 'select count(*) n from public.shared_trip_items')).rows[0].n, 0);
  });

  it('a new owner after a transfer keeps the workspace; deleting the trip removes it', async () => {
    const db = await database();
    const trip = await sharedTrip(db);
    await put(db, OWNER, trip, 'n1', 'note', { title: 'x' });
    await q(db, OWNER, 'select public.transfer_shared_trip($1, $2)', [trip, EDITOR]);
    await put(db, EDITOR, trip, 'n2', 'note', { title: 'y' });
    await q(db, EDITOR, 'select public.delete_shared_trip($1)', [trip]);
    assert.equal((await db.query('select count(*) n from public.shared_trip_items')).rows[0].n, 0);
  });
});

describe('the migration is additive and hardened', () => {
  it('changes no existing table, policy, function, grant or default privilege', async () => {
    const catalog = async (db) =>
      (
        await db.query(`select
          (select md5(string_agg(tablename||policyname||cmd||coalesce(qual,'')||coalesce(with_check,''),'|' order by tablename, policyname)) from pg_policies where schemaname='public' and tablename <> 'shared_trip_items') pol,
          (select md5(string_agg(table_name||column_name||data_type,'|' order by table_name, ordinal_position)) from information_schema.columns where table_schema='public' and table_name <> 'shared_trip_items') col,
          (select md5(string_agg(p.oid::regprocedure::text||md5(prosrc)||coalesce(proacl::text,''),'|' order by 1)) from pg_proc p where pronamespace='public'::regnamespace and proname <> 'shared_trip_item_guard') fn,
          (select md5(string_agg(c.relname||r||p,'|' order by 1)) from pg_class c, unnest(array['anon','authenticated']) r, unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) p
             where c.relnamespace='public'::regnamespace and c.relkind='r' and c.relname <> 'shared_trip_items' and has_table_privilege(r,c.oid,p)) grants`)
      ).rows[0];
    assert.deepEqual(await catalog(await database()), await catalog(await database({ workspace: false })));
  });

  it('the new table has forced RLS, no delete policy, and only select/insert/update for signed-in users', async () => {
    const db = await database();
    const t = (await db.query(`select relrowsecurity r, relforcerowsecurity f from pg_class where relname = 'shared_trip_items'`)).rows[0];
    assert.deepEqual([t.r, t.f], [true, true]);
    assert.deepEqual((await db.query(`select cmd from pg_policies where tablename = 'shared_trip_items' order by cmd`)).rows.map((r) => r.cmd), ['INSERT', 'SELECT', 'UPDATE']);
    const privs = (await db.query(`select r||':'||p k from unnest(array['anon','authenticated']) r, unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) p where has_table_privilege(r, 'public.shared_trip_items', p) order by 1`)).rows.map((r) => r.k);
    assert.deepEqual(privs, ['authenticated:INSERT', 'authenticated:SELECT', 'authenticated:UPDATE']);
  });

  it('is in pending/, not the deploy folder', () => {
    assert.ok(!readdirSync(join(ROOT, 'migrations')).some((f) => f.includes('shared_workspace')));
  });
});
