import type { Repositories } from '@/db/repositories';

import type { SharedRole, SharingApi } from './sharingApi';

/**
 * Share / join / leave / stop sharing, with the device side kept consistent.
 * Nothing is uploaded by sharing a trip itself except its name and dates;
 * journal entries go only when the user marks them shared.
 */

type Repos = Pick<Repositories, 'trips' | 'sharing'> & { expenses?: Repositories['expenses'] };

export interface Account {
  id: string;
  displayName: string;
}

export interface TokenTools {
  randomToken: () => string;
  sha256Hex: (text: string) => Promise<string>;
}

/** Turns a local trip into a shared trip owned by the user. */
export async function shareTrip(trip: { id: string; name: string; startDate: string; endDate: string }, account: Account, deps: { api: SharingApi; repos: Repos }) {
  const existing = await deps.repos.sharing.space(trip.id);
  if (existing && existing.role !== 'removed') return existing;
  const cloudTripId = await deps.api.createTrip({ name: trip.name, startDate: trip.startDate, endDate: trip.endDate, displayName: account.displayName });
  const space = await deps.repos.sharing.linkSpace({ tripId: trip.id, cloudTripId, accountId: account.id, role: 'owner', displayName: account.displayName });
  await deps.repos.sharing.enqueueAll(trip.id);
  // Group expenses, settlements, participants and budgets go to the shared trip; personal ones never.
  if (deps.repos.expenses) {
    await deps.repos.expenses.ensureParticipants(trip.id);
    await deps.repos.expenses.enqueueAll(trip.id);
  }
  return space;
}

/** Creates an invitation and returns the secret token (only its hash is sent). */
export async function createInvite(cloudTripId: string, role: 'editor' | 'viewer', deps: { api: SharingApi; tokens: TokenTools }) {
  const token = deps.tokens.randomToken();
  const inviteId = await deps.api.createInvite(cloudTripId, await deps.tokens.sha256Hex(token), role);
  return { token, inviteId };
}

/** Extracts the token from an invitation link or a pasted token. */
export function parseInviteToken(input: string): string | null {
  const text = input.trim();
  const match = /(?:^|\/)join\/([A-Za-z0-9_-]{16,128})(?:[/?#]|$)/.exec(text) ?? /^([A-Za-z0-9_-]{16,128})$/.exec(text);
  return match?.[1] ?? null;
}

/**
 * Joins with an invitation. A shared trip already on this device for this
 * account is reused; otherwise a new local trip is created for it.
 */
export async function joinTrip(token: string, account: Account, deps: { api: SharingApi; repos: Repos }): Promise<{ tripId: string; role: SharedRole; created: boolean }> {
  const joined = await deps.api.acceptInvite(token, account.displayName);
  const existing = await deps.repos.sharing.spaceByCloudId(account.id, joined.tripId);
  if (existing) {
    await deps.repos.sharing.setRole(existing.tripId, joined.role);
    return { tripId: existing.tripId, role: joined.role, created: false };
  }
  const trip = await deps.repos.trips.create(
    {
      name: joined.name,
      startDate: joined.startDate,
      endDate: joined.endDate,
      destinations: [],
      travellers: [{ name: account.displayName || 'Me', kind: 'adult' }],
      transportMode: 'mixed',
      category: 'leisure',
    },
    { sections: [] },
  );
  await deps.repos.sharing.linkSpace({ tripId: trip.id, cloudTripId: joined.tripId, accountId: account.id, role: joined.role, displayName: account.displayName });
  return { tripId: trip.id, role: joined.role, created: true };
}

/** Leaves (member) or deletes (owner) the shared trip. The local trip and journal stay, all private again. */
export async function stopSharing(tripId: string, deps: { api: SharingApi; repos: Repos }) {
  const space = await deps.repos.sharing.space(tripId);
  if (!space) return;
  if (space.role === 'owner') await deps.api.deleteTrip(space.cloudTripId);
  else if (space.role !== 'removed') await deps.api.leave(space.cloudTripId);
  await deps.repos.sharing.unlink(tripId);
}
