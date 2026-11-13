// Tests for supabase/pending/20261115090000_revoke_table_maintenance_privileges.sql
// on real Postgres (PGlite 17), with the stand-in for Supabase reproducing the
// project's live default privileges (authenticated/anon get TRUNCATE,
// REFERENCES, TRIGGER, MAINTAIN on every table postgres creates), plus PUBLIC
// grants to prove the PUBLIC path is closed too.
import { createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { before, describe, it } from 'node:test';

const ROOT = join(import.meta.dirname, '..');
const HARDENING = join(ROOT, 'migrations', '20261115090000_revoke_table_maintenance_privileges.sql');
const ROLLBACK = join(ROOT, 'pending', 'rollback', '20261115090000_revoke_table_maintenance_privileges.down.sql');
const ALICE = '11111111-1111-4111-8111-111111111111';
const BOB = '22222222-2222-4222-8222-222222222222';
const NOW = '2026-11-13T08:00:00Z';
const UNNEEDED = ['TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'];
const ROLES = ['anon', 'authenticated'];

const STUB = `
  create role anon nologin;
  create role authenticated nologin;
  create schema auth;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated;
  grant usage on schema public to anon, authenticated;
  insert into auth.users (id) values ('${ALICE}'), ('${BOB}');
  -- As on the live project (pg_default_acl for postgres in public: anon/authenticated = Dxtm).
  alter default privileges for role postgres in schema public grant truncate, references, trigger, maintain on tables to anon, authenticated;
`;

async function deployed() {
  const db = new PGlite();
  await db.exec(STUB);
  for (const f of readdirSync(join(ROOT, 'migrations')).filter((f) => f.endsWith('.sql') && !f.includes('revoke_table_maintenance')).sort()) await db.exec(readFileSync(join(ROOT, 'migrations', f), 'utf8'));
  // Prove the PUBLIC path is closed as well (the live project has none, a future grant must not reopen it).
  await db.exec(`grant truncate on public.trips to public`);
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

/** Effective privileges (direct, via PUBLIC or role membership) of anon/authenticated on every public relation. */
async function privileges(db) {
  const { rows } = await db.query(`
    select c.relname, r.role, p.priv
    from pg_class c
    cross join unnest(array['anon','authenticated']) r(role)
    cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) p(priv)
    where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','p','v','m')
      and has_table_privilege(r.role, c.oid, p.priv)
    order by 1, 2, 3`);
  return rows.map((x) => `${x.relname}:${x.role}:${x.priv}`);
}

async function catalog(db) {
  return (
    await db.query(`select
      (select md5(string_agg(tablename||policyname||cmd||array_to_string(roles,',')||coalesce(qual,'')||coalesce(with_check,''),'|' order by tablename, policyname)) from pg_policies where schemaname='public') as policies,
      (select md5(string_agg(table_name||column_name||data_type||is_nullable||coalesce(column_default,''),'|' order by table_name, ordinal_position)) from information_schema.columns where table_schema='public') as columns,
      (select md5(string_agg(p.oid::regprocedure::text||md5(prosrc)||prosecdef||coalesce(proacl::text,''),'|' order by 1)) from pg_proc p where pronamespace='public'::regnamespace) as functions,
      (select md5(string_agg(relname||relowner::regrole::text||relrowsecurity||relforcerowsecurity,'|' order by relname)) from pg_class where relnamespace='public'::regnamespace and relkind='r') as tables,
      (select md5(string_agg(tgrelid::regclass::text||tgname,'|' order by 1)) from pg_trigger where not tgisinternal) as triggers`)
  ).rows[0];
}

async function rowCounts(db) {
  const tables = (await db.query(`select relname from pg_class where relnamespace='public'::regnamespace and relkind='r' order by 1`)).rows.map((r) => r.relname);
  const out = {};
  for (const t of tables) out[t] = Number((await db.query(`select count(*) n from public."${t}"`)).rows[0].n);
  return out;
}

/** Some data in G1, G3 and shared tables, written the way the app writes it. */
async function seed(db) {
  await as(db, ALICE, async () => {
    await db.query(`insert into public.trips (user_id, id, name, start_date, end_date, transport_mode, category, created_at, updated_at)
      values ($1, 't1', 'Kerala', '2026-12-01', '2026-12-05', 'car', 'leisure', $2, $2)`, [ALICE, NOW]);
    const trip = (await db.query(`select public.create_shared_trip('Kerala', '2026-12-01', '2026-12-05', 'Asha') as id`)).rows[0].id;
    await db.query(`select public.create_shared_trip_invite($1, $2, 'editor')`, [trip, createHash('sha256').update('tok').digest('hex')]);
    return trip;
  });
}

describe('table maintenance privileges', () => {
  let db;
  let before_;
  let catalogBefore;
  let countsBefore;
  before(async () => {
    db = await deployed();
    await seed(db);
    before_ = await privileges(db);
    catalogBefore = await catalog(db);
    countsBefore = await rowCounts(db);
    await db.exec(readFileSync(HARDENING, 'utf8'));
  });

  it('started from the live project’s situation (authenticated held all four, PUBLIC reopened TRUNCATE)', () => {
    for (const p of UNNEEDED) assert.ok(before_.includes(`trips:authenticated:${p}`), p);
    assert.ok(before_.includes('trips:anon:TRUNCATE'), 'via PUBLIC');
  });

  it('leaves anon and authenticated without TRUNCATE, REFERENCES, TRIGGER or MAINTAIN on every table, including through PUBLIC', async () => {
    const after = await privileges(db);
    assert.deepEqual(after.filter((p) => UNNEEDED.includes(p.split(':')[2])), []);
    const viaPublic = (await db.query(`select count(*) n from pg_class c, aclexplode(c.relacl) a where c.relnamespace='public'::regnamespace and a.grantee = 0 and a.privilege_type = any($1)`, [UNNEEDED])).rows[0].n;
    assert.equal(Number(viaPublic), 0);
  });

  it('keeps every SELECT / INSERT / UPDATE / DELETE privilege exactly as it was', async () => {
    const keep = (list) => list.filter((p) => !UNNEEDED.includes(p.split(':')[2]));
    assert.deepEqual(keep(await privileges(db)), keep(before_));
  });

  it('changes no policy, column, function (or its EXECUTE grants), owner, RLS setting, trigger or row', async () => {
    assert.deepEqual(await catalog(db), catalogBefore);
    assert.deepEqual(await rowCounts(db), countsBefore);
  });

  it('tables created later by postgres do not get these privileges, from defaults or PUBLIC', async () => {
    await db.exec(`create table public.zz_future (id int primary key); grant select on public.zz_future to authenticated`);
    const p = (await privileges(db)).filter((x) => x.startsWith('zz_future:'));
    assert.deepEqual(p, ['zz_future:authenticated:SELECT']);
    await db.exec('drop table public.zz_future');
  });

  it('signed-in and anonymous callers really cannot truncate', async () => {
    for (const user of [ALICE, null]) {
      await as(db, user, async () => {
        await assert.rejects(db.query('truncate public.trips'), /permission denied/);
        await assert.rejects(db.query('truncate public.shared_expenses'), /permission denied/);
      });
    }
    assert.equal((await rowCounts(db)).trips, 1);
  });

  it('G1, G3 and shared trips keep working for signed-in users', async () => {
    await as(db, BOB, async () => {
      await db.query(`insert into public.trips (user_id, id, name, start_date, end_date, transport_mode, category, created_at, updated_at)
        values ($1, 't2', 'Goa', '2026-12-01', '2026-12-05', 'car', 'leisure', $2, $2)`, [BOB, NOW]);
      await db.query(`update public.trips set name = 'Goa trip' where id = 't2'`);
      assert.deepEqual((await db.query('select name from public.trips')).rows, [{ name: 'Goa trip' }]); // RLS: own rows only
      const pulled = (await db.query(`select public.sync_pull('0', 0, 100) as r`)).rows[0].r;
      assert.ok(pulled.rows.some((r) => r.pk === 't2'));
      assert.equal((await db.query('select count(*) n from public.sync_tables')).rows[0].n, 33);
      // G3 tables: same per-table grants as before (asserted above); a G3 row round-trips through RLS.
      assert.equal((await db.query(`select has_table_privilege('journal_entries', 'INSERT') and has_table_privilege('expenses', 'UPDATE') as ok`)).rows[0].ok, true);
      await db.query(`select public.accept_shared_trip_invite('tok', 'Ben')`);
      const trip = (await db.query('select id from public.shared_trips')).rows[0].id;
      await db.query(`insert into public.shared_expense_participants (trip_id, id, name, created_at, updated_at) values ($1, 'p1', 'Ben', $2, $2)`, [trip, NOW]);
      assert.equal((await db.query('select count(*) n from public.shared_expense_participants')).rows[0].n, 1);
    });
  });

  it('the rollback restores exactly the previous grants', async () => {
    const fresh = await deployed();
    const original = (await privileges(fresh)).filter((p) => !p.startsWith('trips:anon')); // PUBLIC grant is test-only
    await fresh.exec(readFileSync(HARDENING, 'utf8'));
    await fresh.exec(readFileSync(ROLLBACK, 'utf8'));
    assert.deepEqual((await privileges(fresh)).filter((p) => !p.startsWith('trips:anon')), original);
  });

  it('deploys last, after the shared-expenses migration', () => {
    const files = readdirSync(join(ROOT, 'migrations')).filter((f) => f.endsWith('.sql')).sort();
    assert.equal(files.at(-1), '20261115090000_revoke_table_maintenance_privileges.sql');
  });
});
