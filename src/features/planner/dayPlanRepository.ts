import type { Database } from '@/db/types';

export interface PlannedDay {
  nodeId: string;
  /** YYYY-MM-DD, when known. */
  date: string | null;
  /** Day 1, 2, … of the trip, when known. */
  dayNumber: number | null;
}

const isDate = (v: string | null | undefined): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** Which day each destination is planned for (local; set by PDF import or by hand). */
export function createDayPlanRepository(db: Database, deps: { now?: () => Date } = {}) {
  const now = deps.now ?? (() => new Date());
  return {
    async list(tripId: string): Promise<PlannedDay[]> {
      const rows = await db.getAllAsync<{ node_id: string; day_date: string | null; day_number: number | null }>(
        'SELECT node_id, day_date, day_number FROM plan_node_days WHERE trip_id = ? ORDER BY day_number, day_date',
        [tripId],
      );
      return rows.map((r) => ({ nodeId: r.node_id, date: r.day_date, dayNumber: r.day_number }));
    },
    async set(tripId: string, nodeId: string, day: { date?: string | null; dayNumber?: number | null }): Promise<void> {
      const date = isDate(day.date) ? day.date : null;
      const n = typeof day.dayNumber === 'number' && day.dayNumber >= 1 && day.dayNumber <= 366 ? Math.floor(day.dayNumber) : null;
      if (!date && n === null) {
        await db.runAsync('DELETE FROM plan_node_days WHERE node_id = ?', [nodeId]);
        return;
      }
      await db.runAsync(
        `INSERT INTO plan_node_days (node_id, trip_id, day_date, day_number, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (node_id) DO UPDATE SET day_date = excluded.day_date, day_number = excluded.day_number, updated_at = excluded.updated_at`,
        [nodeId, tripId, date, n, now().toISOString()],
      );
    },
  };
}

export type DayPlanRepository = ReturnType<typeof createDayPlanRepository>;

/** Date of trip day N (1-based) from the trip's start date. */
export function dateOfDay(startDate: string, dayNumber: number): string {
  const d = new Date(`${startDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dayNumber - 1);
  return d.toISOString().slice(0, 10);
}
