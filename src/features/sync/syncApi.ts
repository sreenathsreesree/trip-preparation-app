import type { SupabaseClient } from '@supabase/supabase-js';

import type { PullRow, PushChange, PushResult, SyncApi } from './syncEngine';

/** The G1 sync protocol over supabase-js (Row Level Security applies to every call). */
export function createSupabaseSyncApi(client: SupabaseClient): SyncApi {
  const fail = (error: { message?: string } | null) => new Error(error?.message || 'The Trip Prep cloud could not be reached.');
  return {
    async tables() {
      const { data, error } = await client.from('sync_tables').select('name');
      if (error) throw fail(error);
      return ((data ?? []) as { name: string }[]).map((r) => r.name);
    },
    async push(changes: PushChange[]) {
      const { data, error } = await client.rpc('sync_push', { p_changes: changes });
      if (error) throw fail(error);
      return ((data as { results?: PushResult[] } | null)?.results ?? []) as PushResult[];
    },
    async pull(cursor, limit) {
      const { data, error } = await client.rpc('sync_pull', { p_after_txid: cursor.txid, p_after_revision: cursor.revision, p_limit: limit });
      if (error) throw fail(error);
      const r = data as { rows: PullRow[]; has_more: boolean; cursor: { txid: string; revision: number } };
      return { rows: r.rows.map((row) => ({ ...row, revision: Number(row.revision) })), has_more: r.has_more, cursor: { txid: String(r.cursor.txid), revision: Number(r.cursor.revision) } };
    },
  };
}
