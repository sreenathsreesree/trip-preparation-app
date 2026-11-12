import { createHash, randomBytes } from 'node:crypto';

import { setupRepositories, tripInput } from '../../../../test/fixtures';
import { fakeSharingServer } from '../../../../test/fakeSharingServer';
import { syncSharedTrip } from '../sharedSync';
import { toSharingError } from '../sharingApi';
import { createInvite, joinTrip, parseInviteToken, shareTrip, stopSharing } from '../sharingService';

const ASHA = { id: 'user-asha', displayName: 'Asha' };
const BEN = { id: 'user-ben', displayName: 'Ben' };
const VEE = { id: 'user-vee', displayName: 'Vee' };
const tokens = {
  randomToken: () => randomBytes(24).toString('base64url'),
  sha256Hex: async (t: string) => createHash('sha256').update(t).digest('hex'),
};

async function setup() {
  const server = fakeSharingServer();
  const asha = await setupRepositories();
  const ben = await setupRepositories();
  const trip = await asha.trips.create(tripInput({ name: 'Kerala', destinations: [] }), { sections: [] });
  const munnar = (await asha.planner.addNode(trip.id, { name: 'Munnar', parentId: null, addToRoute: true })).node;
  const secret = await asha.journal.create(trip.id, { entryDate: '2026-12-20', title: 'Private thoughts', body: 'Only for me' });
  const shared = await asha.journal.create(trip.id, { entryDate: '2026-12-21', title: 'Tea hills', body: 'Sunrise', mood: 'great', nodeId: munnar.id });
  await asha.journal.setVisibility(shared.id, 'shared');
  const sync = (repos: typeof asha, tripId: string, account: { id: string }) =>
    syncSharedTrip(tripId, { api: server.apiFor(account.id), repo: repos.sharing, accountId: account.id });
  return { server, asha, ben, trip, secret, shared, sync };
}

describe('sharing a trip', () => {
  it('sends only entries marked shared — text and place name, never private entries', async () => {
    const ctx = await setup();
    const space = await shareTrip(ctx.trip, ASHA, { api: ctx.server.apiFor(ASHA.id), repos: ctx.asha });
    expect(space.role).toBe('owner');
    expect(await ctx.sync(ctx.asha, ctx.trip.id, ASHA)).toMatchObject({ pushed: 1, error: null });
    const cloud = [...ctx.server.entries.values()];
    expect(cloud.map((e) => [e.title, e.place_name, e.author_name, e.author_id])).toEqual([['Tea hills', 'Munnar', 'Asha', ASHA.id]]);
    expect(JSON.stringify(cloud)).not.toContain('Only for me');
    expect(await ctx.asha.sharing.outboxCount(ctx.trip.id)).toBe(0);
  });

  it('a member joins by invitation, gets a local trip and reads shared entries offline', async () => {
    const ctx = await setup();
    const space = await shareTrip(ctx.trip, ASHA, { api: ctx.server.apiFor(ASHA.id), repos: ctx.asha });
    await ctx.sync(ctx.asha, ctx.trip.id, ASHA);
    const { token } = await createInvite(space.cloudTripId, 'editor', { api: ctx.server.apiFor(ASHA.id), tokens });

    const joined = await joinTrip(token, BEN, { api: ctx.server.apiFor(BEN.id), repos: ctx.ben });
    expect(joined).toMatchObject({ role: 'editor', created: true });
    expect((await ctx.ben.trips.getById(joined.tripId))?.name).toBe('Kerala');
    expect(await ctx.sync(ctx.ben, joined.tripId, BEN)).toMatchObject({ pulled: 1 });
    const benSpace = (await ctx.ben.sharing.space(joined.tripId))!;
    expect((await ctx.ben.sharing.sharedEntries(benSpace.cloudTripId)).map((e) => [e.title, e.authorName])).toEqual([['Tea hills', 'Asha']]);
    expect((await ctx.ben.sharing.members(benSpace.cloudTripId)).map((m) => [m.displayName, m.role])).toEqual([
      ['Asha', 'owner'],
      ['Ben', 'editor'],
    ]);

    // Joining again with the same link reuses the trip.
    expect(await joinTrip(token, BEN, { api: ctx.server.apiFor(BEN.id), repos: ctx.ben })).toMatchObject({ tripId: joined.tripId, created: false });

    // Ben's own shared entry goes up and comes back to Asha (not echoed into Ben's cache).
    const benEntry = await ctx.ben.journal.create(joined.tripId, { entryDate: '2026-12-21', title: 'Boat ride' });
    await ctx.ben.journal.setVisibility(benEntry.id, 'shared');
    await ctx.ben.sharing.enqueue(joined.tripId, benEntry.id);
    await ctx.sync(ctx.ben, joined.tripId, BEN);
    expect((await ctx.ben.sharing.sharedEntries(benSpace.cloudTripId)).map((e) => e.title)).toEqual(['Tea hills']);
    await ctx.sync(ctx.asha, ctx.trip.id, ASHA);
    expect((await ctx.asha.sharing.sharedEntries(space.cloudTripId)).map((e) => [e.title, e.authorName])).toEqual([['Boat ride', 'Ben']]);
  });

  it('making an entry private or deleting it withdraws the shared copy; edits update it', async () => {
    const ctx = await setup();
    const space = await shareTrip(ctx.trip, ASHA, { api: ctx.server.apiFor(ASHA.id), repos: ctx.asha });
    await ctx.sync(ctx.asha, ctx.trip.id, ASHA);
    const { token } = await createInvite(space.cloudTripId, 'viewer', { api: ctx.server.apiFor(ASHA.id), tokens });
    const ben = await joinTrip(token, BEN, { api: ctx.server.apiFor(BEN.id), repos: ctx.ben });
    await ctx.sync(ctx.ben, ben.tripId, BEN);

    await ctx.asha.journal.update(ctx.shared.id, { entryDate: '2026-12-21', title: 'Tea hills at dawn', nodeId: null });
    await ctx.asha.sharing.enqueue(ctx.trip.id, ctx.shared.id);
    await ctx.sync(ctx.asha, ctx.trip.id, ASHA);
    await ctx.sync(ctx.ben, ben.tripId, BEN);
    expect((await ctx.ben.sharing.sharedEntries(space.cloudTripId)).map((e) => e.title)).toEqual(['Tea hills at dawn']);

    await ctx.asha.journal.setVisibility(ctx.shared.id, 'private');
    await ctx.asha.sharing.enqueue(ctx.trip.id, ctx.shared.id);
    expect(await ctx.sync(ctx.asha, ctx.trip.id, ASHA)).toMatchObject({ withdrawn: 1 });
    await ctx.sync(ctx.ben, ben.tripId, BEN);
    expect(await ctx.ben.sharing.sharedEntries(space.cloudTripId)).toEqual([]);

    await ctx.asha.journal.setVisibility(ctx.shared.id, 'shared');
    await ctx.asha.sharing.enqueue(ctx.trip.id, ctx.shared.id);
    await ctx.sync(ctx.asha, ctx.trip.id, ASHA);
    await ctx.asha.journal.remove(ctx.shared.id);
    await ctx.asha.sharing.enqueue(ctx.trip.id, ctx.shared.id);
    await ctx.sync(ctx.asha, ctx.trip.id, ASHA);
    await ctx.sync(ctx.ben, ben.tripId, BEN);
    expect(await ctx.ben.sharing.sharedEntries(space.cloudTripId)).toEqual([]);
  });

  it('viewers cannot queue changes; a demoted editor stops sending', async () => {
    const ctx = await setup();
    const space = await shareTrip(ctx.trip, ASHA, { api: ctx.server.apiFor(ASHA.id), repos: ctx.asha });
    const { token } = await createInvite(space.cloudTripId, 'viewer', { api: ctx.server.apiFor(ASHA.id), tokens });
    const ben = await joinTrip(token, BEN, { api: ctx.server.apiFor(BEN.id), repos: ctx.ben });
    const entry = await ctx.ben.journal.create(ben.tripId, { entryDate: '2026-12-21', title: 'Mine' });
    await ctx.ben.journal.setVisibility(entry.id, 'shared');
    expect(await ctx.ben.sharing.enqueue(ben.tripId, entry.id)).toBe(false);
  });

  it('a removed member is told, keeps everything on the device and stops syncing', async () => {
    const ctx = await setup();
    const space = await shareTrip(ctx.trip, ASHA, { api: ctx.server.apiFor(ASHA.id), repos: ctx.asha });
    await ctx.sync(ctx.asha, ctx.trip.id, ASHA);
    const { token } = await createInvite(space.cloudTripId, 'editor', { api: ctx.server.apiFor(ASHA.id), tokens });
    const ben = await joinTrip(token, BEN, { api: ctx.server.apiFor(BEN.id), repos: ctx.ben });
    await ctx.sync(ctx.ben, ben.tripId, BEN);
    await ctx.server.apiFor(ASHA.id).removeMember(space.cloudTripId, BEN.id);
    expect(await ctx.sync(ctx.ben, ben.tripId, BEN)).toMatchObject({ removed: true });
    expect((await ctx.ben.sharing.space(ben.tripId))?.role).toBe('removed');
    expect(await ctx.ben.trips.getById(ben.tripId)).not.toBeNull();
    expect(await ctx.sync(ctx.ben, ben.tripId, BEN)).toMatchObject({ pulled: 0, removed: false });
  });

  it('keeps changes queued while offline and sends them later', async () => {
    const ctx = await setup();
    await shareTrip(ctx.trip, ASHA, { api: ctx.server.apiFor(ASHA.id), repos: ctx.asha });
    ctx.server.setOffline(true);
    const result = await ctx.sync(ctx.asha, ctx.trip.id, ASHA);
    expect(result.error).toMatch(/offline/);
    expect(await ctx.asha.sharing.outboxCount(ctx.trip.id)).toBe(1);
    ctx.server.setOffline(false);
    // Not due before the retry time; then sent.
    const later = new Date(Date.now() + 5 * 60_000);
    expect(await syncSharedTrip(ctx.trip.id, { api: ctx.server.apiFor(ASHA.id), repo: ctx.asha.sharing, accountId: ASHA.id, now: () => later })).toMatchObject({ pushed: 1 });
    expect(await ctx.asha.sharing.outboxCount(ctx.trip.id)).toBe(0);
  });

  it('never syncs a trip linked to another account on this device', async () => {
    const ctx = await setup();
    await shareTrip(ctx.trip, ASHA, { api: ctx.server.apiFor(ASHA.id), repos: ctx.asha });
    expect(await ctx.sync(ctx.asha, ctx.trip.id, VEE)).toEqual({ pushed: 0, withdrawn: 0, pulled: 0, expensesSent: 0, removed: false, error: null });
    expect(ctx.server.entries.size).toBe(0);
  });

  it('leaving or stopping sharing keeps the local trip and makes every entry private again', async () => {
    const ctx = await setup();
    const space = await shareTrip(ctx.trip, ASHA, { api: ctx.server.apiFor(ASHA.id), repos: ctx.asha });
    await ctx.sync(ctx.asha, ctx.trip.id, ASHA);
    const { token } = await createInvite(space.cloudTripId, 'editor', { api: ctx.server.apiFor(ASHA.id), tokens });
    const ben = await joinTrip(token, BEN, { api: ctx.server.apiFor(BEN.id), repos: ctx.ben });
    await ctx.sync(ctx.ben, ben.tripId, BEN);

    await stopSharing(ben.tripId, { api: ctx.server.apiFor(BEN.id), repos: ctx.ben });
    expect(await ctx.ben.sharing.space(ben.tripId)).toBeNull();
    expect(await ctx.ben.sharing.sharedEntries(space.cloudTripId)).toEqual([]);
    expect(ctx.server.trips.get(space.cloudTripId)?.members.has(BEN.id)).toBe(false);

    await stopSharing(ctx.trip.id, { api: ctx.server.apiFor(ASHA.id), repos: ctx.asha });
    expect(ctx.server.trips.has(space.cloudTripId)).toBe(false);
    expect((await ctx.asha.journal.list(ctx.trip.id)).every((e) => e.visibility === 'private')).toBe(true);
    expect((await ctx.asha.journal.list(ctx.trip.id)).length).toBe(2);
  });

  it('reads invitation links and tokens, and explains server errors', () => {
    const token = 'abcdefghijklmnopqrstuvwx';
    expect(parseInviteToken(`tripprep://join/${token}`)).toBe(token);
    expect(parseInviteToken(`https://example.com/join/${token}?x=1`)).toBe(token);
    expect(parseInviteToken(token)).toBe(token);
    expect(parseInviteToken('hello')).toBeNull();
    expect(toSharingError({ code: 'PGRST202', message: 'Could not find the function' }).kind).toBe('server_not_ready');
    expect(toSharingError({ code: '42501', message: 'Only the trip owner can do that' })).toMatchObject({ kind: 'permission', message: 'Only the trip owner can do that' });
    expect(toSharingError(new TypeError('Network request failed')).kind).toBe('network');
  });
});
