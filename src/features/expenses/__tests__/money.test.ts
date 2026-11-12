import {
  allocate,
  balances,
  formatMoney,
  minorToInput,
  MoneyError,
  parseAmount,
  parsePercent,
  simplifyDebts,
  splitAmount,
  type GroupExpense,
} from '../money';
import { budgetSummary, categoryMeta, fuelCostMinor, fuelLitres, parseDecimal, perPerson, travelCost } from '../planning';

describe('amounts in minor units', () => {
  it('parses what people type, per currency, without guessing', () => {
    expect(parseAmount('1,250.50', 'INR')).toEqual({ ok: true, minor: 125050 });
    expect(parseAmount('99.9', 'USD')).toEqual({ ok: true, minor: 9990 });
    expect(parseAmount('1500', 'JPY')).toEqual({ ok: true, minor: 1500 });
    expect(parseAmount('1.5', 'JPY')).toMatchObject({ ok: false, error: expect.stringMatching(/no decimal/) });
    expect(parseAmount('1.234', 'KWD')).toEqual({ ok: true, minor: 1234 });
    expect(parseAmount('1.234', 'INR')).toMatchObject({ ok: false });
    expect(parseAmount('-5', 'INR')).toMatchObject({ ok: false });
    expect(parseAmount('12abc', 'INR')).toMatchObject({ ok: false });
    expect(parseAmount('', 'INR')).toMatchObject({ ok: false });
    expect(parseAmount('99999999999', 'INR')).toMatchObject({ ok: false, error: expect.stringMatching(/too large/) });
    expect(minorToInput(125005, 'INR')).toBe('1250.05');
    expect(minorToInput(1500, 'JPY')).toBe('1500');
    expect(formatMoney(-125050, 'INR')).toMatch(/^−.*1,250\.50$/);
    expect(formatMoney(100, 'XYZ')).toMatch(/1\.00/);
  });
});

describe('splitting', () => {
  it('always adds up exactly, giving leftover units to the largest remainders', () => {
    expect(allocate(1000, [1, 1, 1])).toEqual([334, 333, 333]);
    expect(allocate(1, [1, 1, 1])).toEqual([1, 0, 0]);
    expect(allocate(1000, [2, 1])).toEqual([667, 333]);
    for (let total = 1; total < 500; total += 7) {
      for (const weights of [[1, 1, 1], [3333, 3333, 3334], [5, 0, 2], [1, 2, 3, 4, 5, 6, 7]]) {
        expect(allocate(total, weights).reduce((a, b) => a + b, 0)).toBe(total);
      }
    }
  });

  it('supports equal, exact, percentage and share splits with clear errors', () => {
    const p = (ids: string[], values: number[] = ids.map(() => 0)) => ids.map((participantId, i) => ({ participantId, value: values[i] as number }));
    expect(splitAmount(10000, 'equal', p(['a', 'b', 'c'])).map((s) => s.minor)).toEqual([3334, 3333, 3333]);
    expect(splitAmount(10000, 'exact', p(['a', 'b'], [7000, 3000])).map((s) => s.minor)).toEqual([7000, 3000]);
    expect(() => splitAmount(10000, 'exact', p(['a', 'b'], [7000, 2000]))).toThrow(/left to assign/);
    expect(() => splitAmount(10000, 'exact', p(['a', 'b'], [7000, 4000]))).toThrow(/too much/);
    expect(splitAmount(10000, 'percent', p(['a', 'b', 'c'], [5000, 2500, 2500])).map((s) => s.minor)).toEqual([5000, 2500, 2500]);
    expect(splitAmount(100, 'percent', p(['a', 'b', 'c'], [3333, 3333, 3334])).map((s) => s.minor)).toEqual([33, 33, 34]);
    expect(() => splitAmount(10000, 'percent', p(['a', 'b'], [5000, 4000]))).toThrow(/90%, not 100%/);
    expect(splitAmount(9000, 'shares', p(['a', 'b'], [2, 1])).map((s) => s.minor)).toEqual([6000, 3000]);
    expect(() => splitAmount(9000, 'shares', p(['a', 'b'], [0, 0]))).toThrow(/at least one/);
    expect(() => splitAmount(0, 'equal', p(['a']))).toThrow(MoneyError);
    expect(() => splitAmount(100, 'equal', [])).toThrow(/who shared/);
    expect(() => splitAmount(100, 'equal', p(['a', 'a']))).toThrow(/only once/);
    expect(parsePercent('33.33')).toBe(3333);
    expect(parsePercent('100')).toBe(10000);
    expect(parsePercent('100.01')).toBeNull();
    expect(parsePercent('abc')).toBeNull();
  });
});

describe('balances and simplified debts', () => {
  const expense = (paidBy: string, amount: number, ids: string[], currency = 'INR'): GroupExpense => ({
    amountMinor: amount,
    currency,
    paidBy,
    shares: splitAmount(amount, 'equal', ids.map((participantId) => ({ participantId, value: 0 }))),
  });

  it('keeps each currency separate, sums to zero and counts settlements', () => {
    const net = balances(
      [expense('asha', 9000, ['asha', 'ben', 'cy']), expense('ben', 3000, ['asha', 'ben', 'cy']), expense('cy', 2000, ['asha', 'cy'], 'USD')],
      [{ fromId: 'cy', toId: 'asha', amountMinor: 1000, currency: 'INR' }],
    );
    expect(Object.fromEntries(net.get('INR')!)).toEqual({ asha: 4000, ben: -1000, cy: -3000 });
    expect(Object.fromEntries(net.get('USD')!)).toEqual({ cy: 1000, asha: -1000 });
    for (const book of net.values()) expect([...book.values()].reduce((a, b) => a + b, 0)).toBe(0);
  });

  it('settles everyone with at most n−1 exact payments per currency', () => {
    const people = ['a', 'b', 'c', 'd', 'e'];
    const expenses = [expense('a', 10001, people), expense('b', 7003, ['b', 'c', 'd']), expense('e', 999, ['a', 'e']), expense('c', 500, people, 'EUR')];
    const net = balances(expenses, []);
    const debts = simplifyDebts(net);
    for (const currency of net.keys()) {
      const mine = debts.filter((d) => d.currency === currency);
      expect(mine.length).toBeLessThanOrEqual(net.get(currency)!.size - 1);
      // Paying the debts brings every balance to zero.
      const after = balances(expenses, debts);
      for (const v of after.get(currency)!.values()) expect(v).toBe(0);
    }
    expect(debts.every((d) => d.amountMinor > 0 && Number.isInteger(d.amountMinor))).toBe(true);
    expect(simplifyDebts(balances([], []))).toEqual([]);
  });
});

describe('budgets and calculators', () => {
  it('compares planned and actual by total, category and day with warnings', () => {
    const items = [
      { amountMinor: 3000, currency: 'INR', category: 'food', spentOn: '2026-12-20' },
      { amountMinor: 1500, currency: 'INR', category: 'fuel', spentOn: '2026-12-20' },
      { amountMinor: 500, currency: 'INR', category: 'food', spentOn: '2026-12-21' },
      { amountMinor: 99, currency: 'USD', category: 'food', spentOn: '2026-12-21' },
    ];
    const plan = { currency: 'INR', totalMinor: 5000, dailyLimitMinor: 4000, lines: [{ category: 'food', plannedMinor: 3000 }, { category: 'stay', plannedMinor: 1000 }] };
    const s = budgetSummary(items, plan, 'INR', '2026-12-20');
    expect(s.spentMinor).toBe(5000);
    expect(s.total).toEqual({ plannedMinor: 5000, level: 'near', remainingMinor: 0 });
    expect(s.categories.find((c) => c.category === 'food')).toMatchObject({ actualMinor: 3500, level: 'over' });
    expect(s.categories.find((c) => c.category === 'stay')).toMatchObject({ actualMinor: 0, level: 'ok' });
    expect(s.categories.find((c) => c.category === 'fuel')).toMatchObject({ plannedMinor: null, level: null });
    expect(s.days).toEqual([
      { date: '2026-12-21', actualMinor: 500, level: 'ok' },
      { date: '2026-12-20', actualMinor: 4500, level: 'over' },
    ]);
    expect(s.today).toEqual({ actualMinor: 4500, limitMinor: 4000, level: 'over', remainingMinor: -500 });
    expect(budgetSummary(items, null, 'USD', null).spentMinor).toBe(99);
    expect(categoryMeta('custom:x', [{ id: 'x', name: 'Souvenirs' }]).label).toBe('Souvenirs');
  });

  it('computes fuel, per-person and travel costs exactly', () => {
    expect(fuelLitres(300, { unit: 'km_per_l', value: 15 })).toBe(20);
    expect(fuelLitres(300, { unit: 'l_per_100km', value: 6.5 })).toBe(19.5);
    expect(fuelCostMinor(300, { unit: 'km_per_l', value: 15 }, 10250)).toEqual({ litres: 20, costMinor: 205000 });
    expect(() => fuelCostMinor(0, { unit: 'km_per_l', value: 15 }, 100)).toThrow();
    expect(perPerson(1000, 3)).toEqual({ eachMinor: 333, extra: 1, shares: [334, 333, 333] });
    expect(() => perPerson(1000, 0)).toThrow();
    expect(travelCost({ fuelMinor: 205000, tollsMinor: 30000, parkingMinor: 5000, otherMinor: 0, people: 4, distanceKm: 300 }, 'INR')).toMatchObject({
      totalMinor: 240000,
      eachMinor: 60000,
      perKmMinor: 800,
    });
    expect(parseDecimal('12.5')).toBe(12.5);
    expect(parseDecimal('-1')).toBeNull();
  });
});
