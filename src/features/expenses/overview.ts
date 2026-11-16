import type { Expense, Workspace } from './expenseRepository';

/**
 * Trip financial overview (pure). Built only from recorded expenses and the
 * saved budget — estimates from the travel tools never appear as actuals.
 *
 * Every expense is counted once, at its full amount: group expenses as the
 * group total, personal expenses as the user's own spending. Destination
 * totals roll nested places up into their main destination; an expense with
 * no location (or whose destination was removed) is listed under "Entire trip".
 */

export interface OverviewNode {
  id: string;
  parentId: string | null;
  name: string;
}

export interface PlaceTotal {
  nodeId: string;
  name: string;
  /** Spending recorded at this place itself. */
  ownMinor: number;
  /** Own spending plus every place inside it. */
  totalMinor: number;
  count: number;
  children: PlaceTotal[];
}

export interface CurrencyOverview {
  currency: string;
  plannedMinor: number | null;
  /** Every recorded expense once: group totals plus personal expenses. */
  actualMinor: number;
  /** Planned − group spending (the trip's shared budget, as on the Budget tab). */
  remainingGroupMinor: number | null;
  /** Planned − my spending (my shares + personal), as on the Budget tab's "Mine" view. */
  remainingMineMinor: number | null;
  groupMinor: number;
  personalMinor: number;
  /** My share of group expenses plus my personal expenses. */
  myMinor: number;
  categories: { category: string; minor: number }[];
  /** Main destinations (with nested places inside). */
  places: PlaceTotal[];
  /** Expenses without a (still existing) location. */
  unassignedMinor: number;
  unassignedCount: number;
  /** Per participant, group expenses only: what they paid and what their share is. */
  people: { participantId: string; name: string; paidMinor: number; shareMinor: number }[];
}

export const UNASSIGNED_LABEL = 'Entire trip / no location';

export function financialOverview(ws: Workspace, nodes: readonly OverviewNode[]): CurrencyOverview[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const me = ws.participants.find((p) => p.isMe) ?? null;
  const currencies = [...new Set([...ws.expenses.map((e) => e.currency), ...ws.budgets.map((b) => b.currency)])];
  currencies.sort((a, b) => (a === ws.currency ? -1 : b === ws.currency ? 1 : a.localeCompare(b)));

  return currencies.map((currency) => {
    const list = ws.expenses.filter((e) => e.currency === currency);
    const group = list.filter((e) => e.scope === 'group');
    const personal = list.filter((e) => e.scope === 'personal');
    const sum = (items: readonly Expense[]) => items.reduce((a, e) => a + e.amountMinor, 0);
    const actual = sum(list);
    const plan = ws.budgets.find((b) => b.currency === currency) ?? null;
    const planned = plan?.totalMinor ?? null;

    const cats = new Map<string, number>();
    for (const e of list) cats.set(e.category, (cats.get(e.category) ?? 0) + e.amountMinor);

    // Destination totals.
    const own = new Map<string, { minor: number; count: number }>();
    let unassignedMinor = 0;
    let unassignedCount = 0;
    for (const e of list) {
      if (e.placeNodeId && byId.has(e.placeNodeId)) {
        const cur = own.get(e.placeNodeId) ?? { minor: 0, count: 0 };
        own.set(e.placeNodeId, { minor: cur.minor + e.amountMinor, count: cur.count + 1 });
      } else {
        unassignedMinor += e.amountMinor;
        unassignedCount += 1;
      }
    }
    const childrenOf = new Map<string | null, OverviewNode[]>();
    for (const n of nodes) {
      const parent = n.parentId && byId.has(n.parentId) ? n.parentId : null;
      childrenOf.set(parent, [...(childrenOf.get(parent) ?? []), n]);
    }
    const build = (n: OverviewNode, depth: number): PlaceTotal | null => {
      const kids = depth > 20 ? [] : (childrenOf.get(n.id) ?? []).map((c) => build(c, depth + 1)).filter((x): x is PlaceTotal => x !== null);
      const mine = own.get(n.id) ?? { minor: 0, count: 0 };
      const total = mine.minor + kids.reduce((a, k) => a + k.totalMinor, 0);
      const count = mine.count + kids.reduce((a, k) => a + k.count, 0);
      if (count === 0) return null;
      return { nodeId: n.id, name: n.name, ownMinor: mine.minor, totalMinor: total, count, children: kids.sort((a, b) => b.totalMinor - a.totalMinor) };
    };
    const places = (childrenOf.get(null) ?? []).map((n) => build(n, 0)).filter((x): x is PlaceTotal => x !== null).sort((a, b) => b.totalMinor - a.totalMinor);

    const people = ws.participants
      .map((p) => ({
        participantId: p.id,
        name: p.name,
        paidMinor: group.filter((e) => e.paidBy === p.id).reduce((a, e) => a + e.amountMinor, 0),
        shareMinor: group.reduce((a, e) => a + (e.splits.find((s) => s.participantId === p.id)?.minor ?? 0), 0),
      }))
      .filter((p) => p.paidMinor > 0 || p.shareMinor > 0);

    const myShare = me ? group.reduce((a, e) => a + (e.splits.find((s) => s.participantId === me.id)?.minor ?? 0), 0) : 0;
    const mine = myShare + sum(personal);
    return {
      currency,
      plannedMinor: planned,
      actualMinor: actual,
      remainingGroupMinor: planned === null ? null : planned - sum(group),
      remainingMineMinor: planned === null ? null : planned - mine,
      groupMinor: sum(group),
      personalMinor: sum(personal),
      myMinor: mine,
      categories: [...cats.entries()].map(([category, minor]) => ({ category, minor })).sort((a, b) => b.minor - a.minor),
      places,
      unassignedMinor,
      unassignedCount,
      people,
    };
  });
}

/** Flattened destination choices for pickers: main destinations first, nested ones indented under them. */
export function placeOptions(nodes: readonly OverviewNode[]): { id: string; name: string; depth: number; path: string }[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const childrenOf = new Map<string | null, OverviewNode[]>();
  for (const n of nodes) {
    const parent = n.parentId && byId.has(n.parentId) ? n.parentId : null;
    childrenOf.set(parent, [...(childrenOf.get(parent) ?? []), n]);
  }
  const out: { id: string; name: string; depth: number; path: string }[] = [];
  const walk = (parent: string | null, depth: number, path: string) => {
    if (depth > 20) return;
    for (const n of childrenOf.get(parent) ?? []) {
      const p = path ? `${path} › ${n.name}` : n.name;
      out.push({ id: n.id, name: n.name, depth, path: p });
      walk(n.id, depth + 1, p);
    }
  };
  walk(null, 0, '');
  return out;
}
