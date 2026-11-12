import { setupRepositories, tripInput } from '../../../../test/fixtures';
import { pickActiveTrip, routeDistanceKm, summarize } from '../ledger';
import { balances, simplifyDebts } from '../money';

async function setup() {
  const repos = await setupRepositories();
  const trip = await repos.trips.create(
    tripInput({ name: 'Kerala', destinations: [], travellers: [{ name: 'Asha', kind: 'adult' }, { name: 'Ben', kind: 'adult' }, { name: 'Cy', kind: 'adult' }] }),
    { sections: [] },
  );
  await repos.expenses.ensureParticipants(trip.id);
  const ws = await repos.expenses.workspace(trip.id);
  const [asha, ben, cy] = ws.participants.map((p) => p.id) as [string, string, string];
  const group = (amountMinor: number, paidBy: string, ids: string[], extra: Record<string, unknown> = {}) => ({
    scope: 'group' as const,
    title: 'Dinner',
    amountMinor,
    currency: 'INR',
    category: 'food',
    spentOn: '2026-12-20',
    paidBy,
    splitMethod: 'equal' as const,
    splits: ids.map((participantId) => ({ participantId, value: 0 })),
    ...extra,
  });
  const linkShared = (role: 'owner' | 'editor' | 'viewer') =>
    repos.sharing.linkSpace({ tripId: trip.id, cloudTripId: 'cloud-1', accountId: 'acct', role: role === 'viewer' ? 'viewer' : role, displayName: 'Asha' });
  return { ...repos, trip, asha, ben, cy, group, linkShared };
}

const groupBooks = async (ctx: Awaited<ReturnType<typeof setup>>) => {
  const ws = await ctx.expenses.workspace(ctx.trip.id);
  return balances(
    ws.expenses.filter((e) => e.scope === 'group').map((e) => ({ amountMinor: e.amountMinor, currency: e.currency, paidBy: e.paidBy as string, shares: e.splits })),
    ws.settlements,
  );
};

describe('trip expense workspace', () => {
  it('seeds participants from travellers once, with the first as “me”', async () => {
    const ctx = await setup();
    await ctx.expenses.ensureParticipants(ctx.trip.id);
    const ws = await ctx.expenses.workspace(ctx.trip.id);
    expect(ws.participants.map((p) => [p.name, p.isMe])).toEqual([
      ['Asha', true],
      ['Ben', false],
      ['Cy', false],
    ]);
    expect(ws.currency).toBe('INR');
    await expect(ctx.expenses.addParticipant(ctx.trip.id, ' ben ')).rejects.toThrow(/already/);
    await ctx.expenses.setMe(ctx.trip.id, ctx.ben);
    expect((await ctx.expenses.workspace(ctx.trip.id)).participants.filter((p) => p.isMe).map((p) => p.name)).toEqual(['Ben']);
  });

  it('stores exact splits and validates every input', async () => {
    const ctx = await setup();
    const e = await ctx.expenses.saveExpense(ctx.trip.id, ctx.group(10000, ctx.asha, [ctx.asha, ctx.ben, ctx.cy]));
    expect(e.splits.map((s) => s.minor)).toEqual([3334, 3333, 3333]);
    const pct = await ctx.expenses.saveExpense(
      ctx.trip.id,
      ctx.group(10000, ctx.ben, [], { splitMethod: 'percent', splits: [{ participantId: ctx.asha, value: 6000 }, { participantId: ctx.ben, value: 4000 }] }),
    );
    expect(pct.splits.map((s) => [s.minor, s.inputValue])).toEqual([
      [6000, 6000],
      [4000, 4000],
    ]);
    await expect(ctx.expenses.saveExpense(ctx.trip.id, ctx.group(10000, ctx.asha, [], { splitMethod: 'exact', splits: [{ participantId: ctx.asha, value: 5000 }] }))).rejects.toThrow(/left to assign/);
    await expect(ctx.expenses.saveExpense(ctx.trip.id, ctx.group(10000, 'nobody', [ctx.asha]))).rejects.toThrow(/who paid/);
    await expect(ctx.expenses.saveExpense(ctx.trip.id, ctx.group(10000, ctx.asha, ['stranger']))).rejects.toThrow(/not in this trip/);
    await expect(ctx.expenses.saveExpense(ctx.trip.id, ctx.group(0, ctx.asha, [ctx.asha]))).rejects.toThrow(/more than zero/);
    await expect(ctx.expenses.saveExpense(ctx.trip.id, ctx.group(100, ctx.asha, [ctx.asha], { currency: 'rupees' }))).rejects.toThrow(/3-letter/);
    await expect(ctx.expenses.saveExpense(ctx.trip.id, ctx.group(100, ctx.asha, [ctx.asha], { spentOn: '2026-02-31x' }))).rejects.toThrow(/valid date/);
    await expect(ctx.expenses.saveExpense(ctx.trip.id, ctx.group(100, ctx.asha, [ctx.asha], { category: 'custom:none' }))).rejects.toThrow(/no longer exists/);

    // Editing replaces the split.
    const edited = await ctx.expenses.saveExpense(ctx.trip.id, ctx.group(9000, ctx.asha, [ctx.asha, ctx.ben]), e.id);
    expect(edited.splits.map((s) => s.minor)).toEqual([4500, 4500]);
  });

  it('personal expenses are never split and never touch group balances', async () => {
    const ctx = await setup();
    await ctx.expenses.saveExpense(ctx.trip.id, ctx.group(9000, ctx.asha, [ctx.asha, ctx.ben, ctx.cy]));
    const before = await groupBooks(ctx);
    const personal = await ctx.expenses.saveExpense(ctx.trip.id, { scope: 'personal', title: 'Souvenir', amountMinor: 50000, currency: 'INR', category: 'shopping', spentOn: '2026-12-20', paidBy: ctx.ben, splits: [{ participantId: ctx.ben, value: 0 }] });
    expect(personal).toMatchObject({ paidBy: null, splits: [] });
    expect(await groupBooks(ctx)).toEqual(before);
    expect(simplifyDebts(await groupBooks(ctx))).toEqual([
      { fromId: ctx.ben, toId: ctx.asha, amountMinor: 3000, currency: 'INR' },
      { fromId: ctx.cy, toId: ctx.asha, amountMinor: 3000, currency: 'INR' },
    ]);
  });

  it('records settlements and custom categories', async () => {
    const ctx = await setup();
    await ctx.expenses.saveExpense(ctx.trip.id, ctx.group(9000, ctx.asha, [ctx.asha, ctx.ben, ctx.cy]));
    await ctx.expenses.addSettlement(ctx.trip.id, { fromId: ctx.ben, toId: ctx.asha, amountMinor: 3000, currency: 'INR', settledOn: '2026-12-21' });
    expect(Object.fromEntries((await groupBooks(ctx)).get('INR')!)).toEqual({ [ctx.asha]: 3000, [ctx.ben]: 0, [ctx.cy]: -3000 });
    await expect(ctx.expenses.addSettlement(ctx.trip.id, { fromId: ctx.ben, toId: ctx.ben, amountMinor: 1, currency: 'INR', settledOn: '2026-12-21' })).rejects.toThrow(/two different/);

    const cat = await ctx.expenses.addCategory(ctx.trip.id, 'Souvenirs');
    await expect(ctx.expenses.addCategory(ctx.trip.id, 'souvenirs')).rejects.toThrow(/already exists/);
    await expect(ctx.expenses.addCategory(ctx.trip.id, 'Fuel')).rejects.toThrow(/already exists/);
    const e = await ctx.expenses.saveExpense(ctx.trip.id, ctx.group(100, ctx.asha, [ctx.asha], { category: `custom:${cat.id}` }));
    expect(e.categoryName).toBe('Souvenirs');
    await expect(ctx.expenses.removeCategory(cat.id)).rejects.toThrow(/use this category/);
  });

  it('saves budgets per currency and the default currency', async () => {
    const ctx = await setup();
    await ctx.expenses.saveBudget(ctx.trip.id, { currency: 'INR', totalMinor: 5000000, dailyLimitMinor: 800000, lines: [{ category: 'food', plannedMinor: 1000000 }, { category: 'stay', plannedMinor: 0 }] });
    await ctx.expenses.saveBudget(ctx.trip.id, { currency: 'USD', totalMinor: 30000, dailyLimitMinor: null, lines: [] });
    await ctx.expenses.setCurrency(ctx.trip.id, 'USD');
    const ws = await ctx.expenses.workspace(ctx.trip.id);
    expect(ws.currency).toBe('USD');
    expect(ws.budgets.map((b) => [b.currency, b.totalMinor, b.lines.length])).toEqual([
      ['INR', 5000000, 1],
      ['USD', 30000, 0],
    ]);
    await expect(ctx.expenses.saveBudget(ctx.trip.id, { currency: 'INR', totalMinor: -1, dailyLimitMinor: null, lines: [] })).rejects.toThrow(/negative/);
  });

  it('viewers of a shared trip can add personal expenses but cannot change group records', async () => {
    const ctx = await setup();
    const e = await ctx.expenses.saveExpense(ctx.trip.id, ctx.group(9000, ctx.asha, [ctx.asha, ctx.ben]));
    await ctx.linkShared('viewer');
    expect((await ctx.expenses.workspace(ctx.trip.id)).groupReadOnly).toBe(true);
    await expect(ctx.expenses.saveExpense(ctx.trip.id, ctx.group(100, ctx.asha, [ctx.asha]))).rejects.toThrow(/view this shared trip/);
    await expect(ctx.expenses.saveExpense(ctx.trip.id, ctx.group(100, ctx.asha, [ctx.asha]), e.id)).rejects.toThrow(/view/);
    await expect(ctx.expenses.removeExpense(e.id)).rejects.toThrow(/view/);
    await expect(ctx.expenses.addSettlement(ctx.trip.id, { fromId: ctx.ben, toId: ctx.asha, amountMinor: 1, currency: 'INR', settledOn: '2026-12-21' })).rejects.toThrow(/view/);
    await expect(ctx.expenses.saveBudget(ctx.trip.id, { currency: 'INR', totalMinor: 1, dailyLimitMinor: null, lines: [] })).rejects.toThrow(/view/);
    await expect(ctx.expenses.saveExpense(ctx.trip.id, { scope: 'personal', title: 'Tea', amountMinor: 2000, currency: 'INR', category: 'food', spentOn: '2026-12-20' })).resolves.toBeTruthy();
  });

  it('queues only group records of shared trips; personal expenses never, unless withdrawing a former group one', async () => {
    const ctx = await setup();
    const g = await ctx.expenses.saveExpense(ctx.trip.id, ctx.group(9000, ctx.asha, [ctx.asha, ctx.ben]));
    const p = await ctx.expenses.saveExpense(ctx.trip.id, { scope: 'personal', title: 'Tea', amountMinor: 2000, currency: 'INR', category: 'food', spentOn: '2026-12-20' });
    expect(await ctx.expenses.enqueue(ctx.trip.id, 'expense', g.id)).toBe(false); // not shared yet
    await ctx.linkShared('owner');
    expect(await ctx.expenses.enqueue(ctx.trip.id, 'expense', p.id)).toBe(false);
    expect(await ctx.expenses.enqueueAll(ctx.trip.id)).toBe(4); // 3 participants + 1 group expense
    expect((await ctx.expenses.dueOutbox(ctx.trip.id, new Date('2100-01-01'))).map((o) => o.kind)).toEqual(['participant', 'participant', 'participant', 'expense']);
    expect(await ctx.expenses.enqueue(ctx.trip.id, 'expense', p.id, { withdrawal: true })).toBe(true);
  });

  it('applies records pulled from the shared trip, but never over an unsent local change', async () => {
    const ctx = await setup();
    await ctx.linkShared('editor');
    const remote = {
      id: 'remote-1',
      title: 'Boat',
      amountMinor: 6000,
      currency: 'INR',
      category: 'custom:cat-x',
      categoryName: 'Boating',
      spentOn: '2026-12-21',
      paidBy: ctx.ben,
      splitMethod: 'equal' as const,
      splits: [
        { participantId: ctx.asha, minor: 3000, inputValue: 0 },
        { participantId: ctx.ben, minor: 3000, inputValue: 0 },
      ],
      notes: '',
      createdBy: 'acct-ben',
      createdAt: '2026-12-21T10:00:00Z',
      updatedAt: '2026-12-21T10:00:00Z',
    };
    expect(await ctx.expenses.applyRemote(ctx.trip.id, { kind: 'expense', expense: remote })).toBe(true);
    const ws = await ctx.expenses.workspace(ctx.trip.id);
    expect(ws.expenses.map((e) => [e.title, e.scope, e.categoryName])).toEqual([['Boat', 'group', 'Boating']]);
    expect(ws.categories).toEqual([{ id: 'cat-x', name: 'Boating' }]);

    await ctx.expenses.saveExpense(ctx.trip.id, ctx.group(7000, ctx.ben, [ctx.asha, ctx.ben]), 'remote-1');
    await ctx.expenses.enqueue(ctx.trip.id, 'expense', 'remote-1');
    expect(await ctx.expenses.applyRemote(ctx.trip.id, { kind: 'expense', expense: { ...remote, amountMinor: 1 } })).toBe(false);
    expect((await ctx.expenses.expense('remote-1'))?.amountMinor).toBe(7000);

    await ctx.expenses.applyRemote(ctx.trip.id, { kind: 'participant', id: 'p-dee', name: 'Dee', userId: 'acct-dee', archived: false, updatedAt: '2026-12-21T10:00:00Z' });
    expect((await ctx.expenses.workspace(ctx.trip.id)).participants.map((p) => p.name)).toContain('Dee');
  });
});

describe('ledger summary', () => {
  it('separates group and personal spending, counts only my share for “my spending”, per currency', async () => {
    const ctx = await setup();
    await ctx.expenses.saveExpense(ctx.trip.id, ctx.group(9000, ctx.ben, [ctx.asha, ctx.ben, ctx.cy]));
    await ctx.expenses.saveExpense(ctx.trip.id, ctx.group(500, ctx.asha, [ctx.asha], { currency: 'USD' }));
    await ctx.expenses.saveExpense(ctx.trip.id, { scope: 'personal', title: 'Tea', amountMinor: 2000, currency: 'INR', category: 'food', spentOn: '2026-12-20' });
    const s = summarize(await ctx.expenses.workspace(ctx.trip.id));
    expect(s.totals).toEqual([
      { currency: 'INR', groupMinor: 9000, myMinor: 3000 + 2000, personalMinor: 2000 },
      { currency: 'USD', groupMinor: 500, myMinor: 500, personalMinor: 0 },
    ]);
    expect(s.debts).toEqual([
      { fromId: ctx.asha, toId: ctx.ben, amountMinor: 3000, currency: 'INR' },
      { fromId: ctx.cy, toId: ctx.ben, amountMinor: 3000, currency: 'INR' },
    ]);

    const t = (id: string, startDate: string, endDate: string, archivedAt: string | null = null) => ({ id, startDate, endDate, archivedAt });
    expect(pickActiveTrip([t('past', '2026-01-01', '2026-01-05'), t('now', '2026-06-01', '2026-06-10'), t('next', '2026-07-01', '2026-07-02')], '2026-06-05')?.id).toBe('now');
    expect(pickActiveTrip([t('past', '2026-01-01', '2026-01-05'), t('next', '2026-07-01', '2026-07-02'), t('later', '2026-09-01', '2026-09-02')], '2026-06-05')?.id).toBe('next');
    expect(pickActiveTrip([t('a', '2026-01-01', '2026-01-05'), t('b', '2026-02-01', '2026-02-05', 'x')], '2026-06-05')?.id).toBe('a');
    expect(routeDistanceKm([{ latitude: 10.0889, longitude: 77.0595 }, null, { latitude: 10.15, longitude: 77.0595 }])).toEqual({ km: 0, legs: 0, missing: 2 });
    expect(routeDistanceKm([{ latitude: 10.0889, longitude: 77.0595 }, { latitude: 10.15, longitude: 77.0595 }]).km).toBeCloseTo(6.8, 1);
  });
});

describe('concurrent loading', () => {
  it('seeds participants once even when two screens load at the same time', async () => {
    const repos = await setupRepositories();
    const trip = await repos.trips.create(tripInput({ name: 'Race', destinations: [], travellers: [{ name: 'Me', kind: 'adult' }] }), { sections: [] });
    await Promise.all([repos.expenses.ensureParticipants(trip.id), repos.expenses.ensureParticipants(trip.id), repos.expenses.ensureParticipants(trip.id)]);
    expect((await repos.expenses.workspace(trip.id)).participants.map((p) => p.name)).toEqual(['Me']);
  });
});
