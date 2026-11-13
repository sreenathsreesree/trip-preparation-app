import type { Database } from '@/db/types';

/**
 * The shared trip's group workspace on this device (Group Trip). Items are
 * cached for offline use; local edits are marked `pending` and sent by the
 * shared-trip sync. Only what the user put in the Group Trip is here —
 * personal packing, checklist, documents, notes, memories and expenses live in
 * their own tables and are never read by this repository.
 */
export type GroupKind = 'place' | 'checklist' | 'document' | 'note' | 'readiness';

export interface GroupItem<T = Record<string, unknown>> {
  tripId: string;
  id: string;
  kind: GroupKind;
  data: T;
  authorId: string;
  authorName: string;
  createdAt: string;
  updatedAt: string;
  deleted: boolean;
  pending: boolean;
  /** The other member's version when both changed this item; shown until the user chooses. */
  conflict: { data: Record<string, unknown>; authorName: string; updatedAt: string; deleted: boolean } | null;
  lastError: string | null;
  /** The group copy's version this device last saw (sent as the base of the next change). */
  baseUpdatedAt: string | null;
}

interface Row {
  trip_id: string;
  id: string;
  kind: GroupKind;
  data: string;
  author_id: string;
  author_name: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  pending: number;
  remote_updated_at: string | null;
  conflict: string | null;
  last_error: string | null;
}

const parse = <T>(s: string | null, fallback: T): T => {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
};

const toItem = (r: Row): GroupItem => ({
  tripId: r.trip_id,
  id: r.id,
  kind: r.kind,
  data: parse(r.data, {}),
  authorId: r.author_id,
  authorName: r.author_name,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  deleted: r.deleted_at !== null,
  pending: r.pending === 1,
  conflict: parse(r.conflict, null),
  lastError: r.last_error,
  baseUpdatedAt: r.remote_updated_at,
});

const sameData = (a: string, b: string) => {
  try {
    return JSON.stringify(JSON.parse(a)) === JSON.stringify(JSON.parse(b));
  } catch {
    return a === b;
  }
};

export interface RemoteItem {
  id: string;
  kind: GroupKind;
  data: Record<string, unknown>;
  authorId: string;
  authorName: string;
  createdAt: string;
  updatedAt: string;
  deleted: boolean;
}

export function createGroupRepository(db: Database, deps: { createId: () => string; now?: () => Date }) {
  const now = () => (deps.now ?? (() => new Date()))();
  /**
   * A write time later than anything seen from the cloud and than this
   * device's previous edit of the item, so neither a slow clock nor a quick
   * second edit makes a change "older" than one already sent.
   */
  const stamp = (...seen: (string | null | undefined)[]) => {
    const floor = Math.max(0, ...seen.filter((s): s is string => !!s).map((s) => Date.parse(s) + 1));
    return new Date(Math.max(now().getTime(), floor)).toISOString();
  };
  const get = async (tripId: string, id: string) => db.getFirstAsync<Row>('SELECT * FROM group_items WHERE trip_id = ? AND id = ?', [tripId, id]);

  return {
    async list(tripId: string, kind?: GroupKind, options: { includeDeleted?: boolean } = {}): Promise<GroupItem[]> {
      const rows = await db.getAllAsync<Row>(
        `SELECT * FROM group_items WHERE trip_id = ?${kind ? ' AND kind = ?' : ''}${options.includeDeleted ? '' : ' AND deleted_at IS NULL'} ORDER BY created_at, id`,
        kind ? [tripId, kind] : [tripId],
      );
      return rows.map(toItem);
    },

    async get(tripId: string, id: string): Promise<GroupItem | null> {
      const r = await get(tripId, id);
      return r ? toItem(r) : null;
    },

    /** Adds or changes an item on this device and queues it for the group. */
    async save(tripId: string, input: { id?: string; kind: GroupKind; data: Record<string, unknown> }, me: { id: string; name?: string; displayName?: string }): Promise<GroupItem> {
      const id = input.id ?? deps.createId();
      const existing = await get(tripId, id);
      if (existing && existing.kind !== input.kind) throw new Error('An item cannot change its kind.');
      const at = stamp(existing?.remote_updated_at, existing?.updated_at);
      if (existing) {
        await db.runAsync('UPDATE group_items SET data = ?, updated_at = ?, deleted_at = NULL, pending = 1, last_error = NULL WHERE trip_id = ? AND id = ?', [JSON.stringify(input.data), at, tripId, id]);
      } else {
        await db.runAsync(
          'INSERT INTO group_items (trip_id, id, kind, data, author_id, author_name, created_at, updated_at, pending) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)',
          [tripId, id, input.kind, JSON.stringify(input.data), me.id, me.displayName ?? me.name ?? '', at, at],
        );
      }
      return toItem((await get(tripId, id)) as Row);
    },

    /** Removes an item for the whole group (a tombstone, sent like any change). */
    async remove(tripId: string, id: string): Promise<void> {
      const existing = await get(tripId, id);
      if (!existing) return;
      const at = stamp(existing.remote_updated_at, existing.updated_at);
      await db.runAsync('UPDATE group_items SET deleted_at = ?, updated_at = ?, pending = 1 WHERE trip_id = ? AND id = ?', [at, at, tripId, id]);
    },

    async pending(tripId: string): Promise<GroupItem[]> {
      return (await db.getAllAsync<Row>('SELECT * FROM group_items WHERE trip_id = ? AND pending = 1 AND conflict IS NULL ORDER BY updated_at', [tripId])).map(toItem);
    },

    /**
     * The group now holds the version sent (`updatedAt`): that becomes the base
     * of the next change. If the user edited the item again while it was being
     * sent, the newer edit stays queued (pending) on top of this base — it is
     * not mistaken for someone else's change.
     */
    async markSent(tripId: string, id: string, updatedAt: string): Promise<void> {
      await db.runAsync(
        `UPDATE group_items SET remote_updated_at = ?, last_error = NULL, pending = CASE WHEN updated_at = ? THEN 0 ELSE 1 END
         WHERE trip_id = ? AND id = ? AND (remote_updated_at IS NULL OR remote_updated_at < ?)`,
        [updatedAt, updatedAt, tripId, id, updatedAt],
      );
    },

    async markFailed(tripId: string, id: string, error: string): Promise<void> {
      await db.runAsync('UPDATE group_items SET last_error = ? WHERE trip_id = ? AND id = ?', [error.slice(0, 300), tripId, id]);
    },

    /**
     * A version from the cloud. Not changed here → take it. Changed here and
     * also changed there (not just our own echo) → keep ours and record theirs
     * as a conflict for the user. Older than what we have → ignored.
     */
    async applyRemote(tripId: string, remote: RemoteItem): Promise<'applied' | 'conflict' | 'ignored'> {
      const local = await get(tripId, remote.id);
      const data = JSON.stringify(remote.data);
      const deletedAt = remote.deleted ? remote.updatedAt : null;
      if (!local) {
        await db.runAsync(
          'INSERT INTO group_items (trip_id, id, kind, data, author_id, author_name, created_at, updated_at, deleted_at, pending, remote_updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)',
          [tripId, remote.id, remote.kind, data, remote.authorId, remote.authorName, remote.createdAt, remote.updatedAt, deletedAt, remote.updatedAt],
        );
        return 'applied';
      }
      if (local.remote_updated_at && Date.parse(remote.updatedAt) <= Date.parse(local.remote_updated_at)) return 'ignored';
      if (local.pending === 1) {
        const echo = sameData(local.data, data) && (local.deleted_at !== null) === remote.deleted;
        if (echo) {
          await db.runAsync('UPDATE group_items SET pending = 0, remote_updated_at = ? WHERE trip_id = ? AND id = ?', [remote.updatedAt, tripId, remote.id]);
          return 'applied';
        }
        await db.runAsync('UPDATE group_items SET conflict = ?, remote_updated_at = ? WHERE trip_id = ? AND id = ?', [
          JSON.stringify({ data: remote.data, authorName: remote.authorName, updatedAt: remote.updatedAt, deleted: remote.deleted }),
          remote.updatedAt,
          tripId,
          remote.id,
        ]);
        return 'conflict';
      }
      await db.runAsync('UPDATE group_items SET data = ?, author_name = ?, updated_at = ?, deleted_at = ?, remote_updated_at = ?, conflict = NULL WHERE trip_id = ? AND id = ?', [
        data,
        remote.authorName,
        remote.updatedAt,
        deletedAt,
        remote.updatedAt,
        tripId,
        remote.id,
      ]);
      return 'applied';
    },

    /** The user's choice for a conflict: keep this device's version (sent again, newer) or take the group's. */
    async resolve(tripId: string, id: string, choice: 'mine' | 'theirs'): Promise<void> {
      const local = await get(tripId, id);
      if (!local?.conflict) return;
      const theirs = parse<{ data: Record<string, unknown>; authorName: string; updatedAt: string; deleted: boolean }>(local.conflict, { data: {}, authorName: '', updatedAt: '', deleted: false });
      if (choice === 'theirs') {
        await db.runAsync('UPDATE group_items SET data = ?, author_name = ?, updated_at = ?, deleted_at = ?, pending = 0, conflict = NULL WHERE trip_id = ? AND id = ?', [
          JSON.stringify(theirs.data),
          theirs.authorName,
          theirs.updatedAt,
          theirs.deleted ? theirs.updatedAt : null,
          tripId,
          id,
        ]);
      } else {
        await db.runAsync('UPDATE group_items SET updated_at = ?, pending = 1, conflict = NULL WHERE trip_id = ? AND id = ?', [stamp(theirs.updatedAt), tripId, id]);
      }
    },

    /** After leaving or being removed: the cached group workspace goes; the user's own trip stays. */
    async clear(tripId: string): Promise<void> {
      await db.runAsync('DELETE FROM group_items WHERE trip_id = ?', [tripId]);
    },
  };
}

export type GroupRepository = ReturnType<typeof createGroupRepository>;
