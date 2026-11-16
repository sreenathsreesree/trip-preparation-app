import type { Database } from '@/db/types';

/** One finished calculation in a trip's quick calculator (never an expense by itself). */
export interface CalcHistoryEntry {
  id: string;
  tripId: string;
  expression: string;
  result: string;
  createdAt: string;
}

/** Calculations kept per trip; older ones are dropped. */
export const HISTORY_LIMIT = 50;

export interface CalculatorRepository {
  history(tripId: string): Promise<CalcHistoryEntry[]>;
  add(tripId: string, expression: string, result: string): Promise<CalcHistoryEntry>;
  remove(tripId: string, id: string): Promise<void>;
  clear(tripId: string): Promise<void>;
}

export function createCalculatorRepository(db: Database, deps: { createId: () => string; now?: () => Date }): CalculatorRepository {
  const now = deps.now ?? (() => new Date());
  const map = (r: { id: string; trip_id: string; expression: string; result: string; created_at: string }): CalcHistoryEntry => ({
    id: r.id,
    tripId: r.trip_id,
    expression: r.expression,
    result: r.result,
    createdAt: r.created_at,
  });
  return {
    async history(tripId) {
      const rows = await db.getAllAsync<Parameters<typeof map>[0]>(
        'SELECT * FROM calculator_history WHERE trip_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?',
        [tripId, HISTORY_LIMIT],
      );
      return rows.map(map);
    },
    async add(tripId, expression, result) {
      const expr = expression.trim().slice(0, 200);
      const res = result.trim().slice(0, 40);
      if (!expr || !res) throw new Error('Nothing to save.');
      const id = deps.createId();
      const at = now().toISOString();
      await db.withTransactionAsync(async () => {
        await db.runAsync('INSERT INTO calculator_history (id, trip_id, expression, result, created_at) VALUES (?, ?, ?, ?, ?)', [id, tripId, expr, res, at]);
        await db.runAsync(
          `DELETE FROM calculator_history WHERE trip_id = ? AND id NOT IN (
             SELECT id FROM calculator_history WHERE trip_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?)`,
          [tripId, tripId, HISTORY_LIMIT],
        );
      });
      return { id, tripId, expression: expr, result: res, createdAt: at };
    },
    async remove(tripId, id) {
      await db.runAsync('DELETE FROM calculator_history WHERE id = ? AND trip_id = ?', [id, tripId]);
    },
    async clear(tripId) {
      await db.runAsync('DELETE FROM calculator_history WHERE trip_id = ?', [tripId]);
    },
  };
}
