import { isSharingError, type SharingApi } from './sharingApi';
import type { SharingRepository } from './sharingRepository';

/**
 * Keeps one shared trip in step with the cloud.
 *
 * 1. Membership: refreshes members and this user's role. Removed → the trip is
 *    marked removed on this device (everything already on the device stays).
 * 2. Push (owners and editors): each queued entry is read again. Shared →
 *    its text is uploaded; private or deleted → its shared copy is withdrawn.
 *    Private entries are never sent. Photos stay in the author's own Drive.
 * 3. Pull: other members' shared entries since the last cursor, cached for
 *    offline reading (withdrawn ones are removed).
 *
 * Offline or server errors leave the queue in place and are retried later.
 */

export const SHARED_RETRY_MIN = [1, 2, 5, 15, 30] as const;

export interface SharedSyncResult {
  pushed: number;
  withdrawn: number;
  pulled: number;
  removed: boolean;
  error: string | null;
}

export async function syncSharedTrip(
  tripId: string,
  deps: { api: SharingApi; repo: SharingRepository; accountId: string; now?: () => Date },
): Promise<SharedSyncResult> {
  const now = deps.now ?? (() => new Date());
  const result: SharedSyncResult = { pushed: 0, withdrawn: 0, pulled: 0, removed: false, error: null };
  const space = await deps.repo.space(tripId);
  if (!space || space.accountId !== deps.accountId || space.role === 'removed') return result;
  const cloud = space.cloudTripId;

  try {
    // 1. Membership and role.
    const members = await deps.api.members(cloud);
    const me = members.find((m) => m.userId === deps.accountId);
    if (!me) {
      await deps.repo.setRole(tripId, 'removed');
      await deps.repo.setError(tripId, null);
      result.removed = true;
      return result;
    }
    await deps.repo.saveMembers(cloud, members);
    if (me.role !== space.role) await deps.repo.setRole(tripId, me.role);

    // 2. Push queued entries (owners and editors only).
    if (me.role === 'owner' || me.role === 'editor') {
      for (const item of await deps.repo.dueOutbox(tripId, now())) {
        const entry = await deps.repo.entryForPush(item.entryId);
        const at = now().toISOString();
        try {
          if (entry && entry.visibility === 'shared') {
            await deps.api.upsertEntry({
              trip_id: cloud,
              id: entry.id,
              author_name: me.displayName,
              entry_date: entry.entryDate,
              title: entry.title,
              body: entry.body,
              mood: entry.mood,
              place_name: entry.placeName,
              created_at: entry.createdAt,
              updated_at: at,
              deleted_at: null,
            });
            result.pushed += 1;
          } else {
            await deps.api.withdrawEntry(cloud, item.entryId, at);
            result.withdrawn += 1;
          }
          await deps.repo.doneOutbox(tripId, item.entryId, item.queuedAt);
        } catch (error) {
          if (isSharingError(error) && error.kind === 'stale') {
            // A newer copy from another of this user's devices is already shared.
            await deps.repo.doneOutbox(tripId, item.entryId, item.queuedAt);
            continue;
          }
          const message = error instanceof Error ? error.message : 'Upload failed.';
          const minutes = SHARED_RETRY_MIN[Math.min(item.attempts, SHARED_RETRY_MIN.length - 1)] as number;
          await deps.repo.retryOutbox(tripId, item.entryId, message, new Date(now().getTime() + minutes * 60_000));
          throw error;
        }
      }
    }

    // 3. Pull other members' shared entries.
    let cursor = space.cursor;
    for (;;) {
      const page = await deps.api.pull(cloud, cursor);
      for (const row of page.rows) {
        if (row.table !== 'shared_journal_entries') continue;
        const data = row.data as Record<string, string | null>;
        if (data.author_id === deps.accountId) continue; // own entries live in the local journal
        if (row.deleted) {
          await deps.repo.deleteSharedEntry(cloud, row.pk);
        } else {
          await deps.repo.saveSharedEntry({
            cloudTripId: cloud,
            id: row.pk,
            authorId: String(data.author_id ?? ''),
            authorName: String(data.author_name ?? ''),
            entryDate: String(data.entry_date ?? ''),
            title: String(data.title ?? ''),
            body: String(data.body ?? ''),
            mood: data.mood ?? null,
            placeName: String(data.place_name ?? ''),
            updatedAt: String(data.updated_at ?? ''),
          });
        }
        result.pulled += 1;
      }
      cursor = page.cursor;
      if (!page.hasMore) break;
    }
    await deps.repo.setSynced(tripId, cursor, now().toISOString());
  } catch (error) {
    if (isSharingError(error) && error.kind === 'permission' && /not a member/i.test(error.message)) {
      await deps.repo.setRole(tripId, 'removed');
      result.removed = true;
      return result;
    }
    result.error = error instanceof Error ? error.message : 'Sharing failed.';
    await deps.repo.setError(tripId, result.error);
  }
  return result;
}
