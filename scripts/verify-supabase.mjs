// Read-only verification of a deployed Trip Prep Supabase project.
//
// Builds the expected catalog by applying supabase/migrations to local Postgres
// (PGlite), reads the same catalog from the live project through the Supabase
// Management API (read-only SQL), and compares them exactly: tables, columns,
// RLS, policies (with definitions), indexes, triggers, functions (with security
// mode), privileges and migration history. Never writes to the project.
//
//   SUPABASE_ACCESS_TOKEN=... node scripts/verify-supabase.mjs <project-ref>
// (In the Claude Code cloud session the token is injected by the network proxy; run with
//  NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt so fetch uses it.)

import { PGlite } from '@electric-sql/pglite';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ref = process.argv[2];
if (!ref) {
  console.error('Usage: node scripts/verify-supabase.mjs <project-ref>');
  process.exit(2);
}
const token = process.env.SUPABASE_ACCESS_TOKEN ?? 'proxy-injected';
const dir = join(import.meta.dirname, '..', 'supabase', 'migrations');

const TABLES = `select coalesce(json_agg(t order by t->>'name'), '[]') from (
  select json_build_object('name', c.relname, 'rls', c.relrowsecurity, 'force', c.relforcerowsecurity,
    'columns', (select json_agg(json_build_object('name', a.attname, 'type', format_type(a.atttypid, a.atttypmod), 'not_null', a.attnotnull) order by a.attnum)
                from pg_attribute a where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped)) as t
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r') x`;
const QUERIES = {
  tables: TABLES,
  policies: `select coalesce(json_agg(json_build_object('table', tablename, 'name', policyname, 'cmd', cmd, 'roles', roles::text, 'using', qual, 'check', with_check) order by tablename, policyname), '[]') from pg_policies where schemaname = 'public'`,
  indexes: `select coalesce(json_agg(json_build_object('name', indexname, 'def', indexdef) order by indexname), '[]') from pg_indexes where schemaname = 'public'`,
  triggers: `select coalesce(json_agg(json_build_object('table', c.relname, 'name', t.tgname) order by c.relname, t.tgname), '[]') from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and not t.tgisinternal`,
  constraints: `select coalesce(json_agg(json_build_object('table', conrelid::regclass::text, 'name', conname, 'def', pg_get_constraintdef(oid)) order by conrelid::regclass::text, conname), '[]') from pg_constraint where connamespace = 'public'::regnamespace`,
  functions: `select coalesce(json_agg(json_build_object('name', p.proname, 'args', pg_get_function_identity_arguments(p.oid), 'security_definer', p.prosecdef, 'config', p.proconfig::text) order by p.proname), '[]') from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'`,
  privileges: `select coalesce(json_agg(x order by x->>'object'), '[]') from (
    select json_build_object('object', c.relname,
      'anon', json_build_array(has_table_privilege('anon', c.oid, 'select'), has_table_privilege('anon', c.oid, 'insert'), has_table_privilege('anon', c.oid, 'update'), has_table_privilege('anon', c.oid, 'delete')),
      'authenticated', json_build_array(has_table_privilege('authenticated', c.oid, 'select'), has_table_privilege('authenticated', c.oid, 'insert'), has_table_privilege('authenticated', c.oid, 'update'), has_table_privilege('authenticated', c.oid, 'delete'))) as x
    from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r', 'S')
    union all
    select json_build_object('object', p.proname || '()', 'anon', has_function_privilege('anon', p.oid, 'execute'), 'authenticated', has_function_privilege('authenticated', p.oid, 'execute'))
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public') y`,
  history: `select coalesce(json_agg(json_build_object('version', version, 'name', name) order by version), '[]') from supabase_migrations.schema_migrations`,
};

async function expected() {
  const db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated; grant usage on schema public to anon, authenticated;
    create schema supabase_migrations;
    create table supabase_migrations.schema_migrations (version text primary key, statements text[], name text);`);
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    await db.exec(readFileSync(join(dir, file), 'utf8'));
    const [version, ...rest] = file.replace(/\.sql$/, '').split('_');
    await db.query('insert into supabase_migrations.schema_migrations (version, name) values ($1, $2)', [version, rest.join('_')]);
  }
  const result = {};
  for (const [key, sql] of Object.entries(QUERIES)) result[key] = (await db.query(`select (${sql}) as v`)).rows[0].v;
  return result;
}

async function query(sql) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql, read_only: true }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`HTTP ${response.status} ${JSON.stringify(body)}`);
  return body;
}

async function live() {
  const result = {};
  const [{ history_exists: historyExists }] = await query(
    "select to_regclass('supabase_migrations.schema_migrations') is not null as history_exists",
  );
  for (const [key, sql] of Object.entries(QUERIES)) {
    if (key === 'history' && !historyExists) {
      result[key] = []; // no migrations recorded yet
      continue;
    }
    result[key] = (await query(`select (${sql}) as v`))[0].v;
  }
  return result;
}

const [want, have] = await Promise.all([expected(), live()]);
let failures = 0;
for (const key of Object.keys(QUERIES)) {
  const a = JSON.stringify(want[key]);
  const b = JSON.stringify(have[key]);
  if (a === b) {
    console.log(`✓ ${key}: ${Array.isArray(want[key]) ? want[key].length : ''} match`);
  } else {
    failures += 1;
    const wantItems = new Set((want[key] ?? []).map((x) => JSON.stringify(x)));
    const haveItems = new Set((have[key] ?? []).map((x) => JSON.stringify(x)));
    console.log(`✗ ${key} differs`);
    for (const x of wantItems) if (!haveItems.has(x)) console.log(`   missing:    ${x.slice(0, 300)}`);
    for (const x of haveItems) if (!wantItems.has(x)) console.log(`   unexpected: ${x.slice(0, 300)}`);
  }
}
console.log(failures === 0 ? '\nDeployed schema matches the migrations exactly.' : `\n${failures} section(s) differ.`);
process.exit(failures === 0 ? 0 : 1);
