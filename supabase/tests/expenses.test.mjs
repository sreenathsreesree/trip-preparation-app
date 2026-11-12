// Tests for the pending shared-expenses migration, on real Postgres (PGlite),
// applied on top of the deployed G1 migrations and the pending shared-trips
// migration. Every check is made as a signed-in user talking to the tables
// directly, as the app (or an attacker with a valid session) would.
//
//   npm run test:cloud

import { PGlite } from '@electric-sql/pglite';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { before, describe, it } from 'node:test';

const ROOT = join(import.meta.dirname, '..');
const OWNER = '11111111-1111-4111-8111-111111111111';
const EDITOR = '22222222-2222-4222-8222-222222222222';
const VIEWER = '33333333-3333-4333-8333-333333333333';
const STRANGER = '44444444-4444-4444-8444-444444444444';

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
  insert into auth.users (id) values ('${OWNER}'), ('${EDITOR}'), ('${VIEWER}'), ('${STRANGER}');
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
const q = (db, user, sql, params = []) => as(db, user, () => db.query(sql, params));
const hash = (t) => createHash('sha256').update(t).digest('hex');
const T = '2026-01-01T10:00:00Z';

const insertParticipant = (db, user, trip, id, name = id) =>
  q(db, user, `insert into public.shared_expense_participants (trip_id, id, name, created_at, updated_at) values ($1, $2, $3, $4, $4)`, [trip, id, name, T]);
const insertExpense = (db, user, trip, id, over = {}) => {
  const e = {
    amount_minor: 9000,
    currency: 'INR',
    paid_by: 'p-asha',
    splits: [
      { participant_id: 'p-asha', share_minor: 4500, input_value: 0 },
      { participant_id: 'p-ben', share_minor: 4500, input_value: 0 },
    ],
    ...over,
  };
  return q(
    db,
    user,
    `insert into public.shared_expenses (trip_id, id, title, amount_minor, currency, category, spent_on, paid_by, split_method, splits, created_at, updated_at, created_by)
     values ($1, $2, 'Dinner', $3, $4, 'food', '2026-12-20', $5, 'equal', $6::jsonb, $7, $7, $8)`,
    [trip, id, e.amount_minor, e.currency, e.paid_by, JSON.stringify(e.splits), T, e.created_by ?? user],
  );
};

async function sharedTrip(db) {
  const trip = (await q(db, OWNER, `select public.create_shared_trip('Kerala', '2026-12-20', '2026-12-24', 'Asha') as id`)).rows[0].id;
  await q(db, OWNER, `select public.create_shared_trip_invite($1, $2, 'editor')`, [trip, hash('e')]);
  await q(db, OWNER, `select public.create_shared_trip_invite($1, $2, 'viewer')`, [trip, hash('v')]);
  await q(db, EDITOR, `select public.accept_shared_trip_invite('e', 'Ben')`);
  await q(db, VIEWER, `select public.accept_shared_trip_invite('v', 'Vee')`);
  await insertParticipant(db, OWNER, trip, 'p-asha', 'Asha');
  await insertParticipant(db, OWNER, trip, 'p-ben', 'Ben');
  return trip;
}

const tables = ['shared_expense_participants', 'shared_expenses', 'shared_expense_settlements', 'shared_expense_budgets'];

describe('shared expenses: who can read and write', () => {
  let db;
  let trip;
  before(async () => {
    db = await freshDatabase();
    trip = await sharedTrip(db);
    await insertExpense(db, OWNER, trip, 'x1');
    await q(db, EDITOR, `insert into public.shared_expense_settlements (trip_id, id, from_id, to_id, amount_minor, currency, settled_on, created_at, updated_at) values ($1, 's1', 'p-ben', 'p-asha', 4500, 'INR', '2026-12-21', $2, $2)`, [trip, T]);
    await q(db, OWNER, `insert into public.shared_expense_budgets (trip_id, id, total_minor, daily_limit_minor, created_at, updated_at) values ($1, 'INR', 5000000, 800000, $2, $2)`, [trip, T]);
  });

  it('every expense table has forced RLS and no delete policy', async () => {
    for (const t of tables) {
      const r = (await db.query(`select relrowsecurity, relforcerowsecurity from pg_class where relname = $1`, [t])).rows[0];
      assert.deepEqual(r, { relrowsecurity: true, relforcerowsecurity: true }, t);
      assert.equal((await db.query(`select count(*)::int as n from pg_policies where tablename = $1 and cmd = 'DELETE'`, [t])).rows[0].n, 0);
    }
  });

  it('members (including viewers) read everything of the trip', async () => {
    for (const user of [OWNER, EDITOR, VIEWER]) {
      for (const t of tables) assert.ok((await q(db, user, `select * from public.${t}`)).rows.length >= 1, `${t} as ${user}`);
    }
  });

  it('strangers and anonymous callers read nothing', async () => {
    for (const t of tables) {
      assert.equal((await q(db, STRANGER, `select * from public.${t}`)).rows.length, 0, t);
      await assert.rejects(q(db, null, `select * from public.${t}`), /permission denied/);
    }
  });

  it('viewers and strangers cannot add or change anything', async () => {
    for (const user of [VIEWER, STRANGER]) {
      await assert.rejects(insertExpense(db, user, trip, `bad-${user.slice(0, 4)}`), /row-level security/);
      await assert.rejects(insertParticipant(db, user, trip, `p-${user.slice(0, 4)}`), /row-level security/);
      for (const t of tables) {
        const changed = await q(db, user, `update public.${t} set updated_at = now()`);
        assert.equal(changed.affectedRows, 0, `${t} as ${user}`);
      }
    }
  });

  it('editors write; nobody can hard-delete; deletes are tombstones in the pull', async () => {
    await insertExpense(db, EDITOR, trip, 'x2');
    for (const user of [OWNER, EDITOR]) {
      for (const t of tables) await assert.rejects(q(db, user, `delete from public.${t}`), /permission denied/);
    }
    await q(db, EDITOR, `update public.shared_expenses set deleted_at = now(), updated_at = now() where id = 'x2'`);
    const pulled = (await q(db, VIEWER, 'select public.shared_pull($1) as r', [trip])).rows[0].r;
    assert.equal(pulled.rows.find((r) => r.pk === 'x2').deleted, true);
    assert.deepEqual(
      [...new Set(pulled.rows.map((r) => r.table))].sort(),
      ['shared_expense_budgets', 'shared_expense_participants', 'shared_expense_settlements', 'shared_expenses'],
    );
  });

  it('the creator is always the caller and never changes', async () => {
    await insertExpense(db, EDITOR, trip, 'x3', { created_by: OWNER });
    assert.equal((await db.query(`select created_by from public.shared_expenses where id = 'x3'`)).rows[0].created_by, EDITOR);
    await assert.rejects(q(db, OWNER, `update public.shared_expenses set created_by = $1, updated_at = now() where id = 'x3'`, [OWNER]), /cannot change/);
    await assert.rejects(q(db, OWNER, `update public.shared_expenses set amount_minor = 1, splits = '[{"participant_id":"p-asha","share_minor":1}]', updated_at = '2020-01-01' where id = 'x3'`), /stale write/);
  });

  it('a removed member loses access at once', async () => {
    await q(db, OWNER, 'select public.remove_shared_trip_member($1, $2)', [trip, EDITOR]);
    for (const t of tables) assert.equal((await q(db, EDITOR, `select * from public.${t}`)).rows.length, 0, t);
    await assert.rejects(insertExpense(db, EDITOR, trip, 'x4'), /row-level security/);
  });
});

describe('shared expenses: amounts and splits are exact and consistent', () => {
  let db;
  let trip;
  let other;
  before(async () => {
    db = await freshDatabase();
    trip = await sharedTrip(db);
    other = (await q(db, OWNER, `select public.create_shared_trip('Other', '2027-01-01', '2027-01-02') as id`)).rows[0].id;
    await insertParticipant(db, OWNER, other, 'p-other');
  });

  const bad = [
    ['shares that do not add up', { splits: [{ participant_id: 'p-asha', share_minor: 4000 }, { participant_id: 'p-ben', share_minor: 4500 }] }, /split_valid/],
    ['a negative share', { splits: [{ participant_id: 'p-asha', share_minor: 9500 }, { participant_id: 'p-ben', share_minor: -500 }] }, /split_valid/],
    ['a fractional share', { splits: [{ participant_id: 'p-asha', share_minor: 4499.5 }, { participant_id: 'p-ben', share_minor: 4500.5 }] }, /split_valid/],
    ['the same person twice', { splits: [{ participant_id: 'p-asha', share_minor: 4500 }, { participant_id: 'p-asha', share_minor: 4500 }] }, /split_valid/],
    ['an empty split', { splits: [] }, /split_valid/],
    ['a stranger in the split', { splits: [{ participant_id: 'p-asha', share_minor: 4500 }, { participant_id: 'nobody', share_minor: 4500 }] }, /participant of this trip/],
    ['a participant of another trip', { splits: [{ participant_id: 'p-asha', share_minor: 4500 }, { participant_id: 'p-other', share_minor: 4500 }] }, /participant of this trip/],
    ['a payer from another trip', { paid_by: 'p-other' }, /foreign key/],
    ['a zero amount', { amount_minor: 0, splits: [{ participant_id: 'p-asha', share_minor: 0 }] }, /check constraint/],
    ['a lowercase or made-up currency', { currency: 'inr' }, /check constraint/],
    ['an over-large amount', { amount_minor: 100000000001, splits: [{ participant_id: 'p-asha', share_minor: 100000000001 }] }, /check constraint/],
  ];
  for (const [label, over, error] of bad) {
    it(`rejects ${label}`, async () => {
      await assert.rejects(insertExpense(db, OWNER, trip, `bad-${label.replace(/\W/g, '')}`, over), error);
    });
  }

  it('keeps currencies separate exactly as entered (no conversion)', async () => {
    await insertExpense(db, OWNER, trip, 'inr');
    await insertExpense(db, OWNER, trip, 'usd', { currency: 'USD', amount_minor: 1001, splits: [{ participant_id: 'p-asha', share_minor: 501 }, { participant_id: 'p-ben', share_minor: 500 }] });
    const rows = (await q(db, VIEWER, `select id, currency, amount_minor::text as amount from public.shared_expenses where id in ('inr', 'usd') order by id`)).rows;
    assert.deepEqual(rows, [
      { id: 'inr', currency: 'INR', amount: '9000' },
      { id: 'usd', currency: 'USD', amount: '1001' },
    ]);
  });

  it('settlements need two different participants of the same trip', async () => {
    const settle = (from, to) =>
      q(db, OWNER, `insert into public.shared_expense_settlements (trip_id, id, from_id, to_id, amount_minor, currency, settled_on, created_at, updated_at) values ($1, $2, $3, $4, 100, 'INR', '2026-12-21', $5, $5)`, [trip, `s-${from}-${to}`, from, to, T]);
    await assert.rejects(settle('p-asha', 'p-asha'), /check constraint/);
    await assert.rejects(settle('p-asha', 'p-other'), /foreign key/);
    await settle('p-ben', 'p-asha');
  });

  it('has no place for personal expenses', async () => {
    const cols = (await db.query(`select column_name from information_schema.columns where table_name = 'shared_expenses'`)).rows.map((r) => r.column_name);
    assert.equal(cols.includes('scope'), false);
  });
});
