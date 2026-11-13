import { createHash, randomBytes } from 'node:crypto';

import { fakeSharingServer } from '../../../../test/fakeSharingServer';
import { setupRepositories, tripInput } from '../../../../test/fixtures';
import { syncSharedTrip } from '../../sharing/sharedSync';
import { createInvite, joinTrip, shareTrip } from '../../sharing/sharingService';

const ASHA = { id: 'user-asha', displayName: 'Asha' };
const BEN = { id: 'user-ben', displayName: 'Ben' };
const VEE = { id: 'user-vee', displayName: 'Vee' };
const tokens = { randomToken: () => randomBytes(24).toString('base64url'), sha256Hex: async (t: string) => createHash('sha256').update(t).digest('hex') };
type Repos = Awaited<ReturnType<typeof setupRepositories>>;

async function setup(options: { workspace?: boolean } = {}) {
  const server = fakeSharingServer(options);
  const asha = await setupRepositories(undefined, '2026-11-13T08:00:00.000Z', 'a');
  const ben = await setupRepositories(undefined, '2026-11-13T08:00:00.000Z', 'b');
  const vee = await setupRepositories(undefined, '2026-11-13T08:00:00.000Z', 'v');
  const trip = await asha.trips.create(tripInput({ name: 'Kerala', destinations: [] }), { sections: [] });
  const space = await shareTrip(trip, ASHA, { api: server.apiFor(ASHA.id), repos: asha });
  const join = async (repos: Repos, who: typeof BEN, role: 'editor' | 'viewer') => {
    const { token } = await createInvite(space.cloudTripId, role, { api: server.apiFor(ASHA.id), tokens });
    return (await joinTrip(token, who, { api: server.apiFor(who.id), repos })).tripId;
  };
  const benTrip = await join(ben, BEN, 'editor');
  const veeTrip = await join(vee, VEE, 'viewer');
  const sync = (repos: Repos, tripId: string, who: { id: string }) =>
    syncSharedTrip(tripId, { api: server.apiFor(who.id), repo: repos.sharing, accountId: who.id, expenses: repos.expenses, group: repos.group });
  return { server, asha, ben, vee, trip, benTrip, veeTrip, sync };
}

describe('Group Trip workspace sync', () => {
  it('the owner’s itinerary, checklist, booking and note reach every member; the viewer reads them offline', async () => {
    const c = await setup();
    await c.asha.group.save(c.trip.id, { id: 'p-munnar', kind: 'place', data: { name: 'Munnar', position: 0, routePosition: 0, location: { latitude: 10.09, longitude: 77.06 } } }, ASHA);
    await c.asha.group.save(c.trip.id, { id: 'c1', kind: 'checklist', data: { title: 'Hotel confirmation', done: false, assignee: BEN.id } }, ASHA);
    await c.asha.group.save(c.trip.id, { id: 'd1', kind: 'document', data: { title: 'Tea County Resort', type: 'hotel', reference: 'TC-1' } }, ASHA);
    await c.asha.group.save(c.trip.id, { id: 'n1', kind: 'note', data: { title: 'Meeting point', body: 'Gate 2' } }, ASHA);
    expect(await c.sync(c.asha, c.trip.id, ASHA)).toMatchObject({ groupSent: 4, error: null });
    await c.sync(c.vee, c.veeTrip, VEE);
    const vee = await c.vee.group.list(c.veeTrip);
    expect(vee.map((i) => [i.kind, i.data.title ?? i.data.name, i.authorName]).sort()).toEqual([
      ['checklist', 'Hotel confirmation', 'Asha'],
      ['document', 'Tea County Resort', 'Asha'],
      ['note', 'Meeting point', 'Asha'],
      ['place', 'Munnar', 'Asha'],
    ]);
  });

  it('an editor’s change reaches the owner; a viewer’s change is refused and stays visible as not sent', async () => {
    const c = await setup();
    await c.asha.group.save(c.trip.id, { id: 'c1', kind: 'checklist', data: { title: 'Fuel', done: false } }, ASHA);
    await c.sync(c.asha, c.trip.id, ASHA);
    await c.sync(c.ben, c.benTrip, BEN);
    await c.ben.group.save(c.benTrip, { id: 'c1', kind: 'checklist', data: { title: 'Fuel', done: true } }, BEN);
    expect(await c.sync(c.ben, c.benTrip, BEN)).toMatchObject({ groupSent: 1 });
    await c.sync(c.asha, c.trip.id, ASHA);
    expect((await c.asha.group.get(c.trip.id, 'c1'))?.data.done).toBe(true);

    await c.sync(c.vee, c.veeTrip, VEE);
    await c.vee.group.save(c.veeTrip, { id: 'c1', kind: 'checklist', data: { title: 'Hacked', done: false } }, VEE);
    expect(await c.sync(c.vee, c.veeTrip, VEE)).toMatchObject({ groupSent: 0 });
    expect((await c.vee.group.get(c.veeTrip, 'c1'))?.lastError).toMatch(/owner and editors/);
    expect([...c.server.records.values()].find((r) => r.id === 'c1')?.data).toEqual({ title: 'Fuel', done: true });
  });

  it('readiness: every member, viewer too, shares only "ready" — never which personal items are packed', async () => {
    const c = await setup();
    await c.vee.group.save(c.veeTrip, { id: VEE.id, kind: 'readiness', data: { ready: true } }, VEE);
    await c.ben.group.save(c.benTrip, { id: BEN.id, kind: 'readiness', data: { ready: false } }, BEN);
    await c.sync(c.vee, c.veeTrip, VEE);
    await c.sync(c.ben, c.benTrip, BEN);
    await c.sync(c.asha, c.trip.id, ASHA);
    const ready = (await c.asha.group.list(c.trip.id, 'readiness')).map((r) => [r.id, r.data]);
    expect(ready.sort()).toEqual([
      [BEN.id, { ready: false }],
      [VEE.id, { ready: true }],
    ]);
    // Personal checklist and packing content never leaves the device.
    expect(JSON.stringify([...c.server.records.values()])).not.toMatch(/passport|toothbrush/i);
  });

  it('two members change the same item offline: nothing is overwritten; the user chooses', async () => {
    const c = await setup();
    await c.asha.group.save(c.trip.id, { id: 'n1', kind: 'note', data: { title: 'Pickup', body: '8:00' } }, ASHA);
    await c.sync(c.asha, c.trip.id, ASHA);
    await c.sync(c.ben, c.benTrip, BEN);
    await c.ben.group.save(c.benTrip, { id: 'n1', kind: 'note', data: { title: 'Pickup', body: '9:00' } }, BEN);
    await c.sync(c.ben, c.benTrip, BEN);
    await c.asha.group.save(c.trip.id, { id: 'n1', kind: 'note', data: { title: 'Pickup', body: '7:30' } }, ASHA);
    const r = await c.sync(c.asha, c.trip.id, ASHA);
    expect(r.groupConflicts).toBe(1);
    const mine = await c.asha.group.get(c.trip.id, 'n1');
    expect(mine?.data.body).toBe('7:30');
    expect(mine?.conflict?.data.body).toBe('9:00');
    // The group copy was not overwritten by the conflicting edit.
    expect([...c.server.records.values()].find((x) => x.id === 'n1')?.data).toEqual({ title: 'Pickup', body: '9:00' });
    await c.asha.group.resolve(c.trip.id, 'n1', 'mine');
    await c.sync(c.asha, c.trip.id, ASHA);
    await c.sync(c.ben, c.benTrip, BEN);
    expect((await c.ben.group.get(c.benTrip, 'n1'))?.data.body).toBe('7:30');
  });

  it('offline edits wait and are sent after reconnecting; a removed member loses the cached workspace', async () => {
    const c = await setup();
    c.server.setOffline(true);
    await c.ben.group.save(c.benTrip, { id: 'n2', kind: 'note', data: { title: 'Rain plan', body: 'Museum' } }, BEN);
    expect((await c.sync(c.ben, c.benTrip, BEN)).error).toBeTruthy();
    expect(await c.ben.group.pending(c.benTrip)).toHaveLength(1);
    c.server.setOffline(false);
    expect(await c.sync(c.ben, c.benTrip, BEN)).toMatchObject({ groupSent: 1, error: null });
    await c.sync(c.vee, c.veeTrip, VEE);
    expect(await c.vee.group.list(c.veeTrip)).toHaveLength(1);
    const space = (await c.asha.sharing.space(c.trip.id))!;
    await c.server.apiFor(ASHA.id).removeMember(space.cloudTripId, VEE.id);
    expect(await c.sync(c.vee, c.veeTrip, VEE)).toMatchObject({ removed: true });
    expect(await c.vee.group.list(c.veeTrip, undefined, { includeDeleted: true })).toEqual([]);
    expect(await c.vee.trips.getById(c.veeTrip)).not.toBeNull(); // their own copy of the trip stays
  });

  it('before the cloud migration is deployed: group items wait on the phone; journal and expenses still sync', async () => {
    const c = await setup({ workspace: false });
    await c.asha.group.save(c.trip.id, { id: 'n1', kind: 'note', data: { title: 'x' } }, ASHA);
    const r = await c.sync(c.asha, c.trip.id, ASHA);
    expect(r).toMatchObject({ groupNotReady: true, error: null });
    expect(await c.asha.group.pending(c.trip.id)).toHaveLength(1);
  });
});

describe('My Trip documents stay private', () => {
  it('private documents are stored only on the device and never sent by sharing', async () => {
    const c = await setup();
    await c.asha.myDocuments.save(c.trip.id, { title: 'Passport', type: 'passport', date: null, reference: 'P1234567', link: '', expiry: '2030-01-01', placeName: '', notes: '' });
    await c.sync(c.asha, c.trip.id, ASHA);
    expect(JSON.stringify([...c.server.records.values(), ...c.server.entries.values()])).not.toContain('P1234567');
    expect((await c.asha.myDocuments.list(c.trip.id)).map((d) => d.title)).toEqual(['Passport']);
    expect(await c.ben.myDocuments.list(c.benTrip)).toEqual([]);
  });
});
