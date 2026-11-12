import { createHash } from 'node:crypto';

import { SharingError, type SharedMember, type SharedRole, type SharingApi } from '@/features/sharing/sharingApi';

/**
 * In-memory stand-in for the shared-trip cloud, following the same rules as
 * supabase/pending/20261113090000_shared_trips.sql (which is tested against
 * real Postgres in supabase/tests/sharing.test.mjs).
 */
export function fakeSharingServer() {
  let seq = 0;
  let revision = 0;
  const trips = new Map<string, { name: string; start: string; end: string; members: Map<string, { role: SharedRole; name: string }> }>();
  const invites = new Map<string, { id: string; tripId: string; role: 'editor' | 'viewer'; uses: number; revoked: boolean }>();
  const entries = new Map<string, Record<string, unknown> & { trip_id: string; id: string; author_id: string; revision: number; deleted_at: string | null }>();
  let offline = false;

  const deny = (message: string) => new SharingError('permission', message);
  const roleOf = (tripId: string, user: string) => trips.get(tripId)?.members.get(user)?.role ?? null;
  const member = (tripId: string, user: string) => {
    if (!roleOf(tripId, user)) throw deny('Not a member of this trip');
  };
  const owner = (tripId: string, user: string) => {
    if (roleOf(tripId, user) !== 'owner') throw deny('Only the trip owner can do that');
  };
  const sha = (t: string) => createHash('sha256').update(t).digest('hex');

  function apiFor(user: string): SharingApi {
    const online = async () => {
      if (offline) throw new SharingError('network', 'offline');
    };
    return {
      async createTrip({ name, startDate, endDate, displayName }) {
        await online();
        const id = `cloud-${++seq}`;
        trips.set(id, { name, start: startDate, end: endDate, members: new Map([[user, { role: 'owner', name: displayName }]]) });
        return id;
      },
      async createInvite(tripId, tokenHash, role) {
        await online();
        owner(tripId, user);
        const id = `inv-${++seq}`;
        invites.set(tokenHash, { id, tripId, role, uses: 0, revoked: false });
        return id;
      },
      async acceptInvite(token, displayName) {
        await online();
        const invite = invites.get(sha(token));
        if (!invite) throw new SharingError('not_found', 'This invitation link is not valid');
        const trip = trips.get(invite.tripId)!;
        let role = trip.members.get(user)?.role;
        if (!role) {
          if (invite.revoked) throw deny('This invitation was cancelled');
          trip.members.set(user, { role: invite.role, name: displayName });
          invite.uses += 1;
          role = invite.role;
        }
        return { tripId: invite.tripId, name: trip.name, startDate: trip.start, endDate: trip.end, role };
      },
      async revokeInvite(id) {
        await online();
        const invite = [...invites.values()].find((i) => i.id === id)!;
        owner(invite.tripId, user);
        invite.revoked = true;
      },
      async members(tripId) {
        await online();
        if (!roleOf(tripId, user)) return [];
        return [...trips.get(tripId)!.members.entries()].map(([userId, m]): SharedMember => ({ userId, role: m.role, displayName: m.name }));
      },
      async invites(tripId) {
        await online();
        owner(tripId, user);
        return [...invites.values()].filter((i) => i.tripId === tripId).map((i) => ({ id: i.id, role: i.role, expiresAt: '', uses: i.uses, maxUses: 10, revokedAt: i.revoked ? 'x' : null }));
      },
      async setRole(tripId, target, role) {
        await online();
        owner(tripId, user);
        trips.get(tripId)!.members.get(target)!.role = role;
      },
      async removeMember(tripId, target) {
        await online();
        owner(tripId, user);
        trips.get(tripId)!.members.delete(target);
      },
      async leave(tripId) {
        await online();
        member(tripId, user);
        if (roleOf(tripId, user) === 'owner') throw deny('Transfer ownership or delete the trip before leaving');
        trips.get(tripId)!.members.delete(user);
      },
      async transfer(tripId, target) {
        await online();
        owner(tripId, user);
        trips.get(tripId)!.members.get(user)!.role = 'editor';
        trips.get(tripId)!.members.get(target)!.role = 'owner';
      },
      async deleteTrip(tripId) {
        await online();
        owner(tripId, user);
        trips.delete(tripId);
        for (const [k, e] of entries) if (e.trip_id === tripId) entries.delete(k);
      },
      async upsertEntry(row) {
        await online();
        const role = roleOf(row.trip_id, user);
        if (role !== 'owner' && role !== 'editor') throw deny('new row violates row-level security policy');
        const key = `${row.trip_id}/${row.id}`;
        const old = entries.get(key);
        if (old && old.author_id !== user) throw deny('new row violates row-level security policy');
        entries.set(key, { ...row, author_id: user, revision: ++revision, deleted_at: row.deleted_at ?? null });
      },
      async withdrawEntry(tripId, entryId, at) {
        await online();
        const old = entries.get(`${tripId}/${entryId}`);
        if (!old || old.author_id !== user || old.deleted_at) return;
        entries.set(`${tripId}/${entryId}`, { ...old, deleted_at: at, updated_at: at, revision: ++revision });
      },
      async pull(tripId, cursor) {
        await online();
        member(tripId, user);
        const rows = [...entries.values()]
          .filter((e) => e.trip_id === tripId && e.revision > cursor.revision)
          .sort((a, b) => a.revision - b.revision);
        const last = rows[rows.length - 1];
        return {
          rows: rows.map((e) => ({ table: 'shared_journal_entries', pk: e.id, deleted: e.deleted_at !== null, data: { ...e } })),
          hasMore: false,
          cursor: last ? { txid: '1', revision: last.revision } : cursor,
        };
      },
    };
  }

  return {
    apiFor,
    entries,
    trips,
    setOffline: (value: boolean) => {
      offline = value;
    },
  };
}
