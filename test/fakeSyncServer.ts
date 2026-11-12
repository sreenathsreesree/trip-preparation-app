import type { CloudRow } from '@/features/sync/adapters';
import type { PullRow, PushChange, PushResult, SyncApi } from '@/features/sync/syncEngine';
import { PENDING_SYNC_TABLES, SYNC_TABLES } from '@/features/sync/tables';

/**
 * In-memory stand-in for the G1 sync protocol (sync_push / sync_pull), with the
 * same rules as supabase/migrations/…_sync_functions.sql — which is tested on
 * real Postgres in supabase/tests. Rows are partitioned by user.
 */
export function fakeSyncServer(options: { g3?: boolean } = {}) {
  let revision = 0;
  const tables = [...SYNC_TABLES, ...(options.g3 === false ? [] : PENDING_SYNC_TABLES)];
  const pkOf = new Map(tables.map((t) => [t.name, t.pk]));
  const rows = new Map<string, { user: string; table: string; pk: string; data: CloudRow; revision: number; deleted: boolean }>();
  let failAfterBatches: number | null = null;
  let pushes = 0;
  let offline = false;

  const key = (user: string, table: string, pk: string) => `${user}/${table}/${pk}`;
  const contains = (a: CloudRow, b: CloudRow) => Object.entries(b).every(([k, v]) => (a[k] ?? null) === (v ?? null));
  const devicePath = (v: unknown) => typeof v === 'string' && (v.startsWith('file:') || v.startsWith('data:') || v.includes('"file:') || v.includes('"data:'));

  function reject(user: string, c: PushChange): string | null {
    const d = c.data;
    for (const col of ['image_uri', 'cover_image_uri', 'photos']) if (devicePath(d[col])) return 'device path';
    if (c.table === 'inventory_categories' && d.system_key) {
      for (const r of rows.values()) if (r.user === user && r.table === c.table && !r.deleted && r.pk !== c.pk && r.data.system_key === d.system_key) return 'duplicate system_key';
    }
    if (c.table === 'places' && d.provider_place_id) {
      for (const r of rows.values())
        if (r.user === user && r.table === c.table && !r.deleted && r.pk !== c.pk && r.data.provider === d.provider && r.data.provider_place_id === d.provider_place_id) return 'duplicate place';
    }
    return null;
  }

  function apiFor(user: string): SyncApi {
    return {
      async tables() {
        if (offline) throw new TypeError('Network request failed');
        return tables.map((t) => t.name);
      },
      async push(changes) {
        if (offline) throw new TypeError('Network request failed');
        pushes += 1;
        if (failAfterBatches !== null && pushes > failAfterBatches) throw new TypeError('Network request failed');
        return changes.map((c): PushResult => {
          if (!pkOf.has(c.table)) return { table: c.table, pk: c.pk, status: 'rejected', reason: 'invalid_change' };
          const k = key(user, c.table, c.pk);
          const current = rows.get(k);
          if (c.op === 'delete') {
            if (!current || current.deleted) return { table: c.table, pk: c.pk, status: 'applied', revision: current?.revision ?? null };
            if (c.base_revision !== current.revision) return { table: c.table, pk: c.pk, status: 'conflict', revision: current.revision, server_row: current.data };
            rows.set(k, { ...current, deleted: true, revision: ++revision });
            return { table: c.table, pk: c.pk, status: 'applied', revision };
          }
          if (current && c.base_revision !== current.revision) {
            if (!current.deleted && contains(current.data, c.data)) return { table: c.table, pk: c.pk, status: 'applied', revision: current.revision };
            return { table: c.table, pk: c.pk, status: 'conflict', revision: current.revision, server_row: current.data };
          }
          if (!current && c.base_revision !== null) return { table: c.table, pk: c.pk, status: 'conflict', revision: null };
          const why = reject(user, c);
          if (why) return { table: c.table, pk: c.pk, status: 'rejected', reason: why };
          rows.set(k, { user, table: c.table, pk: c.pk, data: { ...c.data }, revision: ++revision, deleted: false });
          return { table: c.table, pk: c.pk, status: 'applied', revision };
        });
      },
      async pull(cursor, limit) {
        if (offline) throw new TypeError('Network request failed');
        const mine = [...rows.values()].filter((r) => r.user === user && r.revision > cursor.revision).sort((a, b) => a.revision - b.revision);
        const page = mine.slice(0, limit);
        const last = page[page.length - 1];
        return {
          rows: page.map((r): PullRow => ({ table: r.table, pk: r.pk, revision: r.revision, deleted: r.deleted, data: { ...r.data } })),
          has_more: mine.length > limit,
          cursor: last ? { txid: '1', revision: last.revision } : cursor,
        };
      },
    };
  }

  return {
    apiFor,
    rows,
    count: (user: string, table: string) => [...rows.values()].filter((r) => r.user === user && r.table === table && !r.deleted).length,
    failPushesAfter: (n: number | null) => {
      failAfterBatches = n;
      pushes = 0;
    },
    setOffline: (v: boolean) => {
      offline = v;
    },
  };
}
