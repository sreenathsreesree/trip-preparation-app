import type { Database, SqlValue } from '@/db/types';
import type { IdFactory } from '@/lib/id';

import { closeTripReservations, copyPacking, revalidateTripReservations } from '../packing/packingRepository';
import { copyPlan, seedPlan } from '../planner/plannerRepository';
import { copyChecklist, insertPlan } from '../preparation/checklistRepository';
import { tripOwner, type ChecklistPlan } from '../preparation/model';
import { statsFromRow } from '../preparation/readiness';
import {
  copyName,
  countTravellers,
  isTransportMode,
  isTravellerKind,
  isTripCategory,
  type Destination,
  type Traveller,
  type TripInput,
  type TripSummary,
} from './model';
import { TRIP_LIMITS } from './validation';

interface TripRow {
  id: string;
  name: string;
  destination: string;
  start_date: string;
  end_date: string;
  transport_mode: string;
  category: string;
  completed_at: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  total_tasks: number | null;
  done_tasks: number | null;
  essential_total: number | null;
  essential_done: number | null;
  optional_total: number | null;
  optional_done: number | null;
}

interface ChildRow {
  id: string;
  trip_id: string;
  name: string;
  kind?: string;
  position: number;
}

export class TripDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TripDataError';
  }
}

const SUMMARY_SELECT = `
  SELECT t.id, t.name, t.destination, t.start_date, t.end_date, t.transport_mode, t.category,
         t.completed_at, t.archived_at, t.created_at, t.updated_at,
         COUNT(k.id) AS total_tasks,
         COALESCE(SUM(k.is_done), 0) AS done_tasks,
         COALESCE(SUM(k.priority = 'essential'), 0) AS essential_total,
         COALESCE(SUM(k.priority = 'essential' AND k.is_done = 1), 0) AS essential_done,
         COALESCE(SUM(k.priority = 'optional'), 0) AS optional_total,
         COALESCE(SUM(k.priority = 'optional' AND k.is_done = 1), 0) AS optional_done
  FROM trips t
  LEFT JOIN checklist_sections s ON s.trip_id = t.id
  LEFT JOIN checklist_tasks k ON k.section_id = s.id
`;

function mapSummary(row: TripRow, destinations: Destination[], travellers: Traveller[]): TripSummary {
  if (!isTransportMode(row.transport_mode) || !isTripCategory(row.category)) {
    throw new TripDataError(`Trip "${row.id}" has an unrecognised transport mode or category.`);
  }
  return {
    id: row.id,
    name: row.name,
    // A trip may have no destinations yet (planned later in the planner).
    destinations,
    startDate: row.start_date,
    endDate: row.end_date,
    travellers,
    transportMode: row.transport_mode,
    category: row.category,
    completedAt: row.completed_at,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    readiness: statsFromRow(row),
  };
}

export interface DeletionImpact {
  destinations: number;
  travellers: number;
  sections: number;
  tasks: number;
  /** Journey Journal entries (and their photos) on this device. */
  journalEntries: number;
  /** Photos kept by Trip Prep for this trip: journal photos and destination memory photos. */
  photos: number;
  /** Expenses and payments in the Trip calculator. */
  expenses: number;
  settlements: number;
  /** Set while the trip is linked to a shared trip (deleting would orphan the shared copy). */
  sharedRole: string | null;
}

export interface TripRepository {
  list(): Promise<TripSummary[]>;
  getById(id: string): Promise<TripSummary | null>;
  /** Creates the trip, its destinations and travellers, and its initial checklist in one transaction. */
  create(input: TripInput, checklist: ChecklistPlan): Promise<TripSummary>;
  /** Updates trip details only; the checklist and its completion are never touched. */
  update(id: string, input: TripInput): Promise<TripSummary>;
  /** Copies the trip, destinations, travellers and checklist (nothing ticked) as a new active trip. */
  duplicate(id: string): Promise<TripSummary>;
  setCompleted(id: string, completed: boolean): Promise<TripSummary>;
  setArchived(id: string, archived: boolean): Promise<TripSummary>;
  /** Deletes the trip and, by cascade, everything that belongs to it. */
  remove(id: string): Promise<boolean>;
  deletionImpact(id: string): Promise<DeletionImpact>;
  count(): Promise<number>;
}

function assertChildren(input: TripInput) {
  if (input.travellers.length === 0) throw new TripDataError('A trip needs at least one traveller.');
  if (input.travellers.length > TRIP_LIMITS.travellersMax) {
    throw new TripDataError(`Up to ${TRIP_LIMITS.travellersMax} travellers.`);
  }
  for (const d of input.destinations ?? []) {
    if (d.name.trim().length === 0) throw new TripDataError('Destination names cannot be empty.');
  }
  for (const t of input.travellers) {
    if (t.name.trim().length === 0) throw new TripDataError('Traveller names cannot be empty.');
    if (!isTravellerKind(t.kind)) throw new TripDataError('Unknown traveller type.');
  }
}

export function createTripRepository(
  db: Database,
  deps: { createId: IdFactory; now?: () => Date },
): TripRepository {
  const now = deps.now ?? (() => new Date());

  async function query(where: string, params: SqlValue[]): Promise<TripSummary[]> {
    const rows = await db.getAllAsync<TripRow>(
      `${SUMMARY_SELECT} ${where} GROUP BY t.id ORDER BY t.start_date ASC, t.created_at ASC`,
      params,
    );
    if (rows.length === 0) return [];
    const filter = where ? 'WHERE trip_id IN (SELECT t.id FROM trips t ' + where + ')' : '';
    const [destinationRows, travellerRows] = await Promise.all([
      db.getAllAsync<ChildRow>(
        `SELECT id, trip_id, name, position FROM trip_destinations ${filter} ORDER BY position, created_at`,
        params,
      ),
      db.getAllAsync<ChildRow>(
        `SELECT id, trip_id, name, kind, position FROM trip_travellers ${filter} ORDER BY position, created_at`,
        params,
      ),
    ]);
    const byTrip = <T>(childRows: ChildRow[], map: (row: ChildRow) => T) => {
      const groups = new Map<string, T[]>();
      for (const row of childRows) {
        const list = groups.get(row.trip_id) ?? [];
        list.push(map(row));
        groups.set(row.trip_id, list);
      }
      return groups;
    };
    const destinations = byTrip(destinationRows, (row) => ({ id: row.id, name: row.name }));
    const travellers = byTrip(travellerRows, (row) => ({
      id: row.id,
      name: row.name,
      kind: isTravellerKind(row.kind) ? row.kind : 'adult',
    }));
    return rows.map((row) =>
      mapSummary(row, destinations.get(row.id) ?? [], travellers.get(row.id) ?? []),
    );
  }

  async function getById(id: string): Promise<TripSummary | null> {
    const [trip] = await query('WHERE t.id = ?', [id]);
    return trip ?? null;
  }

  async function mustGet(id: string): Promise<TripSummary> {
    const trip = await getById(id);
    if (!trip) throw new TripDataError('That trip no longer exists.');
    return trip;
  }

  /**
   * Makes the trip's child rows match `items` in order: rows whose id belongs
   * to this trip are updated in place (ids preserved), others are inserted,
   * and rows no longer listed are deleted.
   */
  async function syncChildren(
    table: 'trip_destinations' | 'trip_travellers',
    tripId: string,
    items: { id?: string; name: string; kind?: string }[],
    timestamp: string,
  ) {
    const existing = await db.getAllAsync<{ id: string }>(`SELECT id FROM ${table} WHERE trip_id = ?`, [tripId]);
    const existingIds = new Set(existing.map((row) => row.id));
    const kept = new Set<string>();
    const withKind = table === 'trip_travellers';

    for (let position = 0; position < items.length; position += 1) {
      const item = items[position] as (typeof items)[number];
      const name = item.name.trim();
      if (item.id && existingIds.has(item.id) && !kept.has(item.id)) {
        kept.add(item.id);
        await db.runAsync(
          withKind
            ? `UPDATE ${table} SET name = ?, kind = ?, position = ?, updated_at = ? WHERE id = ? AND trip_id = ?`
            : `UPDATE ${table} SET name = ?, position = ?, updated_at = ? WHERE id = ? AND trip_id = ?`,
          withKind
            ? [name, item.kind ?? 'adult', position, timestamp, item.id, tripId]
            : [name, position, timestamp, item.id, tripId],
        );
      } else {
        await db.runAsync(
          withKind
            ? `INSERT INTO ${table} (id, trip_id, name, kind, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
            : `INSERT INTO ${table} (id, trip_id, name, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
          withKind
            ? [deps.createId(), tripId, name, item.kind ?? 'adult', position, timestamp, timestamp]
            : [deps.createId(), tripId, name, position, timestamp, timestamp],
        );
      }
    }
    for (const id of existingIds) {
      if (!kept.has(id)) await db.runAsync(`DELETE FROM ${table} WHERE id = ?`, [id]);
    }
  }

  /** Legacy summary columns kept in step with the child rows. */
  function legacyColumns(input: TripInput) {
    const { adults, children } = countTravellers(input.travellers);
    return { destination: input.destinations?.[0]?.name.trim() ?? '', adults, children };
  }

  async function setTimestampColumn(id: string, column: 'completed_at' | 'archived_at', on: boolean) {
    const timestamp = now().toISOString();
    await db.withTransactionAsync(async () => {
      const result = await db.runAsync(`UPDATE trips SET ${column} = ?, updated_at = ? WHERE id = ?`, [
        on ? timestamp : null,
        timestamp,
        id,
      ]);
      if (result.changes === 0) throw new TripDataError('That trip no longer exists.');
      if (on) {
        // Completing or archiving (cancelling) a trip frees the inventory it held.
        await closeTripReservations(
          db,
          id,
          timestamp,
          column === 'completed_at'
            ? 'Reservations were released when the trip was completed. Confirm again to reserve.'
            : 'Reservations were released when the trip was archived. Confirm again to reserve.',
        );
      }
    });
    return mustGet(id);
  }

  return {
    list: () => query('', []),

    getById,

    async create(input, checklist) {
      assertChildren(input);
      const id = deps.createId();
      const timestamp = now().toISOString();
      const legacy = legacyColumns(input);

      await db.withTransactionAsync(async () => {
        await db.runAsync(
          `INSERT INTO trips (id, name, destination, start_date, end_date, adults, children,
                              transport_mode, category, completed_at, archived_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)`,
          [
            id,
            input.name.trim(),
            legacy.destination,
            input.startDate,
            input.endDate,
            legacy.adults,
            legacy.children,
            input.transportMode,
            input.category,
            timestamp,
            timestamp,
          ],
        );
        // New trip: ignore any ids passed in for child rows.
        await syncChildren(
          'trip_travellers',
          id,
          input.travellers.map(({ name, kind }) => ({ name, kind })),
          timestamp,
        );
        // First main destinations (if any) seed the planner, which derives the trip's destinations.
        await seedPlan(db, deps.createId, id, (input.destinations ?? []).map((d) => d.name), timestamp);
        await insertPlan(db, tripOwner(id), checklist, { createId: deps.createId, timestamp });
      });

      return mustGet(id);
    },

    async update(id, input) {
      assertChildren(input);
      const timestamp = now().toISOString();
      const legacy = legacyColumns(input);
      await db.withTransactionAsync(async () => {
        const result = await db.runAsync(
          `UPDATE trips SET name = ?, start_date = ?, end_date = ?, adults = ?, children = ?,
                            transport_mode = ?, category = ?, updated_at = ?
           WHERE id = ?`,
          [
            input.name.trim(),
            input.startDate,
            input.endDate,
            legacy.adults,
            legacy.children,
            input.transportMode,
            input.category,
            timestamp,
            id,
          ],
        );
        if (result.changes === 0) throw new TripDataError('That trip no longer exists.');
        // Destinations are edited in the planner, never here.
        await syncChildren('trip_travellers', id, input.travellers, timestamp);
        // Keep purchase history readable and reservations valid for the new dates.
        await db.runAsync('UPDATE purchase_items SET trip_name = ? WHERE trip_id = ?', [input.name.trim(), id]);
        await revalidateTripReservations(db, id, timestamp);
      });
      return mustGet(id);
    },

    async duplicate(id) {
      const source = await mustGet(id);
      const copyId = deps.createId();
      const timestamp = now().toISOString();
      const input: TripInput = {
        name: copyName(source.name, TRIP_LIMITS.nameMax),
        destinations: source.destinations.map(({ name }) => ({ name })),
        startDate: source.startDate,
        endDate: source.endDate,
        travellers: source.travellers.map(({ name, kind }) => ({ name, kind })),
        transportMode: source.transportMode,
        category: source.category,
      };
      const legacy = legacyColumns(input);

      await db.withTransactionAsync(async () => {
        await db.runAsync(
          `INSERT INTO trips (id, name, destination, start_date, end_date, adults, children,
                              transport_mode, category, completed_at, archived_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)`,
          [
            copyId,
            input.name,
            legacy.destination,
            input.startDate,
            input.endDate,
            legacy.adults,
            legacy.children,
            input.transportMode,
            input.category,
            timestamp,
            timestamp,
          ],
        );
        await syncChildren('trip_travellers', copyId, input.travellers, timestamp);
        await copyChecklist(db, tripOwner(id), tripOwner(copyId), { createId: deps.createId, timestamp }, {
          keepProvenance: true,
        });
        // Packing list copies are unpacked and unreserved (draft); travellers map by position.
        const copied = await db.getAllAsync<{ id: string }>(
          'SELECT id FROM trip_travellers WHERE trip_id = ? ORDER BY position',
          [copyId],
        );
        const travellerMap = new Map(
          source.travellers.flatMap((t, index) => (copied[index] ? [[t.id, copied[index].id] as const] : [])),
        );
        await copyPacking(db, deps.createId, id, copyId, travellerMap, timestamp);
        await copyPlan(db, deps.createId, id, copyId, timestamp);
      });
      return mustGet(copyId);
    },

    setCompleted: (id, completed) => setTimestampColumn(id, 'completed_at', completed),

    setArchived: (id, archived) => setTimestampColumn(id, 'archived_at', archived),

    async remove(id) {
      // Destinations, travellers, checklists and packing entries cascade. Reservations are
      // closed first (kept as history); purchase items keep their trip name snapshot.
      let removed = false;
      await db.withTransactionAsync(async () => {
        await closeTripReservations(db, id, now().toISOString(), null);
        const result = await db.runAsync('DELETE FROM trips WHERE id = ?', [id]);
        removed = result.changes > 0;
      });
      return removed;
    },

    async deletionImpact(id) {
      const row = await db.getFirstAsync<Record<string, number | string | null>>(
        `SELECT
           (SELECT COUNT(*) FROM trip_destinations WHERE trip_id = ?) AS destinations,
           (SELECT COUNT(*) FROM trip_travellers WHERE trip_id = ?) AS travellers,
           (SELECT COUNT(*) FROM checklist_sections WHERE trip_id = ?) AS sections,
           (SELECT COUNT(*) FROM checklist_tasks k JOIN checklist_sections s ON s.id = k.section_id
             WHERE s.trip_id = ?) AS tasks,
           (SELECT COUNT(*) FROM journal_entries WHERE trip_id = ?) AS journalEntries,
           (SELECT COUNT(*) FROM journal_photos p JOIN journal_entries e ON e.id = p.entry_id WHERE e.trip_id = ?)
             + (SELECT COALESCE(SUM(json_array_length(photos)), 0) FROM plan_node_memories WHERE trip_id = ? AND json_valid(photos))
             AS photos,
           (SELECT COUNT(*) FROM expenses WHERE trip_id = ?) AS expenses,
           (SELECT COUNT(*) FROM expense_settlements WHERE trip_id = ?) AS settlements,
           (SELECT role FROM shared_spaces WHERE trip_id = ? AND role <> 'removed') AS sharedRole`,
        [id, id, id, id, id, id, id, id, id, id],
      );
      const n = (v: number | string | null | undefined) => Number(v) || 0;
      return {
        destinations: n(row?.destinations),
        travellers: n(row?.travellers),
        sections: n(row?.sections),
        tasks: n(row?.tasks),
        journalEntries: n(row?.journalEntries),
        photos: n(row?.photos),
        expenses: n(row?.expenses),
        settlements: n(row?.settlements),
        sharedRole: typeof row?.sharedRole === 'string' ? row.sharedRole : null,
      };
    },

    async count() {
      const row = await db.getFirstAsync<{ count: number }>('SELECT COUNT(*) AS count FROM trips', []);
      return row?.count ?? 0;
    },
  };
}
