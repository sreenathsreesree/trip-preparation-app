import type { Database } from '@/db/types';
import type { IdFactory } from '@/lib/id';

import type { StarterItem } from '../preparation/templates';
import {
  isTransportMode,
  isTripCategory,
  type NewTripInput,
  type Trip,
  type TripSummary,
} from './model';

interface TripRow {
  id: string;
  name: string;
  destination: string;
  start_date: string;
  end_date: string;
  adults: number;
  children: number;
  transport_mode: string;
  category: string;
  created_at: string;
  updated_at: string;
}

interface TripSummaryRow extends TripRow {
  total_items: number;
  done_items: number;
}

export class TripDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TripDataError';
  }
}

function mapTrip(row: TripRow): Trip {
  if (!isTransportMode(row.transport_mode) || !isTripCategory(row.category)) {
    throw new TripDataError(`Trip "${row.id}" has an unrecognised transport mode or category.`);
  }
  return {
    id: row.id,
    name: row.name,
    destination: row.destination,
    startDate: row.start_date,
    endDate: row.end_date,
    travellers: { adults: row.adults, children: row.children },
    transportMode: row.transport_mode,
    category: row.category,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapSummary(row: TripSummaryRow): TripSummary {
  return {
    ...mapTrip(row),
    progress: { total: Number(row.total_items) || 0, done: Number(row.done_items) || 0 },
  };
}

const SUMMARY_SELECT = `
  SELECT t.*,
         COUNT(p.id) AS total_items,
         COALESCE(SUM(p.is_done), 0) AS done_items
  FROM trips t
  LEFT JOIN prep_items p ON p.trip_id = t.id
`;

export interface CreateTripOptions {
  starterItems?: readonly StarterItem[];
}

export interface TripRepository {
  list(): Promise<TripSummary[]>;
  getById(id: string): Promise<TripSummary | null>;
  create(input: NewTripInput, options?: CreateTripOptions): Promise<TripSummary>;
  remove(id: string): Promise<boolean>;
  count(): Promise<number>;
}

export function createTripRepository(
  db: Database,
  deps: { createId: IdFactory; now?: () => Date },
): TripRepository {
  const now = deps.now ?? (() => new Date());

  async function getById(id: string): Promise<TripSummary | null> {
    const row = await db.getFirstAsync<TripSummaryRow>(
      `${SUMMARY_SELECT} WHERE t.id = ? GROUP BY t.id`,
      [id],
    );
    return row ? mapSummary(row) : null;
  }

  return {
    async list() {
      const rows = await db.getAllAsync<TripSummaryRow>(
        `${SUMMARY_SELECT} GROUP BY t.id ORDER BY t.start_date ASC, t.created_at ASC`,
        [],
      );
      return rows.map(mapSummary);
    },

    getById,

    async create(input, options = {}) {
      const id = deps.createId();
      const timestamp = now().toISOString();
      const starterItems = options.starterItems ?? [];

      await db.withTransactionAsync(async () => {
        await db.runAsync(
          `INSERT INTO trips (id, name, destination, start_date, end_date, adults, children,
                              transport_mode, category, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            id,
            input.name,
            input.destination,
            input.startDate,
            input.endDate,
            input.travellers.adults,
            input.travellers.children,
            input.transportMode,
            input.category,
            timestamp,
            timestamp,
          ],
        );

        const positions = new Map<string, number>();
        for (const item of starterItems) {
          const position = positions.get(item.section) ?? 0;
          positions.set(item.section, position + 1);
          await db.runAsync(
            `INSERT INTO prep_items (id, trip_id, section, title, is_done, position, created_at, updated_at)
             VALUES (?, ?, ?, ?, 0, ?, ?, ?)`,
            [deps.createId(), id, item.section, item.title, position, timestamp, timestamp],
          );
        }
      });

      const created = await getById(id);
      if (!created) {
        throw new TripDataError('The trip was saved but could not be read back.');
      }
      return created;
    },

    async remove(id) {
      // prep_items rows are removed by ON DELETE CASCADE.
      const result = await db.runAsync('DELETE FROM trips WHERE id = ?', [id]);
      return result.changes > 0;
    },

    async count() {
      const row = await db.getFirstAsync<{ count: number }>('SELECT COUNT(*) AS count FROM trips', []);
      return row?.count ?? 0;
    },
  };
}
