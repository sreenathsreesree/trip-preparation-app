// Tests for the Supabase migrations, Row Level Security and sync functions,
// run against real Postgres (PGlite, Postgres 17 compiled to WASM) with a
// minimal stand-in for Supabase's `auth` schema and roles.
//
//   npm run test:cloud

import { PGlite } from '@electric-sql/pglite';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { before, describe, it } from 'node:test';

import { PENDING_SYNC_TABLES, SYNC_TABLES as G1_TABLES } from '../../src/features/sync/tables.ts';

const MIGRATION_FILES = readdirSync(join(import.meta.dirname, '..', 'migrations'));
// After the G3 migration is moved into supabase/migrations (deployment), its tables are expected too.
const SYNC_TABLES = MIGRATION_FILES.some((f) => f.endsWith('_personal_backup.sql')) ? [...G1_TABLES, ...PENDING_SYNC_TABLES] : G1_TABLES;

const MIGRATIONS = join(import.meta.dirname, '..', 'migrations');
const ALICE = '11111111-1111-4111-8111-111111111111';
const BOB = '22222222-2222-4222-8222-222222222222';

/** Minimal Supabase environment: auth.users, auth.uid(), anon/authenticated roles. */
const SUPABASE_STUB = `
  create role anon nologin;
  create role authenticated nologin;
  create schema auth;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $$
    select coalesce(
      nullif(current_setting('request.jwt.claim.sub', true), ''),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    )::uuid
  $$;
  grant usage on schema auth to anon, authenticated;
  grant usage on schema public to anon, authenticated;
  insert into auth.users (id) values ('${ALICE}'), ('${BOB}');
`;

async function freshDatabase() {
  const db = new PGlite();
  await db.exec(SUPABASE_STUB);
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) {
    await db.exec(readFileSync(join(MIGRATIONS, file), 'utf8'));
  }
  return db;
}

/** Runs queries as a signed-in user (or anon when userId is null), like PostgREST does. */
async function as(db, userId, fn) {
  await db.exec('reset role');
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userId ?? '']);
  await db.exec(`set role ${userId ? 'authenticated' : 'anon'}`);
  try {
    return await fn();
  } finally {
    await db.exec('reset role');
  }
}

const push = (db, userId, changes) =>
  as(db, userId, async () => (await db.query('select public.sync_push($1::jsonb) as r', [JSON.stringify(changes)])).rows[0].r.results);
const pull = (db, userId, cursor = { txid: '0', revision: 0 }, limit = 500) =>
  as(db, userId, async () =>
    (await db.query('select public.sync_pull($1, $2, $3) as r', [cursor.txid, cursor.revision, limit])).rows[0].r,
  );

const NOW = '2026-11-11T09:00:00.000Z';
const trip = (id, name = 'Kerala') => ({
  id,
  name,
  start_date: '2026-12-20',
  end_date: '2026-12-24',
  adults: 2,
  children: 0,
  transport_mode: 'car',
  category: 'leisure',
  created_at: NOW,
  updated_at: NOW,
  completed_at: null,
  archived_at: null,
});
const upsert = (table, pk, data, base = null) => ({ table, pk, op: 'upsert', base_revision: base, data });

describe('migrations', () => {
  let db;
  before(async () => {
    db = await freshDatabase();
  });

  it('create every synced table with RLS enabled and forced, and the sync trigger', async () => {
    const { rows } = await db.query(`
      select c.relname, c.relrowsecurity, c.relforcerowsecurity,
        exists (select 1 from pg_trigger t where t.tgrelid = c.oid and t.tgname = c.relname || '_sync_stamp') as stamped,
        (select count(*) from pg_policies p where p.tablename = c.relname) as policies,
        exists (select 1 from pg_policies p where p.tablename = c.relname and p.cmd = 'DELETE') as delete_policy
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and c.relname <> 'sync_tables'
        -- Shared-trip tables are not personal backup tables; sharing.test.mjs / expenses.test.mjs check their RLS.
        and c.relname not like 'shared\\_%' and c.relname <> 'shared_content_tables'`);
    assert.deepEqual(rows.map((r) => r.relname).sort(), SYNC_TABLES.map((t) => t.name).sort());
    for (const row of rows) {
      assert.equal(row.relrowsecurity, true, `${row.relname} RLS`);
      assert.equal(row.relforcerowsecurity, true, `${row.relname} forced RLS`);
      assert.equal(row.stamped, true, `${row.relname} trigger`);
      assert.equal(Number(row.policies), 3, `${row.relname} select/insert/update policies`);
      assert.equal(row.delete_policy, false, `${row.relname} has no delete policy`);
    }
  });

  it('match the client registry: same tables, ranks, keys and columns', async () => {
    const registry = (await db.query('select name, pk_column, rank from public.sync_tables order by name')).rows;
    assert.deepEqual(
      registry,
      [...SYNC_TABLES].sort((a, b) => a.name.localeCompare(b.name)).map((t) => ({ name: t.name, pk_column: t.pk, rank: t.rank })),
    );
    for (const table of SYNC_TABLES) {
      const cols = (await db.query('select public.sync_writable_columns($1) as c', [table.name])).rows[0].c;
      assert.deepEqual([...cols].sort(), [...table.columns].sort(), `${table.name} columns`);
    }
  });
});

describe('ownership and Row Level Security', () => {
  let db;
  before(async () => {
    db = await freshDatabase();
    const results = await push(db, ALICE, [upsert('trips', 'trip-a', trip('trip-a'))]);
    assert.equal(results[0].status, 'applied');
  });

  it('other users cannot see, change or delete a user’s rows', async () => {
    assert.equal((await pull(db, BOB)).rows.length, 0);
    await as(db, BOB, async () => {
      assert.equal((await db.query('select * from public.trips')).rows.length, 0);
      assert.equal((await db.query(`update public.trips set name = 'hacked'`)).affectedRows, 0);
      // Clients cannot hard-delete at all (tombstones only).
      await assert.rejects(db.query('delete from public.trips'), /permission denied/);
    });
    const alice = await pull(db, ALICE);
    assert.equal(alice.rows[0].data.name, 'Kerala');
  });

  it('ignores client-supplied owners and blocks forged inserts', async () => {
    // A forged user_id inside the data is stripped; the row belongs to the caller.
    await push(db, BOB, [upsert('trips', 'trip-b', { ...trip('trip-b', 'Bob trip'), user_id: ALICE })]);
    assert.equal((await pull(db, ALICE)).rows.some((r) => r.pk === 'trip-b'), false);
    assert.equal((await pull(db, BOB)).rows.some((r) => r.pk === 'trip-b'), true);
    // Direct table access with another user's id is rejected by RLS / the trigger.
    await as(db, BOB, async () => {
      await db.query(`insert into public.trips (user_id, id, name, start_date, end_date, transport_mode, category, created_at, updated_at)
        values ('${ALICE}', 'forged', 'x', '2026-12-01', '2026-12-02', 'car', 'leisure', '${NOW}', '${NOW}')`);
      const owner = (await db.query(`select user_id from public.trips where id = 'forged'`)).rows[0].user_id;
      assert.equal(owner, BOB);
      await assert.rejects(db.query(`update public.trips set user_id = '${ALICE}' where id = 'forged'`), /user_id cannot change/);
    });
  });

  it('the same ids in two accounts never collide', async () => {
    await push(db, BOB, [upsert('trips', 'trip-a', trip('trip-a', 'Bob’s own trip-a'))]);
    assert.equal((await pull(db, ALICE)).rows.find((r) => r.pk === 'trip-a').data.name, 'Kerala');
    assert.equal((await pull(db, BOB)).rows.find((r) => r.pk === 'trip-a').data.name, 'Bob’s own trip-a');
  });

  it('cannot attach rows to another user’s parent rows', async () => {
    const [result] = await push(db, BOB, [
      upsert('trip_travellers', 'tr-x', { id: 'tr-x', trip_id: 'trip-only-alice', name: 'X', kind: 'adult', position: 0, created_at: NOW, updated_at: NOW }),
    ]);
    assert.equal(result.status, 'rejected');
    assert.equal(result.reason, '23503'); // foreign key: (bob, trip) does not exist
  });

  it('anonymous callers get nothing', async () => {
    await as(db, null, async () => {
      await assert.rejects(db.query('select * from public.trips'), /permission denied/);
      await assert.rejects(db.query(`select public.sync_pull('0', 0, 10)`), /permission denied/);
      await assert.rejects(db.query(`select public.sync_push('[]'::jsonb)`), /permission denied/);
    });
  });
});

describe('sync protocol', () => {
  let db;
  before(async () => {
    db = await freshDatabase();
  });

  it('pushes are idempotent: a retry after a lost response is applied once', async () => {
    const change = upsert('trips', 't1', trip('t1'));
    const [first] = await push(db, ALICE, [change]);
    const [retry] = await push(db, ALICE, [change]);
    assert.equal(first.status, 'applied');
    assert.deepEqual([retry.status, retry.note, retry.revision], ['applied', 'already_applied', first.revision]);
    assert.equal((await pull(db, ALICE)).rows.filter((r) => r.pk === 't1').length, 1);
  });

  it('detects conflicts instead of overwriting newer cloud changes', async () => {
    const [created] = await push(db, ALICE, [upsert('trips', 't2', trip('t2', 'Original'))]);
    // Device 2 edits from the same base.
    const [d2] = await push(db, ALICE, [upsert('trips', 't2', trip('t2', 'Edited on phone'), created.revision)]);
    assert.equal(d2.status, 'applied');
    // Device 1 edits from the now stale base.
    const [d1] = await push(db, ALICE, [upsert('trips', 't2', trip('t2', 'Edited on tablet'), created.revision)]);
    assert.equal(d1.status, 'conflict');
    assert.equal(d1.server_row.name, 'Edited on phone');
    assert.equal(d1.revision, d2.revision);
    // Resolving: push again with the server's revision as the base.
    const [resolved] = await push(db, ALICE, [upsert('trips', 't2', trip('t2', 'Edited on tablet'), d1.revision)]);
    assert.equal(resolved.status, 'applied');
  });

  it('a row the device believes exists but the server does not have is a conflict, not a silent insert', async () => {
    const [result] = await push(db, ALICE, [upsert('trips', 'ghost', trip('ghost'), 42)]);
    assert.deepEqual([result.status, result.reason], ['conflict', 'missing_on_server']);
  });

  it('deletes are tombstones, pulled like any change, and idempotent', async () => {
    const [created] = await push(db, ALICE, [upsert('trips', 't3', trip('t3'))]);
    const [deleted] = await push(db, ALICE, [{ table: 'trips', pk: 't3', op: 'delete', base_revision: created.revision }]);
    const [again] = await push(db, ALICE, [{ table: 'trips', pk: 't3', op: 'delete', base_revision: created.revision }]);
    assert.equal(deleted.status, 'applied');
    assert.equal(again.status, 'applied');
    const row = (await pull(db, ALICE)).rows.find((r) => r.pk === 't3');
    assert.equal(row.deleted, true);
    // Deleting something that never reached the server is a harmless no-op.
    const [never] = await push(db, ALICE, [{ table: 'trips', pk: 'never', op: 'delete', base_revision: null }]);
    assert.deepEqual([never.status, never.revision], ['applied', null]);
  });

  it('applies each change independently: one bad row does not block the batch', async () => {
    const results = await push(db, ALICE, [
      upsert('trips', 't4', trip('t4')),
      upsert('trip_travellers', 'orphan', { id: 'orphan', trip_id: 'nope', name: 'X', kind: 'adult', position: 0, created_at: NOW, updated_at: NOW }),
      upsert('trip_travellers', 'tr4', { id: 'tr4', trip_id: 't4', name: 'Asha', kind: 'adult', position: 0, created_at: NOW, updated_at: NOW }),
      upsert('not_a_table', 'x', {}),
      upsert('trips', 't5', { ...trip('t5'), name: null }),
    ]);
    assert.deepEqual(
      results.map((r) => [r.pk, r.status, r.reason ?? '']),
      [
        ['t4', 'applied', ''],
        ['orphan', 'rejected', '23503'],
        ['tr4', 'applied', ''],
        ['x', 'rejected', 'invalid_change'],
        ['t5', 'rejected', '23502'],
      ],
    );
  });

  it('never stores Google Places content, only the Place ID', async () => {
    const base = { provider: 'google', provider_place_id: 'ChIJ123', types: '[]', metadata: '{}', formatted_address: '', created_at: NOW, updated_at: NOW };
    const [withContent] = await push(db, ALICE, [
      upsert('places', 'p1', { id: 'p1', ...base, name: 'Munnar', latitude: 10.08, longitude: 77.06 }),
    ]);
    assert.deepEqual([withContent.status, withContent.reason], ['rejected', '23514']);
    const [idOnly] = await push(db, ALICE, [upsert('places', 'p1', { id: 'p1', ...base, name: '' })]);
    assert.equal(idOnly.status, 'applied');
    const [manual] = await push(db, ALICE, [
      upsert('places', 'p2', { id: 'p2', provider: 'manual', provider_place_id: null, name: 'Grandma’s house', latitude: 9.9, longitude: 76.3, types: '[]', metadata: '{}', formatted_address: '', created_at: NOW, updated_at: NOW }),
    ]);
    assert.equal(manual.status, 'applied');
  });

  it('refuses device-only photo paths', async () => {
    const item = { id: 'i1', name: 'Camera', description: '', brand: '', model: '', quantity: 1, weight_grams: null, condition: 'good', storage_location: '', category_id: null, subcategory_id: null, availability: 'available', image_source: 'photo', archived_at: null, created_at: NOW, updated_at: NOW };
    const [photo] = await push(db, ALICE, [upsert('inventory_items', 'i1', { ...item, image_uri: 'file:///data/user/0/x.jpg' })]);
    assert.deepEqual([photo.status, photo.reason], ['rejected', '23514']);
    const [illustration] = await push(db, ALICE, [upsert('inventory_items', 'i1', { ...item, image_uri: 'library:camera', image_source: 'library' })]);
    assert.equal(illustration.status, 'applied');
  });

  it('round-trips a full trip graph in rank order', async () => {
    const changes = [
      upsert('trips', 'g-trip', trip('g-trip')),
      upsert('places', 'g-place', { id: 'g-place', provider: 'manual', provider_place_id: null, name: 'Echo Point', latitude: null, longitude: null, formatted_address: '', types: '[]', district: null, state: null, country: null, metadata: '{}', created_at: NOW, updated_at: NOW }),
      upsert('trip_plan_nodes', 'n-root', { id: 'n-root', trip_id: 'g-trip', parent_id: null, place_id: null, name: 'Munnar', notes: '', position: 0, created_at: NOW, updated_at: NOW }),
      upsert('trip_plan_nodes', 'n-child', { id: 'n-child', trip_id: 'g-trip', parent_id: 'n-root', place_id: 'g-place', name: 'Echo Point', notes: 'Sunrise', position: 0, created_at: NOW, updated_at: NOW }),
      upsert('trip_route_stops', 's1', { id: 's1', trip_id: 'g-trip', node_id: 'n-child', position: 0, created_at: NOW }),
      upsert('trip_packing', 'g-trip', { trip_id: 'g-trip', activities: '["trekking"]', accommodation: 'hotel', laundry: 1, confirmed_at: null, draft_reason: null, suggestions_generated_at: null, created_at: NOW, updated_at: NOW }),
      upsert('user_preferences', 'packing_style', { key: 'packing_style', value: 'light', updated_at: NOW }),
    ];
    const results = await push(db, ALICE, changes);
    assert.ok(results.every((r) => r.status === 'applied'), JSON.stringify(results));
    const rows = (await pull(db, ALICE)).rows.filter((r) => changes.some((c) => c.pk === r.pk && c.table === r.table));
    assert.equal(rows.length, changes.length);
    for (const change of changes) {
      const row = rows.find((r) => r.table === change.table && r.pk === change.pk);
      assert.deepEqual(row.data, change.data, `${change.table} round trip`);
    }
  });
});

describe('pull cursor', () => {
  it('pages through every change exactly once, oldest first', async () => {
    const db = await freshDatabase();
    const ids = Array.from({ length: 1203 }, (_, i) => `t${String(i).padStart(4, '0')}`);
    for (let i = 0; i < ids.length; i += 400) {
      await push(db, ALICE, ids.slice(i, i + 400).map((id) => upsert('trips', id, trip(id))));
    }
    const seen = [];
    let cursor = { txid: '0', revision: 0 };
    let pages = 0;
    for (;;) {
      const page = await pull(db, ALICE, cursor, 500);
      seen.push(...page.rows.map((r) => r.pk));
      pages += 1;
      cursor = page.cursor;
      if (!page.has_more) break;
    }
    assert.equal(pages, 3);
    assert.deepEqual(seen, ids);
    // Later edits come after the cursor; nothing earlier repeats.
    await push(db, ALICE, [upsert('trips', 't0005', trip('t0005', 'Renamed'), (await pull(db, ALICE, { txid: '0', revision: 0 }, 1000)).rows.find((r) => r.pk === 't0005').revision)]);
    const next = await pull(db, ALICE, cursor);
    assert.deepEqual(next.rows.map((r) => [r.pk, r.data.name]), [['t0005', 'Renamed']]);
  });

  it('never returns rows of a transaction that is still in progress', async () => {
    const db = await freshDatabase();
    await push(db, ALICE, [upsert('trips', 'done', trip('done'))]);
    await db.exec('begin');
    await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [ALICE]);
    await db.exec('set local role authenticated');
    await db.query('select public.sync_push($1::jsonb)', [JSON.stringify([upsert('trips', 'in-flight', trip('in-flight'))])]);
    const during = (await db.query(`select public.sync_pull('0', 0, 100) as r`)).rows[0].r;
    await db.exec('commit');
    assert.deepEqual(during.rows.map((r) => r.pk), ['done']);
    const after = await pull(db, ALICE, during.cursor);
    assert.deepEqual(after.rows.map((r) => r.pk), ['in-flight']);
  });

  it('rejects oversized batches and unauthenticated calls', async () => {
    const db = await freshDatabase();
    const many = Array.from({ length: 501 }, (_, i) => upsert('trips', `x${i}`, trip(`x${i}`)));
    await assert.rejects(push(db, ALICE, many), /Too many changes/);
    await as(db, null, async () => undefined);
    await db.exec('set role authenticated');
    await db.query(`select set_config('request.jwt.claim.sub', '', false)`);
    await assert.rejects(db.query(`select public.sync_pull('0', 0, 10)`), /Not signed in/);
    await db.exec('reset role');
  });
});

describe('deploy bundle (supabase/deploy/g1_bundle.sql)', () => {
  const bundlePath = join(import.meta.dirname, '..', 'deploy', 'g1_bundle.sql');
  const catalog = async (db) =>
    (
      await db.query(`select
        (select json_agg(tablename order by tablename) from pg_tables where schemaname = 'public') as tables,
        (select json_agg(policyname order by policyname) from pg_policies where schemaname = 'public') as policies,
        (select json_agg(indexname order by indexname) from pg_indexes where schemaname = 'public') as indexes,
        (select json_agg(proname order by proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public') as functions`)
    ).rows[0];

  it('is up to date with the migration files', async () => {
    const { buildBundle } = await import('../../scripts/build-supabase-bundle.mjs');
    assert.equal(readFileSync(bundlePath, 'utf8'), buildBundle());
  });

  it('builds exactly the same schema as the migrations and records the history', async () => {
    // The bundle is the G1-only setup bundle; compare it with exactly the G1 migrations.
    const { G1_FILES } = await import('../../scripts/build-supabase-bundle.mjs');
    const viaMigrations = new PGlite();
    await viaMigrations.exec(SUPABASE_STUB);
    for (const file of G1_FILES) await viaMigrations.exec(readFileSync(join(MIGRATIONS, file), 'utf8'));
    const viaBundle = new PGlite();
    await viaBundle.exec(SUPABASE_STUB);
    await viaBundle.exec(readFileSync(bundlePath, 'utf8'));
    assert.deepEqual(await catalog(viaBundle), await catalog(viaMigrations));
    const history = (await viaBundle.query('select version, name from supabase_migrations.schema_migrations order by version')).rows;
    assert.deepEqual(history, [
      { version: '20261111090000', name: 'trip_prep_schema' },
      { version: '20261111090100', name: 'trip_prep_sync_functions' },
    ]);
    // And it works: a signed-in user can push and pull through RLS.
    const [result] = await push(viaBundle, ALICE, [upsert('trips', 'b1', trip('b1'))]);
    assert.equal(result.status, 'applied');
  });

  it('refuses to run a second time and changes nothing', async () => {
    const db = new PGlite();
    await db.exec(SUPABASE_STUB);
    await db.exec(readFileSync(bundlePath, 'utf8'));
    await push(db, ALICE, [upsert('trips', 'keep', trip('keep'))]);
    const before = await catalog(db);
    await assert.rejects(db.exec(readFileSync(bundlePath, 'utf8')), /already deployed/);
    await db.exec('rollback');
    assert.deepEqual(await catalog(db), before);
    assert.equal((await pull(db, ALICE)).rows.some((r) => r.pk === 'keep'), true);
  });
});
