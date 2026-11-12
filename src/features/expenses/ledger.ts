import type { Workspace } from './expenseRepository';
import { balances, simplifyDebts, type Debt } from './money';
import type { SpendItem } from './planning';

/**
 * Derived numbers for the Trip Calculator screens (pure). Group and personal
 * spending are reported separately; balances and debts use group expenses and
 * settlements only.
 */

/** The trip to highlight: one happening now, else the next upcoming, else the most recent. */
export function pickActiveTrip<T extends { id: string; startDate: string; endDate: string; archivedAt?: string | null }>(trips: readonly T[], today: string): T | null {
  const live = trips.filter((t) => !t.archivedAt);
  const ongoing = live.filter((t) => t.startDate <= today && today <= t.endDate).sort((a, b) => a.startDate.localeCompare(b.startDate));
  if (ongoing[0]) return ongoing[0];
  const upcoming = live.filter((t) => t.startDate > today).sort((a, b) => a.startDate.localeCompare(b.startDate));
  if (upcoming[0]) return upcoming[0];
  return [...live].sort((a, b) => b.endDate.localeCompare(a.endDate))[0] ?? null;
}

export interface CurrencyTotals {
  currency: string;
  /** All group spending of the trip. */
  groupMinor: number;
  /** This user's spending: their share of group expenses plus personal expenses. */
  myMinor: number;
  personalMinor: number;
}

export interface LedgerSummary {
  totals: CurrencyTotals[];
  net: Map<string, Map<string, number>>;
  debts: Debt[];
  /** Spend items for budgets: group spending (shared budget). */
  groupItems: SpendItem[];
  /** Spend items for "my" view: my shares and personal expenses. */
  myItems: SpendItem[];
  meId: string | null;
}

export function summarize(ws: Workspace): LedgerSummary {
  const me = ws.participants.find((p) => p.isMe) ?? null;
  const group = ws.expenses.filter((e) => e.scope === 'group' && e.paidBy);
  const personal = ws.expenses.filter((e) => e.scope === 'personal');
  const net = balances(
    group.map((e) => ({ amountMinor: e.amountMinor, currency: e.currency, paidBy: e.paidBy as string, shares: e.splits })),
    ws.settlements,
  );
  const groupItems: SpendItem[] = group.map((e) => ({ amountMinor: e.amountMinor, currency: e.currency, category: e.category, spentOn: e.spentOn }));
  const myItems: SpendItem[] = [
    ...personal.map((e) => ({ amountMinor: e.amountMinor, currency: e.currency, category: e.category, spentOn: e.spentOn })),
    ...(me
      ? group
          .map((e) => ({ e, share: e.splits.find((s) => s.participantId === me.id)?.minor ?? 0 }))
          .filter(({ share }) => share > 0)
          .map(({ e, share }) => ({ amountMinor: share, currency: e.currency, category: e.category, spentOn: e.spentOn }))
      : []),
  ];
  const currencies = [...new Set([...groupItems, ...myItems].map((i) => i.currency))].sort();
  const sum = (items: readonly SpendItem[], c: string) => items.filter((i) => i.currency === c).reduce((a, i) => a + i.amountMinor, 0);
  return {
    totals: currencies.map((currency) => ({
      currency,
      groupMinor: sum(groupItems, currency),
      myMinor: sum(myItems, currency),
      personalMinor: personal.filter((e) => e.currency === currency).reduce((a, e) => a + e.amountMinor, 0),
    })),
    net,
    debts: simplifyDebts(net),
    groupItems,
    myItems,
    meId: me?.id ?? null,
  };
}

/** Straight-line route length (km) between consecutive route stops that have coordinates. */
export function routeDistanceKm(points: readonly ({ latitude: number; longitude: number } | null)[]): { km: number; legs: number; missing: number } {
  const R = 6371;
  const rad = (d: number) => (d * Math.PI) / 180;
  let km = 0;
  let legs = 0;
  let missing = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (!a || !b) {
      missing += 1;
      continue;
    }
    const h = Math.sin(rad(b.latitude - a.latitude) / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(rad(b.longitude - a.longitude) / 2) ** 2;
    km += 2 * R * Math.asin(Math.sqrt(h));
    legs += 1;
  }
  return { km: Math.round(km * 10) / 10, legs, missing };
}
