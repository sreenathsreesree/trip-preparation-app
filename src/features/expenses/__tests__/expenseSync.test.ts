import { createHash, randomBytes } from 'node:crypto';

import { fakeSharingServer } from '../../../../test/fakeSharingServer';
import { setupRepositories, tripInput } from '../../../../test/fixtures';
import { syncSharedTrip } from '../../sharing/sharedSync';
import { createInvite, joinTrip, shareTrip } from '../../sharing/sharingService';
import { balances, simplifyDebts } from '../money';

const ASHA = { id: 'acct-asha', displayName: 'Asha' };
const BEN = { id: 'acct-ben', displayName: 'Ben' };
const VEE = { id: 'acct-vee', displayName: 'Vee' };
const tokens = { randomToken: () => randomBytes(24).toString('base64url'), sha256Hex: async (t: string) => createHash('sha256').update(t).digest('hex') };

type Device = Awaited<ReturnType<typeof setupRepositories>>;

async function setup() {
  const server = fakeSharingServer();
  const asha = await setupRepositories();
  const trip = await asha.trips.create(
    tripInput({ name: 'Kerala', destinations: [], travellers: [{ name: 'Asha', kind: 'adult' }, { name: 'Ravi', kind: 'adult' }] }),
    { sections: [] },
  );
  await asha.expenses.ensureParticipants(trip.id);
  const [aId, raviId] = (await asha.expenses.workspace(trip.id)).participants.map((p) => p.id) as [string, string];
  const group = await asha.expenses.saveExpense(trip.id, {
    scope: 'group',
    title: 'Houseboat',
    amountMinor: 1200000,
    currency: 'INR',
    category: 'stay',
    spentOn: '2026-12-20',
    paidBy: aId,
    splitMethod: 'equal',
    splits: [{ participantId: aId, value: 0 }, { participantId: raviId, value: 0 }],
  });
  await asha.expenses.saveExpense(trip.id, { scope: 'personal', title: 'My secret souvenir', amountMinor: 99900, currency: 'INR', category: 'shopping', spentOn: '2026-12-20' });
  await asha.expenses.saveBudget(trip.id, { currency: 'INR', totalMinor: 5000000, dailyLimitMinor: 1000000, lines: [{ category: 'stay', plannedMinor: 2000000 }] });

  const sync = (device: Device, tripId: string, account: { id: string }) =>
    syncSharedTrip(tripId, { api: server.apiFor(account.id), repo: device.sharing, accountId: account.id, expenses: device.expenses });
  const space = await shareTrip(trip, ASHA, { api: server.apiFor(ASHA.id), repos: asha });
  await asha.expenses.enqueueAll(trip.id);
  await sync(asha, trip.id, ASHA);

  const join = async (account: typeof BEN, role: 'editor' | 'viewer') => {
    const device = await setupRepositories();
    const { token } = await createInvite(space.cloudTripId, role, { api: server.apiFor(ASHA.id), tokens });
    const joined = await joinTrip(token, account, { api: server.apiFor(account.id), repos: device });
    await sync(device, joined.tripId, account);
    return { device, tripId: joined.tripId };
  };
  const books = async (device: Device, tripId: string) => {
    const ws = await device.expenses.workspace(tripId);
    const names = new Map(ws.participants.map((p) => [p.id, p.name]));
    return simplifyDebts(
      balances(
        ws.expenses.filter((e) => e.scope === 'group').map((e) => ({ amountMinor: e.amountMinor, currency: e.currency, paidBy: e.paidBy as string, shares: e.splits })),
        ws.settlements,
      ),
    ).map((d) => `${names.get(d.fromId)} → ${names.get(d.toId)} ${d.amountMinor} ${d.currency}`);
  };
  return { server, asha, trip, aId, raviId, group, sync, join, books };
}

const serverText = (server: ReturnType<typeof fakeSharingServer>) => JSON.stringify([...server.records.values()]);

describe('shared trip expenses across devices', () => {
  it('sends group expenses, participants and the budget — never personal expenses', async () => {
    const ctx = await setup();
    const tables = [...ctx.server.records.values()].map((r) => r.table).sort();
    expect(tables).toEqual(['shared_expense_budgets', 'shared_expense_participants', 'shared_expense_participants', 'shared_expenses']);
    expect(serverText(ctx.server)).not.toContain('My secret souvenir');
    expect(serverText(ctx.server)).not.toContain('99900');
    const asha = [...ctx.server.records.values()].find((r) => r.table === 'shared_expense_participants' && r.name === 'Asha');
    expect(asha?.user_id).toBe(ASHA.id);
  });

  it('an editor sees the same group expenses, balances and budget, and adds their own', async () => {
    const ctx = await setup();
    const ben = await ctx.join(BEN, 'editor');
    const ws = await ben.device.expenses.workspace(ben.tripId);
    expect(ws.expenses.map((e) => [e.title, e.scope])).toEqual([['Houseboat', 'group']]);
    expect(ws.budgets).toEqual([{ currency: 'INR', totalMinor: 5000000, dailyLimitMinor: 1000000, lines: [{ category: 'stay', plannedMinor: 2000000 }] }]);
    expect(ws.participants.map((p) => [p.name, p.isMe])).toEqual([
      ['Asha', false],
      ['Ravi', false],
      ['Ben', true],
    ]);
    expect(await ctx.books(ben.device, ben.tripId)).toEqual(await ctx.books(ctx.asha, ctx.trip.id));

    const benMe = ws.participants.find((p) => p.isMe)!.id;
    const taxi = await ben.device.expenses.saveExpense(ben.tripId, {
      scope: 'group',
      title: 'Taxi',
      amountMinor: 90000,
      currency: 'INR',
      category: 'transport',
      spentOn: '2026-12-21',
      paidBy: benMe,
      splitMethod: 'shares',
      splits: [{ participantId: ctx.aId, value: 2 }, { participantId: benMe, value: 1 }],
    });
    await ben.device.expenses.enqueue(ben.tripId, 'expense', taxi.id);
    await ctx.sync(ben.device, ben.tripId, BEN);
    await ctx.sync(ctx.asha, ctx.trip.id, ASHA);
    expect((await ctx.asha.expenses.workspace(ctx.trip.id)).expenses.map((e) => e.title).sort()).toEqual(['Houseboat', 'My secret souvenir', 'Taxi']);
    expect(await ctx.books(ctx.asha, ctx.trip.id)).toEqual(await ctx.books(ben.device, ben.tripId));
    expect(await ctx.books(ctx.asha, ctx.trip.id)).toEqual(['Ravi → Asha 540000 INR', 'Ravi → Ben 60000 INR']);

    // Settlements travel too.
    const benWs = await ben.device.expenses.workspace(ben.tripId);
    const s = await ben.device.expenses.addSettlement(ben.tripId, { fromId: ctx.raviId, toId: ctx.aId, amountMinor: 600000, currency: 'INR', settledOn: '2026-12-22' });
    await ben.device.expenses.enqueue(ben.tripId, 'settlement', s.id);
    await ctx.sync(ben.device, ben.tripId, BEN);
    await ctx.sync(ctx.asha, ctx.trip.id, ASHA);
    expect((await ctx.asha.expenses.workspace(ctx.trip.id)).settlements.map((x) => x.amountMinor)).toEqual([600000]);
    expect(benWs.participants.length).toBe(3);
  });

  it('turning a group expense personal withdraws it without sending the personal version', async () => {
    const ctx = await setup();
    const ben = await ctx.join(BEN, 'editor');
    await ctx.asha.expenses.saveExpense(ctx.trip.id, { scope: 'personal', title: 'Private houseboat note', amountMinor: 1234500, currency: 'INR', category: 'stay', spentOn: '2026-12-20' }, ctx.group.id);
    expect(await ctx.asha.expenses.enqueue(ctx.trip.id, 'expense', ctx.group.id)).toBe(false);
    expect(await ctx.asha.expenses.enqueue(ctx.trip.id, 'expense', ctx.group.id, { withdrawal: true })).toBe(true);
    await ctx.sync(ctx.asha, ctx.trip.id, ASHA);
    expect(serverText(ctx.server)).not.toContain('Private houseboat note');
    expect(serverText(ctx.server)).not.toContain('1234500');
    await ctx.sync(ben.device, ben.tripId, BEN);
    expect((await ben.device.expenses.workspace(ben.tripId)).expenses).toEqual([]);
  });

  it('a viewer sees group records read-only; their personal expenses stay on their device', async () => {
    const ctx = await setup();
    const vee = await ctx.join(VEE, 'viewer');
    const ws = await vee.device.expenses.workspace(vee.tripId);
    expect(ws.groupReadOnly).toBe(true);
    expect(ws.expenses.map((e) => e.title)).toEqual(['Houseboat']);
    expect(ws.participants.some((p) => p.name === 'Vee')).toBe(false); // viewers cannot add themselves
    await expect(
      vee.device.expenses.saveExpense(vee.tripId, { scope: 'group', title: 'Nope', amountMinor: 100, currency: 'INR', category: 'food', spentOn: '2026-12-20', paidBy: ctx.aId, splits: [{ participantId: ctx.aId, value: 0 }] }),
    ).rejects.toThrow(/view/);
    const mine = await vee.device.expenses.saveExpense(vee.tripId, { scope: 'personal', title: 'Vee coffee', amountMinor: 15000, currency: 'INR', category: 'food', spentOn: '2026-12-20' });
    expect(await vee.device.expenses.enqueue(vee.tripId, 'expense', mine.id)).toBe(false);
    await ctx.sync(vee.device, vee.tripId, VEE);
    expect(serverText(ctx.server)).not.toContain('Vee coffee');
  });

  it('keeps expense changes queued offline and sends them later; a pulled copy never overwrites an unsent edit', async () => {
    const ctx = await setup();
    const ben = await ctx.join(BEN, 'editor');
    await ctx.asha.expenses.saveExpense(ctx.trip.id, { ...ctx.group, splits: ctx.group.splits.map((s) => ({ participantId: s.participantId, value: 0 })), amountMinor: 1300000 }, ctx.group.id);
    await ctx.asha.expenses.enqueue(ctx.trip.id, 'expense', ctx.group.id);
    ctx.server.setOffline(true);
    expect((await ctx.sync(ctx.asha, ctx.trip.id, ASHA)).error).toMatch(/offline/);
    expect(await ctx.asha.expenses.outboxCount(ctx.trip.id)).toBe(1);
    ctx.server.setOffline(false);
    // A pull while the edit is unsent keeps the local amount.
    await syncSharedTrip(ctx.trip.id, { api: ctx.server.apiFor(ASHA.id), repo: ctx.asha.sharing, accountId: ASHA.id, expenses: ctx.asha.expenses });
    expect((await ctx.asha.expenses.expense(ctx.group.id))?.amountMinor).toBe(1300000);
    const later = new Date(Date.now() + 10 * 60_000);
    await syncSharedTrip(ctx.trip.id, { api: ctx.server.apiFor(ASHA.id), repo: ctx.asha.sharing, accountId: ASHA.id, expenses: ctx.asha.expenses, now: () => later });
    await ctx.sync(ben.device, ben.tripId, BEN);
    expect((await ben.device.expenses.expense(ctx.group.id))?.amountMinor).toBe(1300000);
  });
});
