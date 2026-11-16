import { createHash, randomBytes } from 'node:crypto';

import { fakeSharingServer } from '../../../../test/fakeSharingServer';
import { setupRepositories, tripInput } from '../../../../test/fixtures';
import { openTestDatabase } from '../../../../test/nodeSqliteDatabase';
import { migrate } from '../../../db/migrate';
import { migrations } from '../../../db/migrations';
import { syncSharedTrip } from '../../sharing/sharedSync';
import { createRemoteCacheRepository } from '../../remote/remoteCacheRepository';
import { routeLegs } from '../../route/routing';
import { createInvite, joinTrip, shareTrip } from '../../sharing/sharingService';
import { HISTORY_LIMIT } from '../calculatorRepository';
import { summarize } from '../ledger';
import { balances, simplifyDebts } from '../money';
import { financialOverview, placeOptions } from '../overview';
import { accommodationEstimate, estimateAsBudget, foodEstimate, fuelEstimate, perPerson, tripEstimate } from '../planning';

type Ctx = Awaited<ReturnType<typeof setup>>;

async function setup(db = openTestDatabase()) {
  const repos = await setupRepositories(db);
  const trip = await repos.trips.create(
    tripInput({ name: 'Kerala', destinations: [], travellers: [{ name: 'Asha', kind: 'adult' }, { name: 'Ben', kind: 'adult' }] }),
    { sections: [] },
  );
  await repos.expenses.ensureParticipants(trip.id);
  const [asha, ben] = (await repos.expenses.workspace(trip.id)).participants.map((p) => p.id) as [string, string];
  const node = async (name: string, parentId: string | null = null) => {
    const r = await repos.planner.addNode(trip.id, { name, parentId });
    return r.node.id;
  };
  const kochi = await node('Kochi');
  const fortKochi = await node('Fort Kochi', kochi);
  const munnar = await node('Munnar');
  const group = (amountMinor: number, extra: Record<string, unknown> = {}) => ({
    scope: 'group' as const,
    title: 'Dinner',
    amountMinor,
    currency: 'INR',
    category: 'food',
    spentOn: '2026-12-20',
    paidBy: asha,
    splitMethod: 'equal' as const,
    splits: [
      { participantId: asha, value: 0 },
      { participantId: ben, value: 0 },
    ],
    ...extra,
  });
  const personal = (amountMinor: number, extra: Record<string, unknown> = {}) => ({
    scope: 'personal' as const,
    title: 'Souvenir',
    amountMinor,
    currency: 'INR',
    category: 'shopping',
    spentOn: '2026-12-20',
    ...extra,
  });
  return { ...repos, trip, asha, ben, kochi, fortKochi, munnar, group, personal };
}

const overviewOf = async (ctx: Ctx) => {
  const [ws, plan] = await Promise.all([ctx.expenses.workspace(ctx.trip.id), ctx.planner.load(ctx.trip.id)]);
  return financialOverview(
    ws,
    plan.nodes.map((n) => ({ id: n.id, parentId: n.parentId, name: n.name })),
  );
};

describe('calculation history', () => {
  it('keeps each trip’s calculations separate and newest first', async () => {
    const ctx = await setup();
    const other = await ctx.trips.create(tripInput({ name: 'Goa', destinations: [] }), { sections: [] });
    await ctx.calculator.add(ctx.trip.id, '12 + 30', '42');
    await ctx.calculator.add(ctx.trip.id, '6 × 7', '42');
    await ctx.calculator.add(other.id, '1 + 1', '2');
    expect((await ctx.calculator.history(ctx.trip.id)).map((h) => h.expression)).toEqual(['6 × 7', '12 + 30']);
    expect((await ctx.calculator.history(other.id)).map((h) => h.expression)).toEqual(['1 + 1']);

    const [first] = await ctx.calculator.history(ctx.trip.id);
    // Removing from another trip's id does nothing.
    await ctx.calculator.remove(other.id, first!.id);
    expect(await ctx.calculator.history(ctx.trip.id)).toHaveLength(2);
    await ctx.calculator.clear(ctx.trip.id);
    expect(await ctx.calculator.history(ctx.trip.id)).toEqual([]);
    expect(await ctx.calculator.history(other.id)).toHaveLength(1);
  });

  it('keeps only the most recent calculations', async () => {
    const ctx = await setup();
    for (let i = 0; i < HISTORY_LIMIT + 5; i++) await ctx.calculator.add(ctx.trip.id, `${i} + 0`, String(i));
    const list = await ctx.calculator.history(ctx.trip.id);
    expect(list).toHaveLength(HISTORY_LIMIT);
    expect(list[0]?.result).toBe(String(HISTORY_LIMIT + 4));
  });

  it('is isolated per account (each account has its own database)', async () => {
    const a = await setup(openTestDatabase());
    const b = await setup(openTestDatabase());
    await a.calculator.add(a.trip.id, '2 + 2', '4');
    expect(await b.calculator.history(b.trip.id)).toEqual([]);
    expect(await b.calculator.history(a.trip.id)).toEqual([]);
  });

  it('a calculation is never an expense', async () => {
    const ctx = await setup();
    await ctx.calculator.add(ctx.trip.id, '1200 + 300', '1500');
    expect((await ctx.expenses.workspace(ctx.trip.id)).expenses).toEqual([]);
  });

  it('is removed with its trip', async () => {
    const ctx = await setup();
    await ctx.calculator.add(ctx.trip.id, '1 + 2', '3');
    await ctx.trips.remove(ctx.trip.id);
    const rows = await ctx.database.getAllAsync<{ n: number }>('SELECT COUNT(*) AS n FROM calculator_history', []);
    expect(rows[0]?.n).toBe(0);
  });
});

describe('expense location', () => {
  it('saves without a location (entire trip) and with a main or nested destination', async () => {
    const ctx = await setup();
    const none = await ctx.expenses.saveExpense(ctx.trip.id, ctx.group(1000));
    const main = await ctx.expenses.saveExpense(ctx.trip.id, ctx.group(2000, { placeNodeId: ctx.kochi }));
    const nested = await ctx.expenses.saveExpense(ctx.trip.id, ctx.personal(500, { placeNodeId: ctx.fortKochi }));
    expect([none.placeNodeId, main.placeNodeId, nested.placeNodeId]).toEqual([null, ctx.kochi, ctx.fortKochi]);
    // The existing destination is referenced; no destination is created.
    expect((await ctx.planner.load(ctx.trip.id)).nodes).toHaveLength(3);
  });

  it('adds a calculated result as an expense with the result as the amount', async () => {
    const ctx = await setup();
    // "Add as expense" from the calculator passes the result ("1234.50") to the normal form.
    const e = await ctx.expenses.saveExpense(ctx.trip.id, ctx.group(123450, { title: 'Taxi', placeNodeId: ctx.munnar }));
    expect(e.amountMinor).toBe(123450);
    expect(e.splits.map((s) => s.minor)).toEqual([61725, 61725]);
  });

  it('changes, keeps or clears the location when editing', async () => {
    const ctx = await setup();
    const e = await ctx.expenses.saveExpense(ctx.trip.id, ctx.group(1000, { placeNodeId: ctx.kochi }));
    // undefined leaves it as it is (e.g. older callers).
    expect((await ctx.expenses.saveExpense(ctx.trip.id, ctx.group(1500), e.id)).placeNodeId).toBe(ctx.kochi);
    expect((await ctx.expenses.saveExpense(ctx.trip.id, ctx.group(1500, { placeNodeId: ctx.munnar }), e.id)).placeNodeId).toBe(ctx.munnar);
    expect((await ctx.expenses.saveExpense(ctx.trip.id, ctx.group(1500, { placeNodeId: null }), e.id)).placeNodeId).toBeNull();
  });

  it('refuses a destination from another trip', async () => {
    const ctx = await setup();
    const other = await ctx.trips.create(tripInput({ name: 'Goa', destinations: [] }), { sections: [] });
    const foreign = (await ctx.planner.addNode(other.id, { name: 'Panaji' })).node.id;
    await expect(ctx.expenses.saveExpense(ctx.trip.id, ctx.group(1000, { placeNodeId: foreign }))).rejects.toThrow(/not part of this trip/);
    expect((await ctx.expenses.workspace(ctx.trip.id)).expenses).toEqual([]);
  });

  it('falls back to “entire trip” when the destination is removed, and cleans up when the expense is deleted', async () => {
    const ctx = await setup();
    const e = await ctx.expenses.saveExpense(ctx.trip.id, ctx.group(1000, { placeNodeId: ctx.munnar }));
    await ctx.planner.removeNode(ctx.munnar, 'withChildren');
    expect((await ctx.expenses.expense(e.id))?.placeNodeId).toBeNull();
    expect((await ctx.expenses.expense(e.id))?.amountMinor).toBe(1000);

    const f = await ctx.expenses.saveExpense(ctx.trip.id, ctx.group(1000, { placeNodeId: ctx.kochi }));
    await ctx.expenses.removeExpense(f.id);
    const left = await ctx.database.getAllAsync<{ n: number }>('SELECT COUNT(*) AS n FROM expense_places', []);
    expect(left[0]?.n).toBe(0);
  });

  it('keeps the location when a shared-trip update rewrites the expense', async () => {
    const ctx = await setup();
    const e = await ctx.expenses.saveExpense(ctx.trip.id, ctx.group(1000, { placeNodeId: ctx.kochi }));
    const { placeNodeId: _unused, tripId: _t, scope: _s, ...remote } = e;
    expect(await ctx.expenses.applyRemote(ctx.trip.id, { kind: 'expense', expense: { ...remote, title: 'Dinner (edited)', updatedAt: '2027-01-01T00:00:00Z' } })).toBe(true);
    const after = await ctx.expenses.expense(e.id);
    expect(after?.title).toBe('Dinner (edited)');
    expect(after?.placeNodeId).toBe(ctx.kochi);
  });

  it('lists main destinations with their nested places for pickers', async () => {
    const ctx = await setup();
    const plan = await ctx.planner.load(ctx.trip.id);
    expect(placeOptions(plan.nodes.map((n) => ({ id: n.id, parentId: n.parentId, name: n.name }))).map((o) => [o.path, o.depth])).toEqual([
      ['Kochi', 0],
      ['Kochi › Fort Kochi', 1],
      ['Munnar', 0],
    ]);
  });
});

describe('financial overview', () => {
  it('rolls nested places into their main destination, lists unassigned spending, and never double counts', async () => {
    const ctx = await setup();
    await ctx.expenses.saveExpense(ctx.trip.id, ctx.group(10000, { placeNodeId: ctx.kochi, category: 'stay' }));
    await ctx.expenses.saveExpense(ctx.trip.id, ctx.group(4000, { placeNodeId: ctx.fortKochi }));
    await ctx.expenses.saveExpense(ctx.trip.id, ctx.personal(1500, { placeNodeId: ctx.fortKochi }));
    await ctx.expenses.saveExpense(ctx.trip.id, ctx.group(3000, { placeNodeId: ctx.munnar, category: 'transport' }));
    await ctx.expenses.saveExpense(ctx.trip.id, ctx.group(2000));
    const [inr] = await overviewOf(ctx);
    expect(inr?.actualMinor).toBe(20500);
    expect(inr?.places.map((p) => [p.name, p.totalMinor, p.ownMinor])).toEqual([
      ['Kochi', 15500, 10000],
      ['Munnar', 3000, 3000],
    ]);
    expect(inr?.places[0]?.children.map((c) => [c.name, c.totalMinor])).toEqual([['Fort Kochi', 5500]]);
    expect(inr?.unassignedMinor).toBe(2000);
    // Main destinations + unassigned = everything recorded, each expense once.
    expect((inr?.places.reduce((a, p) => a + p.totalMinor, 0) ?? 0) + (inr?.unassignedMinor ?? 0)).toBe(inr?.actualMinor);
    expect(inr?.categories.reduce((a, c) => a + c.minor, 0)).toBe(inr?.actualMinor);
    expect([inr?.groupMinor, inr?.personalMinor]).toEqual([19000, 1500]);
    // My spending: half of each group expense + my personal one.
    expect(inr?.myMinor).toBe(9500 + 1500);
    expect(inr?.people.map((p) => [p.name, p.paidMinor, p.shareMinor])).toEqual([
      ['Asha', 19000, 9500],
      ['Ben', 0, 9500],
    ]);
  });

  it('separates the planned budget (estimate) from recorded spending', async () => {
    const ctx = await setup();
    await ctx.expenses.saveBudget(ctx.trip.id, { currency: 'INR', totalMinor: 50000, dailyLimitMinor: null, lines: [] });
    let [inr] = await overviewOf(ctx);
    expect([inr?.plannedMinor, inr?.actualMinor, inr?.remainingGroupMinor]).toEqual([50000, 0, 50000]);
    await ctx.expenses.saveExpense(ctx.trip.id, ctx.group(12000));
    await ctx.expenses.saveExpense(ctx.trip.id, ctx.personal(1000));
    [inr] = await overviewOf(ctx);
    expect([inr?.actualMinor, inr?.remainingGroupMinor, inr?.remainingMineMinor]).toEqual([13000, 38000, 50000 - 7000]);
  });

  it('keeps currencies apart and shows the trip currency first', async () => {
    const ctx = await setup();
    await ctx.expenses.saveExpense(ctx.trip.id, ctx.group(500, { currency: 'USD' }));
    await ctx.expenses.saveExpense(ctx.trip.id, ctx.group(1000));
    expect((await overviewOf(ctx)).map((o) => [o.currency, o.actualMinor])).toEqual([
      ['INR', 1000],
      ['USD', 500],
    ]);
  });
});

describe('existing splits and settlements', () => {
  it('locations change nothing in balances or debts', async () => {
    const ctx = await setup();
    await ctx.expenses.saveExpense(ctx.trip.id, ctx.group(9000, { placeNodeId: ctx.kochi, splitMethod: 'shares', splits: [{ participantId: ctx.asha, value: 1 }, { participantId: ctx.ben, value: 2 }] }));
    await ctx.expenses.saveExpense(ctx.trip.id, ctx.group(1000, { splitMethod: 'percent', splits: [{ participantId: ctx.asha, value: 2500 }, { participantId: ctx.ben, value: 7500 }] }));
    await ctx.expenses.addSettlement(ctx.trip.id, { fromId: ctx.ben, toId: ctx.asha, amountMinor: 2000, currency: 'INR', settledOn: '2026-12-21' });
    const ws = await ctx.expenses.workspace(ctx.trip.id);
    const debts = simplifyDebts(
      balances(
        ws.expenses.map((e) => ({ amountMinor: e.amountMinor, currency: e.currency, paidBy: e.paidBy as string, shares: e.splits })),
        ws.settlements,
      ),
    );
    // Ben's shares: 6000 + 750 = 6750, minus 2000 paid back.
    expect(debts).toEqual([{ fromId: ctx.ben, toId: ctx.asha, amountMinor: 4750, currency: 'INR' }]);
    expect(summarize(ws).debts).toEqual(debts);
  });
});

describe('shared trips', () => {
  const tokens = { randomToken: () => randomBytes(24).toString('base64url'), sha256Hex: async (t: string) => createHash('sha256').update(t).digest('hex') };

  it('never sends personal expenses or locations; a viewer cannot add group expenses', async () => {
    const server = fakeSharingServer();
    const ctx = await setup();
    await ctx.expenses.saveExpense(ctx.trip.id, ctx.group(80000, { title: 'Houseboat', placeNodeId: ctx.kochi }));
    await ctx.expenses.saveExpense(ctx.trip.id, ctx.personal(999, { title: 'Private gift', placeNodeId: ctx.fortKochi }));
    await ctx.calculator.add(ctx.trip.id, '80000 / 2', '40000');
    const owner = { id: 'acct-asha', displayName: 'Asha' };
    const sync = (device: Ctx | Awaited<ReturnType<typeof setupRepositories>>, tripId: string, account: { id: string }) =>
      syncSharedTrip(tripId, { api: server.apiFor(account.id), repo: device.sharing, accountId: account.id, expenses: device.expenses });
    const space = await shareTrip(ctx.trip, owner, { api: server.apiFor(owner.id), repos: ctx });
    await ctx.expenses.enqueueAll(ctx.trip.id);
    await sync(ctx, ctx.trip.id, owner);

    const text = JSON.stringify([...server.records.values()]);
    expect(text).toContain('Houseboat');
    expect(text).not.toContain('Private gift');
    expect(text).not.toContain(ctx.kochi);
    expect(text).not.toContain('80000 / 2');
    // The owner's own view keeps the location after syncing.
    expect((await ctx.expenses.workspace(ctx.trip.id)).expenses.find((e) => e.title === 'Houseboat')?.placeNodeId).toBe(ctx.kochi);

    const viewer = await setupRepositories();
    const { token } = await createInvite(space.cloudTripId, 'viewer', { api: server.apiFor(owner.id), tokens });
    const joined = await joinTrip(token, { id: 'acct-vee', displayName: 'Vee' }, { api: server.apiFor('acct-vee'), repos: viewer });
    await sync(viewer, joined.tripId, { id: 'acct-vee' });
    const ws = await viewer.expenses.workspace(joined.tripId);
    expect(ws.groupReadOnly).toBe(true);
    expect(ws.expenses.map((e) => [e.title, e.placeNodeId])).toEqual([['Houseboat', null]]);
    const me = ws.participants[0]!.id;
    await expect(
      viewer.expenses.saveExpense(joined.tripId, { scope: 'group', title: 'X', amountMinor: 100, currency: 'INR', category: 'food', spentOn: '2026-12-20', paidBy: me, splits: [{ participantId: me, value: 0 }] }),
    ).rejects.toThrow(/view/);
    // Personal expenses still work for a viewer, and stay private.
    await viewer.expenses.saveExpense(joined.tripId, { scope: 'personal', title: 'Viewer snack', amountMinor: 100, currency: 'INR', category: 'food', spentOn: '2026-12-20' });
    expect(await viewer.expenses.enqueueAll(joined.tripId)).toBe(0);
  });
});

describe('travel calculators', () => {
  it('A. fuel: litres and cost, optionally for a round trip', () => {
    expect(fuelEstimate(300, 15, 10500, false)).toEqual({ distanceKm: 300, litres: 20, costMinor: 210000 });
    expect(fuelEstimate(300, 15, 10500, true)).toEqual({ distanceKm: 600, litres: 40, costMinor: 420000 });
    expect(() => fuelEstimate(0, 15, 10500, false)).toThrow();
    expect(() => fuelEstimate(100, 0, 10500, false)).toThrow();
  });

  it('B. accommodation: per room per night × rooms × nights', () => {
    expect(accommodationEstimate(250000, 2, 3)).toBe(1500000);
    expect(() => accommodationEstimate(250000, 0, 3)).toThrow(/rooms/);
    expect(() => accommodationEstimate(0, 1, 3)).toThrow();
  });

  it('C. food: per person per day × people × days', () => {
    expect(foodEstimate(80000, 4, 5)).toBe(1600000);
    expect(() => foodEstimate(80000, 4, 0)).toThrow(/days/);
  });

  it('D. total estimate: subtotals and total, kept apart from recorded expenses', async () => {
    const est = tripEstimate({ fuel: 420000, stay: 1500000, food: 1600000, tolls: 50000, activities: 300000, other: 0 });
    expect(est.totalMinor).toBe(3870000);
    expect(est.lines.find((l) => l.key === 'stay')?.minor).toBe(1500000);
    const plan = estimateAsBudget(est, 'INR', 500000);
    expect(plan).toEqual({
      currency: 'INR',
      totalMinor: 3870000,
      dailyLimitMinor: 500000,
      lines: [
        { category: 'fuel', plannedMinor: 420000 },
        { category: 'stay', plannedMinor: 1500000 },
        { category: 'food', plannedMinor: 1600000 },
        { category: 'tolls', plannedMinor: 50000 },
        { category: 'activities', plannedMinor: 300000 },
      ],
    });
    // Saving it as the plan never creates an expense.
    const ctx = await setup();
    await ctx.expenses.saveBudget(ctx.trip.id, plan);
    const [inr] = await overviewOf(ctx);
    expect([inr?.plannedMinor, inr?.actualMinor]).toEqual([3870000, 0]);
  });

  it('E. per-person splitter uses the existing exact split logic', () => {
    expect(perPerson(10000, 3)).toEqual({ eachMinor: 3333, extra: 1, shares: [3334, 3333, 3333] });
  });

  it('F. distance and time come only from real route data, never a guess', async () => {
    const ctx = await setup();
    const cache = createRemoteCacheRepository(ctx.database);
    const stops = [
      { id: 'a', name: 'Kochi', location: { latitude: 9.93, longitude: 76.26 } },
      { id: 'b', name: 'Munnar', location: { latitude: 10.09, longitude: 77.06 } },
    ];
    const offline = await routeLegs(stops, { cache, fetchImpl: async () => Promise.reject(new Error('offline')) });
    expect(offline.legs[0]).toMatchObject({ meters: null, seconds: null, reason: 'offline' });
    const missing = await routeLegs([stops[0]!, { id: 'c', name: 'No map', location: null }], { cache });
    expect(missing.legs[0]).toMatchObject({ meters: null, reason: 'missing_location' });
    const live = await routeLegs(stops, {
      cache,
      fetchImpl: async () => new Response(JSON.stringify({ code: 'Ok', routes: [{ legs: [{ distance: 125300, duration: 11400 }] }] }), { status: 200 }),
    });
    expect(live.legs[0]).toMatchObject({ meters: 125300, seconds: 11400 });
  });
});

describe('existing data', () => {
  it('upgrading from v15 keeps every trip, expense, split and settlement', async () => {
    const old = openTestDatabase();
    await migrate(old, migrations.slice(0, 15));
    await old.execAsync(`
      INSERT INTO trips (id, name, destination, start_date, end_date, transport_mode, category, created_at, updated_at) VALUES ('t1', 'Old trip', 'Kochi', '2026-01-01', '2026-01-05', 'car', 'leisure', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
      INSERT INTO expense_participants (id, trip_id, name, is_me, position, created_at, updated_at) VALUES ('p1', 't1', 'Me', 1, 0, 'x', 'x'), ('p2', 't1', 'You', 0, 1, 'x', 'x');
      INSERT INTO expenses (id, trip_id, scope, title, amount_minor, currency, spent_on, paid_by, created_at, updated_at) VALUES ('e1', 't1', 'group', 'Old dinner', 2000, 'INR', '2026-01-02', 'p1', 'x', 'x');
      INSERT INTO expense_splits (expense_id, participant_id, share_minor) VALUES ('e1', 'p1', 1000), ('e1', 'p2', 1000);
      INSERT INTO expense_settlements (id, trip_id, from_id, to_id, amount_minor, currency, settled_on, created_at, updated_at) VALUES ('s1', 't1', 'p2', 'p1', 500, 'INR', '2026-01-03', 'x', 'x');
    `);
    await migrate(old, migrations);
    const repos = await setupRepositories(old);
    const ws = await repos.expenses.workspace('t1');
    expect(ws.expenses.map((e) => [e.title, e.amountMinor, e.placeNodeId, e.splits.map((s) => s.minor)])).toEqual([['Old dinner', 2000, null, [1000, 1000]]]);
    expect(ws.settlements.map((s) => s.amountMinor)).toEqual([500]);
    const [inr] = financialOverview(ws, []);
    expect([inr?.actualMinor, inr?.unassignedMinor]).toEqual([2000, 2000]);
  });
});
