import type { ExpenseRepository } from '../expenses/expenseRepository';
import { applyExpenseRow, ensureMyParticipant, isExpenseTable, pushExpenses } from '../expenses/expenseSync';
import type { GroupRepository } from '../group/groupRepository';
import { isSharingError, type GroupItemRow, type SharingApi } from './sharingApi';
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
  /** Group expense records sent (participants, expenses, settlements, budgets). */
  expensesSent: number;
  removed: boolean;
  error: string | null;
  /** Group Trip items sent and received. */
  groupSent: number;
  groupPulled: number;
  /** Both sides changed the same group item: kept for the user to choose. */
  groupConflicts: number;
  /** The cloud does not have the group workspace yet (migration pending): items wait on the device. */
  groupNotReady: boolean;
}

export async function syncSharedTrip(
  tripId: string,
  deps: { api: SharingApi; repo: SharingRepository; accountId: string; now?: () => Date; expenses?: ExpenseRepository; group?: GroupRepository },
): Promise<SharedSyncResult> {
  const now = deps.now ?? (() => new Date());
  const result: SharedSyncResult = { pushed: 0, withdrawn: 0, pulled: 0, expensesSent: 0, removed: false, error: null, groupSent: 0, groupPulled: 0, groupConflicts: 0, groupNotReady: false };
  const space = await deps.repo.space(tripId);
  if (!space || space.accountId !== deps.accountId || space.role === 'removed') return result;
  const cloud = space.cloudTripId;

  try {
    // 1. Membership and role.
    const members = await deps.api.members(cloud);
    const me = members.find((m) => m.userId === deps.accountId);
    if (!me) {
      await deps.repo.setRole(tripId, 'removed');
      // A removed member keeps their own trip but no longer the group's workspace.
      await deps.group?.clear(tripId);
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

    // 2b. Group expenses, settlements, participants and budget (owners and editors).
    if (deps.expenses && (me.role === 'owner' || me.role === 'editor')) {
      const sent = await pushExpenses(tripId, cloud, { api: deps.api, repo: deps.expenses, accountId: deps.accountId, now });
      result.expensesSent = sent.sent + sent.withdrawn;
    }

    // 2c. Group Trip workspace: owners and editors send their changes; every member sends only their own readiness flag.
    if (deps.group) {
      for (const item of await deps.group.pending(tripId)) {
        const allowed = item.kind === 'readiness' ? item.id === deps.accountId : me.role === 'owner' || me.role === 'editor';
        if (!allowed) {
          await deps.group.markFailed(tripId, item.id, 'Only the owner and editors can change the Group Trip.');
          continue;
        }
        try {
          await deps.api.upsertGroupItem({
            trip_id: cloud,
            id: item.id,
            kind: item.kind,
            data: item.data,
            author_name: me.displayName,
            created_at: item.createdAt,
            updated_at: item.updatedAt,
            deleted_at: item.deleted ? item.updatedAt : null,
            base_updated_at: item.baseUpdatedAt,
          });
          await deps.group.markSent(tripId, item.id, item.updatedAt);
          result.groupSent += 1;
        } catch (error) {
          if (isSharingError(error) && error.kind === 'server_not_ready') {
            result.groupNotReady = true;
            break;
          }
          // A newer copy exists in the group: the pull below turns it into a conflict for the user.
          if (isSharingError(error) && error.kind === 'stale') continue;
          await deps.group.markFailed(tripId, item.id, error instanceof Error ? error.message : 'Could not send.');
          if (isSharingError(error) && error.kind === 'network') throw error;
        }
      }
    }

    // 3. Pull other members' shared entries and group expense records.
    let cursor = space.cursor;
    for (;;) {
      const page = await deps.api.pull(cloud, cursor);
      for (const row of page.rows) {
        if (isExpenseTable(row.table)) {
          if (deps.expenses) await applyExpenseRow(tripId, row, { repo: deps.expenses, accountId: deps.accountId });
          result.pulled += 1;
          continue;
        }
        if (row.table === 'shared_trip_items') {
          if (deps.group) {
            const d = row.data as Record<string, unknown>;
            const outcome = await deps.group.applyRemote(tripId, {
              id: row.pk,
              kind: d.kind as GroupItemRow['kind'],
              data: (d.data ?? {}) as Record<string, unknown>,
              authorId: String(d.created_by ?? ''),
              authorName: String(d.author_name ?? ''),
              createdAt: String(d.created_at ?? ''),
              updatedAt: String(d.updated_at ?? ''),
              deleted: row.deleted,
            });
            if (outcome === 'conflict') result.groupConflicts += 1;
            result.groupPulled += 1;
          }
          continue;
        }
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
    if (deps.expenses) {
      await ensureMyParticipant(tripId, me.displayName, { repo: deps.expenses, accountId: deps.accountId, canWrite: me.role === 'owner' || me.role === 'editor' });
    }
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
