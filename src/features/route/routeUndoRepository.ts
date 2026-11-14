import type { Database } from '@/db/types';

/** The route order saved before an optimisation was applied, so it can be restored. */
export function createRouteUndoRepository(db: Database) {
  return {
    async save(tripId: string, order: readonly string[], at: string): Promise<void> {
      await db.runAsync(
        'INSERT INTO route_undo (trip_id, stop_order, saved_at) VALUES (?, ?, ?) ON CONFLICT (trip_id) DO UPDATE SET stop_order = excluded.stop_order, saved_at = excluded.saved_at',
        [tripId, JSON.stringify(order), at],
      );
    },
    async get(tripId: string): Promise<string[] | null> {
      const row = await db.getFirstAsync<{ stop_order: string }>('SELECT stop_order FROM route_undo WHERE trip_id = ?', [tripId]);
      if (!row) return null;
      try {
        const v: unknown = JSON.parse(row.stop_order);
        return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : null;
      } catch {
        return null;
      }
    },
    async clear(tripId: string): Promise<void> {
      await db.runAsync('DELETE FROM route_undo WHERE trip_id = ?', [tripId]);
    },
  };
}

export type RouteUndoRepository = ReturnType<typeof createRouteUndoRepository>;

/**
 * The full route order after optimising: visited stops keep their places at the
 * front, upcoming stops take the suggested order. Returns null when nothing changes.
 */
export function optimisedOrder(current: readonly string[], visited: ReadonlySet<string>, suggestedUpcoming: readonly string[]): string[] | null {
  const upcoming = current.filter((id) => !visited.has(id));
  if (suggestedUpcoming.length !== upcoming.length || !suggestedUpcoming.every((id) => upcoming.includes(id))) return null;
  if (suggestedUpcoming.every((id, i) => id === upcoming[i])) return null;
  return [...current.filter((id) => visited.has(id)), ...suggestedUpcoming];
}

/** A saved order applied to today's route: stops removed since are dropped, stops added since stay at the end. */
export function restorableOrder(saved: readonly string[], current: readonly string[]): string[] {
  const now = new Set(current);
  const kept = saved.filter((id) => now.has(id));
  return [...kept, ...current.filter((id) => !kept.includes(id))];
}

/**
 * Applies a new order to some stops only (the upcoming main destinations):
 * they take each other's places in the route, and every other stop (visited
 * ones, places inside a destination) keeps its position. Null when nothing changes.
 */
export function reorderSubset(current: readonly string[], subsetOrder: readonly string[]): string[] | null {
  const subset = new Set(subsetOrder);
  const slots = current.map((id, i) => (subset.has(id) ? i : -1)).filter((i) => i >= 0);
  if (slots.length !== subsetOrder.length) return null;
  const next = [...current];
  slots.forEach((slot, k) => {
    next[slot] = subsetOrder[k] as string;
  });
  return next.every((id, i) => id === current[i]) ? null : next;
}
