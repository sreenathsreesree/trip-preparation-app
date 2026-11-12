// Tests for the pending G3 personal-backup migration on real Postgres (PGlite),
// applied on top of the deployed G1 migrations (and the other pending files).
// Every change goes through G1's own sync_push / sync_pull, exactly as the app does.
//
//   npm run test:cloud

import { PGlite } from '@electric-sql/pglite';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { before, describe, it } from 'node:test';

import { PENDING_SYNC_TABLES, SYNC_TABLES } from '../../src/features/sync/tables.ts';

const ROOT = join(import.meta.dirname, '..');
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
const files = (dir) => readdirSync(join(ROOT, dir)).filter((f) => f.endsWith('.sql')).sort().map((f) => join(ROOT, dir, f));

async function freshDatabase() {
  const db = new PGlite();
  await db.exec(STUB);
  for (const file of [...files('migrations'), ...files('pending')]) await db.exec(readFileSync(file, 'utf8'));
  return db;
}
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
const pull = (db, user) => as(db, user, async () => (await db.query(`select public.sync_pull('0', 0, 1000) as r`)).rows[0].r);
const up = (table, pk, data, base = null) => ({ table, pk, op: 'upsert', base_revision: base, data });
const T = '2026-11-20T08:00:00.000Z';

/** A full personal graph using every G3 table (and the G1 parents they need). */
const graph = () => [
  up('trips', 't1', { id: 't1', name: 'Kerala', start_date: '2026-11-20', end_date: '2026-11-25', adults: 2, children: 0, transport_mode: 'car', category: 'leisure', created_at: T, updated_at: T }),
  up('inventory_categories', 'c1', { id: 'c1', parent_id: null, name: 'Clothing', icon: 'tshirt-crew', color: '#fff', position: 0, cover_image_uri: null, system_key: 'clothing', created_at: T, updated_at: T }),
  up('trip_plan_nodes', 'n1', { id: 'n1', trip_id: 't1', parent_id: null, place_id: null, name: 'Munnar', notes: '', position: 0, created_at: T, updated_at: T }),
  up('expense_participants', 'p1', { id: 'p1', trip_id: 't1', name: 'Asha', member_user_id: null, is_me: 1, position: 0, archived_at: null, created_at: T, updated_at: T }),
  up('expense_participants', 'p2', { id: 'p2', trip_id: 't1', name: 'Ben', member_user_id: null, is_me: 0, position: 1, archived_at: null, created_at: T, updated_at: T }),
  up('expense_categories', 'ec1', { id: 'ec1', trip_id: 't1', name: 'Souvenirs', created_at: T, updated_at: T }),
  up('expense_settings', 't1', { trip_id: 't1', currency: 'INR', updated_at: T }),
  up('expense_budgets', 't1:INR', { id: 't1:INR', trip_id: 't1', currency: 'INR', total_minor: 5000000, daily_limit_minor: 800000, lines: '[]', updated_at: T }),
  up('inventory_category_details', 'c1', { category_id: 'c1', description: 'Everything to wear' }),
  up('trip_navigation_items', 'nav1', { id: 'nav1', trip_id: 't1', node_id: 'n1', parent_id: null, position: 0, created_at: T, updated_at: T }),
  up('plan_node_profiles', 'n1', { node_id: 'n1', trip_id: 't1', visit_status: 'visited', visited_at: T, saved: 1, cover_image_uri: 'drive:1AbCdEfGhIjKlMnOp', tags: '["Must visit"]', about: '', best_season: '', entry_fee: '', travel_info: '', visit_minutes: 120, best_time: 'morning', created_at: T, updated_at: T }),
  up('plan_node_tasks', 'pt1', { id: 'pt1', trip_id: 't1', node_id: 'n1', category: 'tickets', title: 'Book jeep', notes: '', is_done: 0, position: 0, completed_at: null, created_at: T, updated_at: T }),
  up('plan_node_notes', 'pn1', { id: 'pn1', trip_id: 't1', node_id: 'n1', kind: 'food', body: 'Tea', position: 0, created_at: T, updated_at: T }),
  up('plan_node_alerts', 'pa1', { id: 'pa1', trip_id: 't1', node_id: 'n1', kind: 'info', title: 'Road work', body: '', source: 'Board', source_url: null, confirmed: 0, status: 'saved', observed_at: T, created_at: T, updated_at: T }),
  up('plan_node_memories', 'n1', { node_id: 'n1', trip_id: 't1', visited_on: '2026-11-21', rating: 5, notes: 'Misty', moments: '', photos: '["drive:1AbCdEfGhIjKlMnOq"]', created_at: T, updated_at: T }),
  up('journal_entries', 'j1', { id: 'j1', trip_id: 't1', node_id: 'n1', entry_date: '2026-11-21', title: 'Day one', body: 'Rain', mood: 'great', visibility: 'private', created_at: T, updated_at: T }),
  up('expenses', 'e1', {
    id: 'e1', trip_id: 't1', scope: 'group', title: 'Boat', amount_minor: 1000, currency: 'INR', category: 'transport', category_name: '', spent_on: '2026-11-21',
    paid_by: 'p1', split_method: 'equal', splits: '[{"participant_id":"p1","share_minor":500,"input_value":0},{"participant_id":"p2","share_minor":500,"input_value":0}]',
    notes: '', created_by: null, created_at: T, updated_at: T,
  }),
  up('expenses', 'e2', { id: 'e2', trip_id: 't1', scope: 'personal', title: 'Tea', amount_minor: 50, currency: 'INR', category: 'food', category_name: '', spent_on: '2026-11-21', paid_by: null, split_method: 'equal', splits: '[]', notes: '', created_by: null, created_at: T, updated_at: T }),
  up('expense_settlements', 's1', { id: 's1', trip_id: 't1', from_id: 'p2', to_id: 'p1', amount_minor: 500, currency: 'INR', settled_on: '2026-11-22', note: '', created_by: null, created_at: T, updated_at: T }),
  up('packing_entries', 'pe1', { id: 'pe1', trip_id: 't1', inventory_item_id: null, name: 'Rice', category_id: null, quantity: 2, traveller_id: null, luggage_id: null, is_packed: 0, notes: '', source: 'manual', recommendation_id: null, position: 0, created_at: T, updated_at: T }),
  up('packing_entry_units', 'pe1', { entry_id: 'pe1', unit: 'kg' }),
  up('journal_photos', 'jp1', { id: 'jp1', entry_id: 'j1', drive_file_id: '1AbCdEfGhIjKlMnOr', caption: 'View', position: 0, created_at: T }),
];
const G3 = PENDING_SYNC_TABLES.map((t) => t.name);

describe('G3 backup schema', () => {
  let db;
  before(async () => {
    db = await freshDatabase();
  });

  it('registers exactly the client’s tables, keys, ranks and columns (G1 + G3)', async () => {
    const all = [...SYNC_TABLES, ...PENDING_SYNC_TABLES];
    const registry = (await db.query('select name, pk_column, rank from public.sync_tables order by name')).rows;
    assert.deepEqual(registry, [...all].sort((a, b) => a.name.localeCompare(b.name)).map((t) => ({ name: t.name, pk_column: t.pk, rank: t.rank })));
    for (const t of PENDING_SYNC_TABLES) {
      const cols = (await db.query('select public.sync_writable_columns($1) as c', [t.name])).rows[0].c;
      assert.deepEqual([...cols].sort(), [...t.columns].sort(), t.name);
    }
  });

  it('every G3 table has forced RLS, owner-only policies, no delete and the stamping trigger', async () => {
    for (const name of G3) {
      const r = (
        await db.query(
          `select c.relrowsecurity, c.relforcerowsecurity,
             exists (select 1 from pg_trigger t where t.tgrelid = c.oid and t.tgname = c.relname || '_sync_stamp') as stamped,
             (select count(*)::int from pg_policies p where p.tablename = c.relname) as policies,
             (select count(*)::int from pg_policies p where p.tablename = c.relname and p.cmd = 'DELETE') as deletes
           from pg_class c where c.relname = $1`,
          [name],
        )
      ).rows[0];
      assert.deepEqual(r, { relrowsecurity: true, relforcerowsecurity: true, stamped: true, policies: 3, deletes: 0 }, name);
    }
  });
});

describe('G3 backup through the G1 protocol', () => {
  let db;
  before(async () => {
    db = await freshDatabase();
  });

  it('backs up a full personal graph and restores it on another device of the same account', async () => {
    const results = await push(db, ALICE, graph());
    assert.deepEqual(results.filter((r) => r.status !== 'applied'), []);
    const restored = await pull(db, ALICE);
    const tables = new Set(restored.rows.map((r) => r.table));
    for (const name of G3) assert.ok(tables.has(name), `restored ${name}`);
    const expense = restored.rows.find((r) => r.table === 'expenses' && r.pk === 'e1');
    assert.equal(JSON.parse(expense.data.splits).length, 2);
    assert.equal(restored.rows.some((r) => 'user_id' in r.data), false, 'owner column is never sent to devices');
  });

  it('another account sees nothing, cannot change anything and cannot reference the owner’s rows', async () => {
    assert.equal((await pull(db, BOB)).rows.length, 0);
    await as(db, BOB, async () => {
      for (const name of G3) assert.equal((await db.query(`select * from public.${name}`)).rows.length, 0, name);
      for (const name of G3) assert.equal((await db.query(`update public.${name} set revision = revision`)).affectedRows, 0, name);
    });
    // Bob pointing his rows at Alice's trip / node / entry is refused by the user-scoped foreign keys.
    const attempts = await push(db, BOB, [
      up('journal_entries', 'bj', { id: 'bj', trip_id: 't1', node_id: null, entry_date: '2026-11-21', title: 'x', body: '', mood: null, visibility: 'private', created_at: T, updated_at: T }),
      up('plan_node_tasks', 'bt', { id: 'bt', trip_id: 't1', node_id: 'n1', category: 'other', title: 'x', notes: '', is_done: 0, position: 0, completed_at: null, created_at: T, updated_at: T }),
      up('journal_photos', 'bp', { id: 'bp', entry_id: 'j1', drive_file_id: '1AbCdEfGhIjKlMnOs', caption: '', position: 0, created_at: T }),
    ]);
    assert.deepEqual(attempts.map((r) => r.status), ['rejected', 'rejected', 'rejected']);
  });

  it('ignores a forged owner and refuses anonymous callers', async () => {
    await push(db, BOB, [up('trips', 'bt1', { id: 'bt1', name: 'Bob', start_date: '2026-11-20', end_date: '2026-11-21', adults: 1, children: 0, transport_mode: 'car', category: 'leisure', created_at: T, updated_at: T })]);
    await push(db, BOB, [up('journal_entries', 'bj2', { id: 'bj2', trip_id: 'bt1', node_id: null, entry_date: '2026-11-21', title: 'mine', body: '', mood: null, visibility: 'private', created_at: T, updated_at: T, user_id: ALICE })]);
    assert.equal((await db.query(`select user_id from public.journal_entries where id = 'bj2'`)).rows[0].user_id, BOB);
    await assert.rejects(push(db, null, [up('journal_entries', 'x', {})]), /Not signed in|permission denied/);
  });

  it('never stores device photo paths — only Drive references', async () => {
    const rev = async (table, pk) => (await pull(db, ALICE)).rows.find((r) => r.table === table && r.pk === pk).revision;
    const memory = graph().find((c) => c.table === 'plan_node_memories').data;
    const profile = graph().find((c) => c.table === 'plan_node_profiles').data;
    const bad = await push(db, ALICE, [
      up('plan_node_memories', 'n1', { ...memory, photos: '["file:///data/x.jpg"]' }, await rev('plan_node_memories', 'n1')),
      up('plan_node_profiles', 'n1', { ...profile, cover_image_uri: 'file:///x.jpg' }, await rev('plan_node_profiles', 'n1')),
      up('journal_photos', 'jp2', { id: 'jp2', entry_id: 'j1', drive_file_id: 'file:///x.jpg', caption: '', position: 0, created_at: T }),
    ]);
    assert.deepEqual(bad.map((r) => r.status), ['rejected', 'rejected', 'rejected']);
  });

  it('retries are idempotent; a stale device change is a conflict, not an overwrite', async () => {
    const row = graph().find((c) => c.table === 'journal_entries');
    const current = (await pull(db, ALICE)).rows.find((r) => r.table === 'journal_entries' && r.pk === 'j1');
    const edit = up('journal_entries', 'j1', { ...row.data, body: 'Heavy rain', updated_at: '2026-11-21T09:00:00.000Z' }, current.revision);
    assert.equal((await push(db, ALICE, [edit]))[0].status, 'applied');
    assert.equal((await push(db, ALICE, [edit]))[0].status, 'applied', 'same change again after a lost response');
    const stale = up('journal_entries', 'j1', { ...row.data, body: 'Old phone edit', updated_at: '2026-11-21T10:00:00.000Z' }, current.revision);
    const result = (await push(db, ALICE, [stale]))[0];
    assert.equal(result.status, 'conflict');
    assert.equal(result.server_row.body, 'Heavy rain');
  });

  it('deletes are tombstones that restore as deletions', async () => {
    const current = (await pull(db, ALICE)).rows.find((r) => r.table === 'plan_node_notes' && r.pk === 'pn1');
    const res = await push(db, ALICE, [{ table: 'plan_node_notes', pk: 'pn1', op: 'delete', base_revision: current.revision, data: {} }]);
    assert.equal(res[0].status, 'applied');
    assert.equal((await pull(db, ALICE)).rows.find((r) => r.table === 'plan_node_notes' && r.pk === 'pn1').deleted, true);
  });
});
