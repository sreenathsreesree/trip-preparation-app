// Pre-deployment review of supabase/pending/20261112090000_personal_backup.sql on real
// Postgres (PGlite): exactly what it adds, that it changes nothing in G1, that it coexists
// with the pending shared-trip migrations, that existing data survives it, and that the
// rollback script restores the G1 catalog exactly.
//
//   npm run test:cloud

import { PGlite } from '@electric-sql/pglite';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { before, describe, it } from 'node:test';

import { G1_FILES } from '../../scripts/build-supabase-bundle.mjs';
import { PENDING_SYNC_TABLES } from '../../src/features/sync/tables.ts';

const ROOT = join(import.meta.dirname, '..');
const G3_FILE = '20261112090000_personal_backup.sql';
const ALICE = '11111111-1111-4111-8111-111111111111';
const BOB = '22222222-2222-4222-8222-222222222222';
const STUB = `
  create role anon nologin;
  create role authenticated nologin;
  create schema auth;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  grant usage on schema auth to anon, authenticated;
  grant usage on schema public to anon, authenticated;
  insert into auth.users (id) values ('${ALICE}'), ('${BOB}');
`;
const sql = (dir, file) => readFileSync(join(ROOT, dir, file), 'utf8');
// Works before deployment (G3 in pending/) and after (G3 moved into migrations/).
const G1 = [...G1_FILES];
const G3_DIR = readdirSync(join(ROOT, 'migrations')).includes(G3_FILE) ? 'migrations' : 'pending';
const PENDING = readdirSync(join(ROOT, 'pending')).filter((f) => f.endsWith('.sql')).sort();
const OTHERS = [...readdirSync(join(ROOT, 'migrations')), ...PENDING].filter((f) => f.endsWith('.sql') && !G1.includes(f) && f !== G3_FILE).sort();

async function database(files) {
  const db = new PGlite();
  await db.exec(STUB);
  for (const [dir, file] of files) await db.exec(sql(dir, file));
  return db;
}
const g1 = () => database(G1.map((f) => ['migrations', f]));
const g1g3 = () => database([...G1.map((f) => ['migrations', f]), [G3_DIR, G3_FILE]]);

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
const push = (db, user, changes) => as(db, user, async () => (await db.query('select public.sync_push($1::jsonb) as r', [JSON.stringify(changes)])).rows[0].r.results);
const pull = (db, user, cursor = { txid: '0', revision: 0 }) =>
  as(db, user, async () => (await db.query('select public.sync_pull($1, $2, 1000) as r', [cursor.txid, cursor.revision])).rows[0].r);
const up = (table, pk, data, base = null) => ({ table, pk, op: 'upsert', base_revision: base, data });
const T = '2026-11-20T08:00:00.000Z';

/** Every object a migration could touch, for one set of tables (or all functions). */
async function catalog(db, tables) {
  const q = async (text, params = []) => (await db.query(text, params)).rows;
  return {
    tables: (await q(`select tablename from pg_tables where schemaname = 'public' order by 1`)).map((r) => r.tablename),
    columns: await q(
      `select table_name, column_name, data_type, is_nullable, column_default from information_schema.columns
       where table_schema = 'public' and table_name = any($1) order by 1, 2`,
      [tables],
    ),
    constraints: await q(
      `select c.relname, k.conname, pg_get_constraintdef(k.oid) as def from pg_constraint k join pg_class c on c.oid = k.conrelid
       join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = any($1) order by 1, 2`,
      [tables],
    ),
    indexes: await q(`select tablename, indexname, indexdef from pg_indexes where schemaname = 'public' and tablename = any($1) order by 1, 2`, [tables]),
    triggers: await q(
      `select c.relname, t.tgname, pg_get_triggerdef(t.oid) as def from pg_trigger t join pg_class c on c.oid = t.tgrelid
       where not t.tgisinternal and c.relname = any($1) order by 1, 2`,
      [tables],
    ),
    policies: await q(`select tablename, policyname, cmd, roles::text, qual, with_check from pg_policies where tablename = any($1) order by 1, 2`, [tables]),
    grants: await q(
      `select table_name, grantee, privilege_type from information_schema.role_table_grants
       where table_schema = 'public' and table_name = any($1) order by 1, 2, 3`,
      [tables],
    ),
    rls: await q(`select relname, relrowsecurity, relforcerowsecurity from pg_class where relname = any($1) order by 1`, [tables]),
    functions: await q(
      `select p.proname, md5(p.prosrc) as body, p.prosecdef, coalesce(p.proacl::text, '') as acl
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' order by 1, 2`,
    ),
    sequences: (await q(`select sequencename from pg_sequences where schemaname = 'public' order by 1`)).map((r) => r.sequencename),
    storage: (await q(`select count(*)::int as n from pg_namespace where nspname = 'storage'`))[0].n,
  };
}

const G3_TABLES = PENDING_SYNC_TABLES.map((t) => t.name).sort();

describe('1–2. adds exactly the 16 backup tables and changes nothing in G1', () => {
  let base;
  let after;
  let g1Tables;
  let db3;
  before(async () => {
    const db1 = await g1();
    g1Tables = (await db1.query(`select tablename from pg_tables where schemaname = 'public'`)).rows.map((r) => r.tablename);
    base = await catalog(db1, g1Tables);
    db3 = await g1g3();
    after = await catalog(db3, g1Tables);
  });

  it('adds exactly the 16 tables, no sequences, no functions, no storage', async () => {
    assert.equal(G3_TABLES.length, 16);
    assert.deepEqual(after.tables.filter((t) => !base.tables.includes(t)).sort(), G3_TABLES);
    assert.deepEqual(after.sequences, base.sequences);
    assert.deepEqual(after.functions, base.functions, 'no function added, changed or re-granted');
    assert.equal(after.storage, 0);
    assert.equal(/\bstorage\.|create\s+(or\s+replace\s+)?function|\balter\s|\bdrop\s|\bgrant\s|\brevoke\s|\bdelete\s|\bupdate\s|\btruncate\b/i.test(sql(G3_DIR, G3_FILE).replace(/^--.*$/gm, '').replace(/on delete cascade/gi, '')), false);
  });

  it('every G1 table keeps its columns, constraints, indexes, triggers, policies, grants and RLS', () => {
    for (const key of ['columns', 'constraints', 'indexes', 'triggers', 'policies', 'grants', 'rls']) assert.deepEqual(after[key], base[key], key);
  });

  it('the G1 registry rows are unchanged; exactly 16 rows are added', async () => {
    const rows = (await db3.query('select name, pk_column, rank from public.sync_tables order by name')).rows;
    const g1Rows = rows.filter((r) => !G3_TABLES.includes(r.name));
    assert.equal(g1Rows.length, 17);
    assert.deepEqual(rows.filter((r) => G3_TABLES.includes(r.name)).map((r) => r.name).sort(), G3_TABLES);
  });
});

describe('3–4. order and coexistence with the pending shared-trip migrations', () => {
  it('sorts after G1 and before both shared-trip files, so each can be deployed later in order', () => {
    for (const g1File of G1) assert.ok(G3_FILE > g1File);
    assert.ok(OTHERS.length >= 2);
    for (const shared of OTHERS) assert.ok(shared > G3_FILE, `${shared} sorts after G3`);
  });

  it('applies with them in timestamp order; names, registries and both pull functions stay separate', async () => {
    const where = (f) => (readdirSync(join(ROOT, 'migrations')).includes(f) ? 'migrations' : 'pending');
    const db = await database([...G1, G3_FILE, ...OTHERS].sort().map((f) => [where(f), f]));
    const tables = (await db.query(`select tablename from pg_tables where schemaname = 'public'`)).rows.map((r) => r.tablename);
    for (const t of G3_TABLES) assert.ok(tables.includes(t));
    assert.equal(G3_TABLES.some((t) => t.startsWith('shared_')), false);
    const registry = (await db.query('select name from public.sync_tables')).rows.map((r) => r.name);
    assert.equal(registry.some((n) => n.startsWith('shared_')), false, 'personal sync never includes shared tables');
    const shared = (await db.query('select name from public.shared_content_tables')).rows.map((r) => r.name);
    assert.equal(shared.some((n) => G3_TABLES.includes(n)), false, 'shared pull never includes personal tables');
    await push(db, ALICE, [up('trips', 't1', { id: 't1', name: 'K', start_date: '2026-11-20', end_date: '2026-11-25', adults: 1, children: 0, transport_mode: 'car', category: 'leisure', created_at: T, updated_at: T })]);
    const r = await push(db, ALICE, [up('journal_entries', 'j1', { id: 'j1', trip_id: 't1', node_id: null, entry_date: '2026-11-21', title: 'x', body: '', mood: null, visibility: 'private', created_at: T, updated_at: T })]);
    assert.equal(r[0].status, 'applied');
  });

  it('the SQL-editor bundle stays the G1-only setup bundle', async () => {
    const { buildBundle, G1_FILES } = await import('../../scripts/build-supabase-bundle.mjs');
    assert.deepEqual(G1_FILES, G1);
    assert.equal(buildBundle().includes('personal_backup'), false);
  });
});

describe('5–7. existing data, owner isolation and photos', () => {
  it('existing G1 rows (data, revisions, commit ids) are untouched and devices continue from their cursor', async () => {
    const db = await g1();
    await push(db, ALICE, [
      up('trips', 't1', { id: 't1', name: 'Kerala', start_date: '2026-11-20', end_date: '2026-11-25', adults: 2, children: 0, transport_mode: 'car', category: 'leisure', created_at: T, updated_at: T }),
      up('trip_plan_nodes', 'n1', { id: 'n1', trip_id: 't1', parent_id: null, place_id: null, name: 'Munnar', notes: '', position: 0, created_at: T, updated_at: T }),
    ]);
    const snapshot = async () => ({
      trips: (await db.query('select * from public.trips order by id')).rows,
      nodes: (await db.query('select * from public.trip_plan_nodes order by id')).rows,
    });
    const before = await snapshot();
    const cursor = (await pull(db, ALICE)).cursor;
    await db.exec(sql(G3_DIR, G3_FILE));
    assert.deepEqual(await snapshot(), before);
    assert.equal((await pull(db, ALICE, cursor)).rows.length, 0, 'nothing is re-delivered');
    // New records attach to the existing ones (same ids, same owner only).
    const ok = await push(db, ALICE, [up('journal_entries', 'j1', { id: 'j1', trip_id: 't1', node_id: 'n1', entry_date: '2026-11-21', title: 'Day', body: '', mood: null, visibility: 'private', created_at: T, updated_at: T })]);
    assert.equal(ok[0].status, 'applied');
    const bob = await push(db, BOB, [up('journal_entries', 'j2', { id: 'j2', trip_id: 't1', node_id: null, entry_date: '2026-11-21', title: 'x', body: '', mood: null, visibility: 'private', created_at: T, updated_at: T })]);
    assert.equal(bob[0].status, 'rejected');
    assert.equal((await pull(db, BOB)).rows.length, 0);
  });

  it('accepts only Drive references for photos (allow-list)', async () => {
    const db = await g1g3();
    await push(db, ALICE, [
      up('trips', 't1', { id: 't1', name: 'K', start_date: '2026-11-20', end_date: '2026-11-25', adults: 1, children: 0, transport_mode: 'car', category: 'leisure', created_at: T, updated_at: T }),
      up('trip_plan_nodes', 'n1', { id: 'n1', trip_id: 't1', parent_id: null, place_id: null, name: 'M', notes: '', position: 0, created_at: T, updated_at: T }),
    ]);
    const memory = (id, photos) => up('plan_node_memories', id, { node_id: id, trip_id: 't1', visited_on: null, rating: null, notes: '', moments: '', photos, created_at: T, updated_at: T });
    const cases = [
      ['[]', 'applied'],
      ['["drive:1AbCdEfGhIjKlMnOp","drive:2AbCdEfGhIjKlMnOp"]', 'applied'],
      ['["file:///data/user/0/x.jpg"]', 'rejected'],
      ['["data:image/jpeg;base64,AAAA"]', 'rejected'],
      ['["content://media/external/1"]', 'rejected'],
      ['["https://example.com/a.jpg"]', 'rejected'],
      ['["drive:short"]', 'rejected'],
      ['not json', 'rejected'],
    ];
    for (const [photos, expected] of cases) {
      await db.exec(`delete from public.plan_node_memories`);
      assert.equal((await push(db, ALICE, [memory('n1', photos)]))[0].status, expected, photos);
    }
    const cover = (uri) =>
      up('plan_node_profiles', 'n1', { node_id: 'n1', trip_id: 't1', visit_status: 'upcoming', visited_at: null, saved: 0, cover_image_uri: uri, tags: '[]', about: '', best_season: '', entry_fee: '', travel_info: '', visit_minutes: null, best_time: '', created_at: T, updated_at: T });
    for (const [uri, expected] of [['drive:1AbCdEfGhIjKlMnOp', 'applied'], ['file:///x.jpg', 'rejected'], ['https://x.com/a.jpg', 'rejected']]) {
      await db.exec(`delete from public.plan_node_profiles`);
      assert.equal((await push(db, ALICE, [cover(uri)]))[0].status, expected, uri);
    }
  });
});

describe('rollback script', () => {
  it('restores exactly the G1 catalog, keeps G1 data, and the migration can be re-applied', async () => {
    const db1 = await g1();
    const g1Tables = (await db1.query(`select tablename from pg_tables where schemaname = 'public'`)).rows.map((r) => r.tablename);
    const expected = await catalog(db1, g1Tables);
    const db = await g1g3();
    await push(db, ALICE, [
      up('trips', 't1', { id: 't1', name: 'Kerala', start_date: '2026-11-20', end_date: '2026-11-25', adults: 1, children: 0, transport_mode: 'car', category: 'leisure', created_at: T, updated_at: T }),
      up('journal_entries', 'j1', { id: 'j1', trip_id: 't1', node_id: null, entry_date: '2026-11-21', title: 'x', body: '', mood: null, visibility: 'private', created_at: T, updated_at: T }),
    ]);
    const trips = (await db.query('select * from public.trips')).rows;
    await db.exec(readFileSync(join(ROOT, 'pending', 'rollback', '20261112090000_personal_backup.down.sql'), 'utf8'));
    assert.deepEqual(await catalog(db, g1Tables), expected);
    assert.deepEqual((await db.query('select * from public.trips')).rows, trips);
    await db.exec(sql(G3_DIR, G3_FILE));
    assert.equal((await db.query(`select count(*)::int as n from public.sync_tables`)).rows[0].n, 33);
  });
});
