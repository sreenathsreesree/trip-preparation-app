import { fakeSyncServer } from '../../../../test/fakeSyncServer';
import { openTestDatabase } from '../../../../test/nodeSqliteDatabase';
import { itemInput, setupRepositories, tripInput } from '../../../../test/fixtures';
import { backupStatus, linkAccount, resolveConflicts, runSync, SyncAccountError } from '../syncEngine';

const ASHA = 'acct-asha';
const BOB = 'acct-bob';
type Device = Awaited<ReturnType<typeof setupRepositories>>;

const device = (name: string) => setupRepositories(openTestDatabase(), '2026-11-15T08:00:00.000Z', name);
const sync = (d: Device, server: ReturnType<typeof fakeSyncServer>, account = ASHA) =>
  runSync(d.database, server.apiFor(account), { accountId: account, createId: d.deps.createId, now: d.deps.now });

/** The traveller's phone: one trip using every personal feature. */
async function travellersPhone() {
  const a = await device('a');
  const trip = await a.trips.create(tripInput({ name: 'Kerala', destinations: [{ name: 'Kochi' }], travellers: [{ name: 'Asha', kind: 'adult' }, { name: 'Ben', kind: 'adult' }] }), { sections: [] });
  const munnar = (await a.planner.addNode(trip.id, { name: 'Munnar', parentId: null, addToRoute: true })).node;
  const echo = (await a.planner.addNode(trip.id, { name: 'Echo Point', parentId: munnar.id, addToRoute: true })).node;
  await a.companion.addToNavigation(trip.id, echo.id);
  await a.companion.updateProfile(munnar.id, { saved: true, tags: ['Must visit'], visitMinutes: 120 });
  await a.companion.addTask(munnar.id, { title: 'Book jeep' });
  await a.companion.addNote(munnar.id, { kind: 'food', body: 'Cardamom tea' });
  await a.companion.saveMemory(munnar.id, { visitedOn: '2026-11-21', rating: 5, notes: 'Misty', photos: ['file:///a/memory-in-drive.jpg', 'file:///a/memory-not-yet.jpg'] });
  const entry = await a.journal.create(trip.id, { entryDate: '2026-11-21', title: 'Day one', body: 'Rain', mood: 'great', nodeId: munnar.id });
  const inDrive = await a.journal.addPhoto(entry.id, 'file:///a/journal-in-drive.jpg', 'View');
  await a.journal.addPhoto(entry.id, 'file:///a/journal-not-yet.jpg');
  // Two photos are already in the user's Drive (uploaded by the photo queue).
  for (const [uri, sourceId, id] of [
    ['file:///a/journal-in-drive.jpg', inDrive.id, 'DriveJournal0001'],
    ['file:///a/memory-in-drive.jpg', munnar.id, 'DriveMemory00001'],
  ] as const) {
    const q = await a.photoUploads.enqueue({ accountId: ASHA, tripId: trip.id, source: uri.includes('journal') ? 'journal' : 'memory', sourceId, localUri: uri, fileName: 'x.jpg' });
    await a.photoUploads.markUploaded(q.id, id);
  }
  await a.expenses.ensureParticipants(trip.id);
  const [p1, p2] = (await a.expenses.workspace(trip.id)).participants.map((p) => p.id) as [string, string];
  await a.expenses.saveExpense(trip.id, { scope: 'group', title: 'Houseboat', amountMinor: 1200000, currency: 'INR', category: 'stay', spentOn: '2026-11-21', paidBy: p1, splitMethod: 'percent', splits: [{ participantId: p1, value: 6000 }, { participantId: p2, value: 4000 }] });
  await a.expenses.saveExpense(trip.id, { scope: 'personal', title: 'Spice box', amountMinor: 75000, currency: 'INR', category: 'shopping', spentOn: '2026-11-21' });
  await a.expenses.addSettlement(trip.id, { fromId: p2, toId: p1, amountMinor: 100000, currency: 'INR', settledOn: '2026-11-22' });
  await a.expenses.saveBudget(trip.id, { currency: 'INR', totalMinor: 5000000, dailyLimitMinor: 800000, lines: [{ category: 'stay', plannedMinor: 2000000 }] });
  await a.expenses.setCurrency(trip.id, 'INR');
  await a.inventory.createItem(itemInput({ name: 'Rain jacket' }));
  return { a, trip, munnar, entry };
}

const snapshot = async (d: Device, tripId: string) => {
  const ws = await d.expenses.workspace(tripId);
  const plan = await d.planner.load(tripId);
  return {
    trip: (await d.trips.getById(tripId))?.name,
    destinations: (await d.trips.getById(tripId))?.destinations.map((x) => x.name),
    nodes: plan.nodes.map((n) => [n.id, n.name, n.parentId]).sort(),
    route: plan.route.map((r) => r.nodeId),
    navigation: (await d.companion.trip(tripId)).navigation.map((n) => n.nodeId),
    journal: (await d.journal.list(tripId)).map((e) => [e.id, e.title, e.body, e.nodeId]),
    expenses: ws.expenses.map((e) => [e.id, e.scope, e.amountMinor, e.splits.map((s) => [s.participantId, s.minor, s.inputValue])]).sort(),
    settlements: ws.settlements.map((s) => [s.id, s.amountMinor]),
    budgets: ws.budgets,
    currency: ws.currency,
    participants: ws.participants.map((p) => [p.id, p.name, p.isMe]),
  };
};

const counts = async (d: Device) => {
  const n = async (sql: string) => (await d.db.getFirstAsync<{ n: number }>(sql, []))?.n;
  return { categories: await n('SELECT COUNT(*) AS n FROM inventory_categories'), items: await n('SELECT COUNT(*) AS n FROM inventory_items') };
};

describe('G3 backup and restore', () => {
  it('backs up everything and restores it on a fresh phone with the same ids, relationships and no duplicate starter categories', async () => {
    const server = fakeSyncServer();
    const { a, trip } = await travellersPhone();
    await linkAccount(a.database, ASHA);
    const first = await sync(a, server);
    expect(first.rejected).toEqual([]);
    expect(first.pending).toBe(0);
    expect(first.photosNotInDrive).toBe(2);
    expect(first.unsupportedTables).toEqual([]);

    const b = await device('b'); // fresh install: its own starter categories with different ids
    await linkAccount(b.database, ASHA);
    const restored = await sync(b, server);
    expect(restored.rejected).toEqual([]);
    expect(restored.conflicts).toBe(0);
    expect(await snapshot(b, trip.id)).toEqual(await snapshot(a, trip.id));
    expect(await counts(b)).toEqual(await counts(a));
    expect(await b.db.getAllAsync('PRAGMA foreign_key_check', [])).toEqual([]);

    // Photos: the ones in Drive come back as Drive references; device paths never travel.
    const journal = await b.journal.list(trip.id);
    expect(journal[0]?.photos.map((p) => [p.uri, p.caption])).toEqual([['drive:DriveJournal0001', 'View']]);
    const memory = await b.companion.node((await b.planner.load(trip.id)).nodes.find((n) => n.name === 'Munnar')!.id);
    expect(memory.memory?.photos).toEqual(['drive:DriveMemory00001']);
    expect(JSON.stringify([...server.rows.values()])).not.toContain('file:');

    // The phone that took the photos keeps its own copies.
    await sync(a, server);
    expect((await a.journal.list(trip.id))[0]?.photos.map((p) => p.uri)).toEqual(['file:///a/journal-in-drive.jpg', 'file:///a/journal-not-yet.jpg']);
  });

  it('sends only what changed, and applies the other phone’s changes', async () => {
    const server = fakeSyncServer();
    const { a, trip, entry } = await travellersPhone();
    await linkAccount(a.database, ASHA);
    await sync(a, server);
    const b = await device('b');
    await linkAccount(b.database, ASHA);
    await sync(b, server);

    expect((await sync(a, server)).uploaded).toBe(0);
    await a.journal.update(entry.id, { entryDate: '2026-11-21', title: 'Day one', body: 'Heavy rain', mood: 'great', nodeId: entry.nodeId });
    const delta = await sync(a, server);
    expect(delta.uploaded).toBe(1);
    await sync(b, server);
    expect((await b.journal.get(entry.id))?.body).toBe('Heavy rain');

    // Deleting on one phone deletes on the other.
    const personal = (await b.expenses.workspace(trip.id)).expenses.find((e) => e.scope === 'personal')!;
    await b.expenses.removeExpense(personal.id);
    expect((await sync(b, server)).deletedUp).toBe(1);
    await sync(a, server);
    expect((await a.expenses.expense(personal.id))).toBeNull();
  });

  it('never overwrites: the same record changed on both phones becomes a conflict the user resolves', async () => {
    const server = fakeSyncServer();
    const { a, entry } = await travellersPhone();
    await linkAccount(a.database, ASHA);
    await sync(a, server);
    const b = await device('b');
    await linkAccount(b.database, ASHA);
    await sync(b, server);

    const edit = (d: Device, body: string) => d.journal.update(entry.id, { entryDate: '2026-11-21', title: 'Day one', body, mood: 'great', nodeId: entry.nodeId });
    await edit(a, 'Written on phone A');
    await edit(b, 'Written on phone B');
    await sync(a, server);
    const result = await sync(b, server);
    expect(result.conflicts).toBe(1);
    expect((await b.journal.get(entry.id))?.body).toBe('Written on phone B');
    expect((await backupStatus(b.database, [...server.rows.values()].map((r) => r.table))).conflicts).toBe(1);

    expect(await resolveConflicts(b.database, 'use_cloud')).toBe(1);
    expect((await b.journal.get(entry.id))?.body).toBe('Written on phone A');

    await edit(b, 'Final from B');
    await edit(a, 'Final from A');
    await sync(b, server);
    await sync(a, server);
    await resolveConflicts(a.database, 'keep_device');
    await sync(a, server);
    await sync(b, server);
    expect((await b.journal.get(entry.id))?.body).toBe('Final from A');
  });

  it('resumes an interrupted upload without duplicates', async () => {
    const server = fakeSyncServer();
    const { a } = await travellersPhone();
    await linkAccount(a.database, ASHA);
    server.failPushesAfter(0);
    await expect(sync(a, server)).rejects.toThrow(/Network/);
    server.failPushesAfter(null);
    const result = await sync(a, server);
    expect(result.pending).toBe(0);
    const total = server.rows.size;
    await sync(a, server);
    expect(server.rows.size).toBe(total);
  });

  it('adopts guest data into an account that already has cloud data (both kept)', async () => {
    const server = fakeSyncServer();
    const { a, trip } = await travellersPhone();
    await linkAccount(a.database, ASHA);
    await sync(a, server);

    const c = await device('c');
    const guestTrip = await c.trips.create(tripInput({ name: 'Guest trip', destinations: [] }), { sections: [] });
    await linkAccount(c.database, ASHA);
    await sync(c, server);
    expect((await c.trips.list()).map((t) => t.name).sort()).toEqual(['Guest trip', 'Kerala']);
    await sync(a, server);
    expect((await a.trips.getById(guestTrip.id))?.name).toBe('Guest trip');
    expect((await a.trips.getById(trip.id))?.name).toBe('Kerala');
  });

  it('keeps accounts apart: a phone linked to one account never syncs with another', async () => {
    const server = fakeSyncServer();
    const { a } = await travellersPhone();
    await linkAccount(a.database, ASHA);
    await sync(a, server);
    await expect(sync(a, server, BOB)).rejects.toBeInstanceOf(SyncAccountError);
    await expect(linkAccount(a.database, BOB)).rejects.toThrow(/another Google account/);
    const b = await device('b');
    await expect(runSync(b.database, server.apiFor(ASHA), { accountId: ASHA, createId: b.deps.createId })).rejects.toThrow(/Choose whether/);
    // Bob's empty account downloads nothing of Asha's.
    const bobPhone = await device('bob');
    await linkAccount(bobPhone.database, BOB);
    expect((await sync(bobPhone, server, BOB)).downloaded).toBe(0);
    expect((await bobPhone.trips.list()).length).toBe(0);
  });

  it('with only G1 deployed, backs up the G1 data and says what is not covered yet', async () => {
    const server = fakeSyncServer({ g3: false });
    const { a, trip } = await travellersPhone();
    await linkAccount(a.database, ASHA);
    const result = await sync(a, server);
    expect(result.rejected).toEqual([]);
    expect(result.unsupportedTables).toEqual(expect.arrayContaining(['journal_entries', 'expenses', 'trip_navigation_items']));
    const b = await device('b');
    await linkAccount(b.database, ASHA);
    await sync(b, server);
    expect((await b.trips.getById(trip.id))?.name).toBe('Kerala');
    expect((await b.planner.load(trip.id)).route.length).toBe(3);
    expect(await b.journal.list(trip.id)).toEqual([]);
  });
});
