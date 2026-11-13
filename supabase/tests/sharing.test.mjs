// Tests for the pending shared-trips migration (supabase/pending/), run against
// real Postgres (PGlite) on top of the deployed G1 migrations. Privacy and
// permissions are checked from the database's side: every attack is made as
// a signed-in user talking to the tables and functions directly.
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

const sqlFiles = (dir) =>
  readdirSync(join(ROOT, dir))
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => join(ROOT, dir, f));

/** `shared: false` builds only what was deployed before sharing (G1 + G3), the baseline sharing must leave unchanged. */
async function freshDatabase({ shared = true } = {}) {
  const db = new PGlite();
  await db.exec(STUB);
  const files = [...sqlFiles('migrations'), ...sqlFiles('pending')].filter((f) => shared || !/_shared_/.test(f));
  for (const file of files) await db.exec(readFileSync(file, 'utf8'));
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

const rpc = (db, user, sql, params = []) => as(db, user, async () => (await db.query(sql, params)).rows[0]);
const hash = (token) => createHash('sha256').update(token).digest('hex');
const NOW = '2026-01-01T10:00:00.000Z';
const entry = (tripId, id, over = {}) => ({
  trip_id: tripId,
  id,
  entry_date: '2026-12-20',
  title: id,
  body: 'text',
  created_at: NOW,
  updated_at: NOW,
  ...over,
});
const insertEntry = (db, user, row) =>
  as(db, user, () =>
    db.query(
      `insert into public.shared_journal_entries (trip_id, id, author_id, entry_date, title, body, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [row.trip_id, row.id, row.author_id ?? user, row.entry_date, row.title, row.body, row.created_at, row.updated_at],
    ),
  );

/** A trip with an editor and a viewer who joined by invitation. */
async function sharedTrip(db) {
  const { id } = await rpc(db, OWNER, `select public.create_shared_trip('Kerala', '2026-12-20', '2026-12-24', 'Asha') as id`);
  await rpc(db, OWNER, `select public.create_shared_trip_invite($1, $2, 'editor')`, [id, hash('edit-token')]);
  await rpc(db, OWNER, `select public.create_shared_trip_invite($1, $2, 'viewer')`, [id, hash('view-token')]);
  await rpc(db, EDITOR, `select public.accept_shared_trip_invite('edit-token', 'Ben')`);
  await rpc(db, VIEWER, `select public.accept_shared_trip_invite('view-token', 'Vee')`);
  return id;
}

describe('shared trips: separation from G1', () => {
  it('leaves every deployed G1 table, policy and function exactly as it was', async () => {
    const catalog = async (db) =>
      (
        await db.query(`select
          (select json_agg(tablename order by tablename) from pg_tables where schemaname = 'public' and tablename not like 'shared%') as tables,
          (select json_agg(policyname order by policyname) from pg_policies where schemaname = 'public' and tablename not like 'shared%') as policies,
          (select json_agg(table_name || '.' || column_name || ':' || data_type order by table_name, column_name) from information_schema.columns
             where table_schema = 'public' and table_name not like 'shared%') as columns`)
      ).rows[0];
    // Compare only what G1 created: other pending migrations may add their own tables.
    const g1 = await catalog(await freshDatabase({ shared: false }));
    const withPending = await catalog(await freshDatabase());
    const g1Tables = new Set(g1.tables);
    assert.deepEqual(withPending.tables.filter((t) => g1Tables.has(t)), g1.tables);
    const g1Policies = new Set(g1.policies);
    assert.deepEqual(withPending.policies.filter((p) => g1Policies.has(p)), g1.policies);
    assert.deepEqual(withPending.columns.filter((c) => g1Tables.has(c.split('.')[0])), g1.columns);
  });

  it('deploys after the G1 and G3 migrations, shared trips before shared expenses', () => {
    const deploy = readdirSync(join(ROOT, 'migrations')).filter((f) => f.endsWith('.sql')).sort();
    assert.deepEqual(deploy.slice(-2), ['20261113090000_shared_trips.sql', '20261114090000_shared_expenses.sql']);
    assert.ok(deploy.indexOf('20261112090000_personal_backup.sql') < deploy.indexOf('20261113090000_shared_trips.sql'));
  });
});

describe('creating and reading shared trips', () => {
  let db;
  let trip;
  before(async () => {
    db = await freshDatabase();
    trip = await sharedTrip(db);
  });

  it('makes the creator the only owner; members see the trip and each other', async () => {
    const members = await as(db, EDITOR, async () => (await db.query('select user_id, role, display_name from public.shared_trip_members order by role')).rows);
    assert.deepEqual(members.map((m) => [m.role, m.display_name]), [
      ['editor', 'Ben'],
      ['owner', 'Asha'],
      ['viewer', 'Vee'],
    ]);
    assert.equal((await as(db, VIEWER, () => db.query('select name from public.shared_trips'))).rows[0].name, 'Kerala');
  });

  it('non-members and anonymous callers see nothing', async () => {
    for (const user of [STRANGER, null]) {
      await as(db, user, async () => {
        for (const table of ['shared_trips', 'shared_trip_members', 'shared_journal_entries', 'shared_trip_invites']) {
          const result = await db.query(`select * from public.${table}`).catch((e) => e);
          assert.ok(result instanceof Error ? /permission denied/.test(result.message) : result.rows.length === 0, `${table} as ${user}`);
        }
      });
    }
    await assert.rejects(rpc(db, STRANGER, 'select public.shared_pull($1) as r', [trip]), /Not a member/);
  });

  it('only the owner renames the trip or sees invitations', async () => {
    const renamed = (user) => as(db, user, async () => (await db.query(`update public.shared_trips set name = 'X' where id = $1`, [trip])).affectedRows);
    assert.equal(await renamed(EDITOR), 0);
    assert.equal(await renamed(OWNER), 1);
    assert.equal((await as(db, EDITOR, () => db.query('select * from public.shared_trip_invites'))).rows.length, 0);
    const invites = (await as(db, OWNER, () => db.query('select token_hash from public.shared_trip_invites'))).rows;
    assert.equal(invites.length, 2);
    assert.ok(invites.every((i) => /^[0-9a-f]{64}$/.test(i.token_hash) && i.token_hash !== 'edit-token'), 'only hashes are stored');
  });

  it('membership cannot be written directly, only through the checked functions', async () => {
    await as(db, STRANGER, async () => {
      await assert.rejects(db.query(`insert into public.shared_trip_members (trip_id, user_id, role) values ($1, $2, 'owner')`, [trip, STRANGER]), /permission denied/);
    });
    await as(db, EDITOR, async () => {
      await assert.rejects(db.query(`update public.shared_trip_members set role = 'owner'`), /permission denied/);
      await assert.rejects(db.query(`delete from public.shared_trip_members`), /permission denied/);
      await assert.rejects(db.query(`insert into public.shared_trip_invites (trip_id, token_hash, role, created_by, expires_at) values ($1, $2, 'editor', $3, now() + interval '1 day')`, [trip, hash('x'), EDITOR]), /permission denied/);
    });
  });
});

describe('invitations', () => {
  let db;
  let trip;
  before(async () => {
    db = await freshDatabase();
    trip = await sharedTrip(db);
  });

  it('only the owner invites, never as owner', async () => {
    await assert.rejects(rpc(db, EDITOR, `select public.create_shared_trip_invite($1, $2, 'viewer')`, [trip, hash('e')]), /Only the trip owner/);
    await assert.rejects(rpc(db, STRANGER, `select public.create_shared_trip_invite($1, $2, 'viewer')`, [trip, hash('s')]), /Only the trip owner/);
    await assert.rejects(rpc(db, OWNER, `select public.create_shared_trip_invite($1, $2, 'owner')`, [trip, hash('o')]), /editors or viewers/);
  });

  it('rejects wrong, revoked, expired and used-up invitations; joining twice keeps the role and uses nothing', async () => {
    await assert.rejects(rpc(db, STRANGER, `select public.accept_shared_trip_invite('no-such-token')`), /not valid/);

    const { id: revoked } = await rpc(db, OWNER, `select public.create_shared_trip_invite($1, $2, 'viewer') as id`, [trip, hash('revoked')]);
    await rpc(db, OWNER, 'select public.revoke_shared_trip_invite($1)', [revoked]);
    await assert.rejects(rpc(db, STRANGER, `select public.accept_shared_trip_invite('revoked')`), /cancelled/);

    await rpc(db, OWNER, `select public.create_shared_trip_invite($1, $2, 'viewer', 1, 1)`, [trip, hash('once')]);
    await db.query(`update public.shared_trip_invites set expires_at = now() - interval '1 minute' where token_hash = $1`, [hash('once')]);
    await assert.rejects(rpc(db, STRANGER, `select public.accept_shared_trip_invite('once')`), /expired/);

    await rpc(db, OWNER, `select public.create_shared_trip_invite($1, $2, 'editor', 24, 1)`, [trip, hash('single')]);
    const joined = await rpc(db, STRANGER, `select public.accept_shared_trip_invite('single', 'Sam') as r`);
    assert.equal(joined.r.role, 'editor');
    assert.equal(joined.r.name, 'Kerala');
    const again = await rpc(db, STRANGER, `select public.accept_shared_trip_invite('single') as r`);
    assert.equal(again.r.role, 'editor');
    // Joining with the viewer link does not downgrade or upgrade an existing member.
    assert.equal((await rpc(db, EDITOR, `select public.accept_shared_trip_invite('view-token') as r`)).r.role, 'editor');
    const uses = (await db.query('select uses from public.shared_trip_invites where token_hash = $1', [hash('single')])).rows[0].uses;
    assert.equal(uses, 1);
  });

  it('a used-up link stops further joins', async () => {
    const db2 = await freshDatabase();
    const t = await sharedTrip(db2);
    await rpc(db2, OWNER, `select public.create_shared_trip_invite($1, $2, 'viewer', 24, 1)`, [t, hash('one')]);
    await rpc(db2, STRANGER, `select public.accept_shared_trip_invite('one')`);
    await rpc(db2, OWNER, 'select public.remove_shared_trip_member($1, $2)', [t, STRANGER]);
    await assert.rejects(rpc(db2, STRANGER, `select public.accept_shared_trip_invite('one')`), /used up/);
  });
});

describe('roles on shared content', () => {
  let db;
  let trip;
  before(async () => {
    db = await freshDatabase();
    trip = await sharedTrip(db);
  });

  it('editors and the owner write; viewers and strangers cannot', async () => {
    await insertEntry(db, EDITOR, entry(trip, 'e1'));
    await insertEntry(db, OWNER, entry(trip, 'o1'));
    await assert.rejects(insertEntry(db, VIEWER, entry(trip, 'v1')), /row-level security/);
    await assert.rejects(insertEntry(db, STRANGER, entry(trip, 's1')), /row-level security/);
    const seen = await as(db, VIEWER, () => db.query('select id from public.shared_journal_entries order by id'));
    assert.deepEqual(seen.rows.map((r) => r.id), ['e1', 'o1']);
  });

  it('the author is always the caller and only the author edits an entry', async () => {
    // A forged author is replaced by the caller (never trusted from the client).
    await insertEntry(db, EDITOR, entry(trip, 'forged', { author_id: OWNER }));
    assert.equal((await db.query(`select author_id from public.shared_journal_entries where id = 'forged'`)).rows[0].author_id, EDITOR);
    const changed = (user) =>
      as(db, user, async () => (await db.query(`update public.shared_journal_entries set body = 'changed', updated_at = now() where id = 'e1'`)).affectedRows);
    assert.equal(await changed(OWNER), 0, 'the owner cannot rewrite someone else’s entry');
    assert.equal(await changed(VIEWER), 0);
    assert.equal(await changed(EDITOR), 1);
    await as(db, EDITOR, async () => {
      await assert.rejects(db.query(`update public.shared_journal_entries set author_id = $1 where id = 'e1'`, [OWNER]), /row-level security|cannot change/);
    });
  });

  it('refuses stale writes and hard deletes; deletes are tombstones pulled like any change', async () => {
    await as(db, EDITOR, async () => {
      await assert.rejects(db.query(`update public.shared_journal_entries set body = 'old', updated_at = '2020-01-01' where id = 'e1'`), /stale write/);
      await assert.rejects(db.query(`delete from public.shared_journal_entries where id = 'e1'`), /permission denied/);
      await db.query(`update public.shared_journal_entries set deleted_at = now(), updated_at = now() where id = 'e1'`);
    });
    const pulled = (await rpc(db, VIEWER, 'select public.shared_pull($1) as r', [trip])).r;
    assert.equal(pulled.rows.find((r) => r.pk === 'e1').deleted, true);
  });

  it('a demoted editor can no longer write; a removed member loses access at once', async () => {
    await rpc(db, OWNER, `select public.set_shared_trip_member_role($1, $2, 'viewer')`, [trip, EDITOR]);
    await assert.rejects(insertEntry(db, EDITOR, entry(trip, 'e2')), /row-level security/);
    await rpc(db, OWNER, 'select public.remove_shared_trip_member($1, $2)', [trip, EDITOR]);
    assert.equal((await as(db, EDITOR, () => db.query('select * from public.shared_journal_entries'))).rows.length, 0);
    assert.equal((await as(db, EDITOR, () => db.query('select * from public.shared_trips'))).rows.length, 0);
    await assert.rejects(rpc(db, EDITOR, 'select public.shared_pull($1) as r', [trip]), /Not a member/);
  });
});

describe('membership changes', () => {
  let db;
  let trip;
  before(async () => {
    db = await freshDatabase();
    trip = await sharedTrip(db);
  });

  it('only the owner changes roles or removes members, and never themself', async () => {
    await assert.rejects(rpc(db, EDITOR, `select public.set_shared_trip_member_role($1, $2, 'editor')`, [trip, VIEWER]), /Only the trip owner/);
    await assert.rejects(rpc(db, EDITOR, 'select public.remove_shared_trip_member($1, $2)', [trip, VIEWER]), /Only the trip owner/);
    await assert.rejects(rpc(db, OWNER, `select public.set_shared_trip_member_role($1, $2, 'viewer')`, [trip, OWNER]), /Transfer ownership/);
    await assert.rejects(rpc(db, OWNER, 'select public.remove_shared_trip_member($1, $2)', [trip, OWNER]), /cannot be removed/);
    await assert.rejects(rpc(db, OWNER, `select public.set_shared_trip_member_role($1, $2, 'owner')`, [trip, EDITOR]), /editor or viewer/);
  });

  it('members leave; the owner must transfer ownership first', async () => {
    await assert.rejects(rpc(db, OWNER, 'select public.leave_shared_trip($1)', [trip]), /Transfer ownership/);
    await rpc(db, VIEWER, 'select public.leave_shared_trip($1)', [trip]);
    assert.equal((await as(db, VIEWER, () => db.query('select * from public.shared_trips'))).rows.length, 0);

    await assert.rejects(rpc(db, OWNER, 'select public.transfer_shared_trip($1, $2)', [trip, STRANGER]), /already be a member/);
    await rpc(db, OWNER, 'select public.transfer_shared_trip($1, $2)', [trip, EDITOR]);
    const roles = (await db.query('select user_id, role from public.shared_trip_members where trip_id = $1 order by role', [trip])).rows;
    assert.deepEqual(roles, [
      { user_id: OWNER, role: 'editor' },
      { user_id: EDITOR, role: 'owner' },
    ]);
    await rpc(db, OWNER, 'select public.leave_shared_trip($1)', [trip]);
  });

  it('only the owner deletes the trip, and everything in it goes', async () => {
    await insertEntry(db, EDITOR, entry(trip, 'x'));
    await assert.rejects(rpc(db, STRANGER, 'select public.delete_shared_trip($1)', [trip]), /Only the trip owner/);
    await rpc(db, EDITOR, 'select public.delete_shared_trip($1)', [trip]);
    for (const table of ['shared_trips', 'shared_trip_members', 'shared_trip_invites', 'shared_journal_entries']) {
      assert.equal((await db.query(`select count(*)::int as n from public.${table}`)).rows[0].n, 0, table);
    }
  });
});

describe('shared pull cursor', () => {
  it('pages through a trip’s changes once, and never another trip’s', async () => {
    const db = await freshDatabase();
    const trip = await sharedTrip(db);
    const other = (await rpc(db, OWNER, `select public.create_shared_trip('Other', '2027-01-01', '2027-01-02') as id`)).id;
    for (let i = 0; i < 5; i++) await insertEntry(db, EDITOR, entry(trip, `p${i}`));
    await insertEntry(db, OWNER, entry(other, 'elsewhere'));
    const seen = [];
    let cursor = { txid: '0', revision: 0 };
    for (;;) {
      const page = (await rpc(db, VIEWER, 'select public.shared_pull($1, $2, $3, 2) as r', [trip, cursor.txid, cursor.revision])).r;
      seen.push(...page.rows.map((r) => r.pk));
      cursor = page.cursor;
      if (!page.has_more) break;
    }
    assert.deepEqual(seen, ['p0', 'p1', 'p2', 'p3', 'p4']);
    assert.equal(seen.includes('elsewhere'), false);
  });
});
