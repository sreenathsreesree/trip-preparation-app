import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Client for the shared-trip cloud functions and tables
 * (supabase/pending/20261113090000_shared_trips.sql). Every permission is
 * enforced by the database; this module only calls it and turns failures into
 * clear messages.
 */

export type SharedRole = 'owner' | 'editor' | 'viewer';
export const isSharedRole = (v: unknown): v is SharedRole => v === 'owner' || v === 'editor' || v === 'viewer';

export type SharingErrorKind = 'not_configured' | 'signed_out' | 'server_not_ready' | 'permission' | 'not_found' | 'invalid' | 'stale' | 'network' | 'unknown';

export class SharingError extends Error {
  constructor(
    readonly kind: SharingErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'SharingError';
  }
}
export const isSharingError = (e: unknown): e is SharingError => e instanceof SharingError;

export interface SharedMember {
  userId: string;
  role: SharedRole;
  displayName: string;
}

export interface SharedInvite {
  id: string;
  role: 'editor' | 'viewer';
  expiresAt: string;
  uses: number;
  maxUses: number;
  revokedAt: string | null;
}

export interface SharedEntryRow {
  trip_id: string;
  id: string;
  author_id?: string;
  author_name: string;
  entry_date: string;
  title: string;
  body: string;
  mood: string | null;
  place_name: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface PullPage {
  rows: { table: string; pk: string; deleted: boolean; data: Record<string, unknown> }[];
  hasMore: boolean;
  cursor: { txid: string; revision: number };
}

export interface SharingApi {
  createTrip(input: { name: string; startDate: string; endDate: string; displayName: string }): Promise<string>;
  createInvite(tripId: string, tokenHash: string, role: 'editor' | 'viewer', validHours?: number): Promise<string>;
  acceptInvite(token: string, displayName: string): Promise<{ tripId: string; name: string; startDate: string; endDate: string; role: SharedRole }>;
  revokeInvite(inviteId: string): Promise<void>;
  members(tripId: string): Promise<SharedMember[]>;
  invites(tripId: string): Promise<SharedInvite[]>;
  setRole(tripId: string, userId: string, role: 'editor' | 'viewer'): Promise<void>;
  removeMember(tripId: string, userId: string): Promise<void>;
  leave(tripId: string): Promise<void>;
  transfer(tripId: string, userId: string): Promise<void>;
  deleteTrip(tripId: string): Promise<void>;
  /** Insert or update the caller's own shared entry (the server stamps the author). */
  upsertEntry(row: SharedEntryRow): Promise<void>;
  /** Withdraws the caller's shared entry (tombstone). No-op if it was never shared. */
  withdrawEntry(tripId: string, entryId: string, at: string): Promise<void>;
  pull(tripId: string, cursor: { txid: string; revision: number }): Promise<PullPage>;
}

interface PgError {
  code?: string;
  message?: string;
}

/** Maps a PostgREST / Postgres error to a SharingError with a readable message. */
export function toSharingError(error: unknown): SharingError {
  if (error instanceof SharingError) return error;
  const e = (error ?? {}) as PgError;
  const message = typeof e.message === 'string' ? e.message : '';
  if (/fetch|network|Failed to fetch|Network request failed/i.test(message) || error instanceof TypeError) {
    return new SharingError('network', 'Couldn’t reach Trip Prep’s sharing service. Check your connection; changes wait on this device.');
  }
  switch (e.code) {
    case 'PGRST202':
    case '42883':
    case '42P01':
    case 'PGRST205':
      return new SharingError('server_not_ready', 'Trip sharing isn’t switched on in the Trip Prep cloud yet.');
    case '42501':
      return new SharingError('permission', message || 'You don’t have permission to do that.');
    case 'P0002':
      return new SharingError('not_found', message || 'Not found.');
    case '22023':
    case '23514':
      return new SharingError('invalid', message || 'That isn’t valid.');
    case '40001':
      return new SharingError('stale', message || 'A newer version is already shared.');
    default:
      return new SharingError('unknown', message || 'Sharing failed. Try again later.');
  }
}

export function createSupabaseSharingApi(client: SupabaseClient): SharingApi {
  async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
    let result: { data: unknown; error: unknown };
    try {
      result = await client.rpc(fn, args);
    } catch (error) {
      throw toSharingError(error);
    }
    if (result.error) throw toSharingError(result.error);
    return result.data as T;
  }
  async function query<T>(run: () => PromiseLike<{ data: unknown; error: unknown }>): Promise<T> {
    let result: { data: unknown; error: unknown };
    try {
      result = await run();
    } catch (error) {
      throw toSharingError(error);
    }
    if (result.error) throw toSharingError(result.error);
    return result.data as T;
  }

  return {
    createTrip: ({ name, startDate, endDate, displayName }) =>
      rpc<string>('create_shared_trip', { p_name: name, p_start: startDate, p_end: endDate, p_display_name: displayName }),
    createInvite: (tripId, tokenHash, role, validHours = 168) =>
      rpc<string>('create_shared_trip_invite', { p_trip: tripId, p_token_hash: tokenHash, p_role: role, p_valid_hours: validHours, p_max_uses: 10 }),
    async acceptInvite(token, displayName) {
      const r = await rpc<{ trip_id: string; name: string; start_date: string; end_date: string; role: SharedRole }>('accept_shared_trip_invite', {
        p_token: token,
        p_display_name: displayName,
      });
      return { tripId: r.trip_id, name: r.name, startDate: r.start_date, endDate: r.end_date, role: r.role };
    },
    revokeInvite: (inviteId) => rpc('revoke_shared_trip_invite', { p_invite: inviteId }),
    async members(tripId) {
      const rows = await query<{ user_id: string; role: string; display_name: string }[]>(() =>
        client.from('shared_trip_members').select('user_id, role, display_name').eq('trip_id', tripId),
      );
      return rows.filter((r) => isSharedRole(r.role)).map((r) => ({ userId: r.user_id, role: r.role as SharedRole, displayName: r.display_name }));
    },
    async invites(tripId) {
      const rows = await query<{ id: string; role: 'editor' | 'viewer'; expires_at: string; uses: number; max_uses: number; revoked_at: string | null }[]>(() =>
        client.from('shared_trip_invites').select('id, role, expires_at, uses, max_uses, revoked_at').eq('trip_id', tripId).order('created_at', { ascending: false }),
      );
      return rows.map((r) => ({ id: r.id, role: r.role, expiresAt: r.expires_at, uses: r.uses, maxUses: r.max_uses, revokedAt: r.revoked_at }));
    },
    setRole: (tripId, userId, role) => rpc('set_shared_trip_member_role', { p_trip: tripId, p_user: userId, p_role: role }),
    removeMember: (tripId, userId) => rpc('remove_shared_trip_member', { p_trip: tripId, p_user: userId }),
    leave: (tripId) => rpc('leave_shared_trip', { p_trip: tripId }),
    transfer: (tripId, userId) => rpc('transfer_shared_trip', { p_trip: tripId, p_new_owner: userId }),
    deleteTrip: (tripId) => rpc('delete_shared_trip', { p_trip: tripId }),
    async upsertEntry(row) {
      const { author_id: _ignored, ...data } = row;
      await query(() => client.from('shared_journal_entries').upsert(data, { onConflict: 'trip_id,id' }));
    },
    async withdrawEntry(tripId, entryId, at) {
      await query(() =>
        client.from('shared_journal_entries').update({ deleted_at: at, updated_at: at }).eq('trip_id', tripId).eq('id', entryId).is('deleted_at', null),
      );
    },
    async pull(tripId, cursor) {
      const r = await rpc<{ rows: PullPage['rows']; has_more: boolean; cursor: { txid: string; revision: number } }>('shared_pull', {
        p_trip: tripId,
        p_after_txid: cursor.txid,
        p_after_revision: cursor.revision,
        p_limit: 500,
      });
      return { rows: r.rows, hasMore: r.has_more, cursor: { txid: String(r.cursor.txid), revision: Number(r.cursor.revision) } };
    },
  };
}
