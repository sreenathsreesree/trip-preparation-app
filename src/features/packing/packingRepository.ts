import type { Database } from '@/db/types';
import type { IdFactory } from '@/lib/id';

import {
  ACCOMMODATIONS,
  availableQuantity,
  describeConflict,
  findReservationConflicts,
  isAccommodation,
  isActivity,
  isEntryUnit,
  isLuggageKind,
  LUGGAGE_META,
  PACKING_LIMITS,
  type Accommodation,
  type Activity,
  type ActiveReservation,
  type EntryPatch,
  type EntrySource,
  type Luggage,
  type LuggageKind,
  type NewEntryInput,
  type PackingEntry,
  type ReservableItem,
  type ReservationConflict,
  type TripPackingState,
} from './model';

interface EntryRow {
  id: string;
  trip_id: string;
  inventory_item_id: string | null;
  name: string;
  category_id: string | null;
  quantity: number;
  unit: string;
  traveller_id: string | null;
  luggage_id: string | null;
  is_packed: number;
  notes: string;
  source: string;
  recommendation_id: string | null;
  position: number;
  created_at: string;
  updated_at: string;
}

interface StateRow {
  trip_id: string;
  activities: string;
  accommodation: string;
  laundry: number;
  confirmed_at: string | null;
  draft_reason: string | null;
  suggestions_generated_at: string | null;
}

interface LuggageRow {
  id: string;
  trip_id: string;
  name: string;
  kind: string;
  traveller_id: string | null;
  position: number;
}

export class PackingError extends Error {
  conflicts: ReservationConflict[];
  constructor(message: string, conflicts: ReservationConflict[] = []) {
    super(message);
    this.name = 'PackingError';
    this.conflicts = conflicts;
  }
}

const SOURCES: readonly EntrySource[] = ['manual', 'inventory', 'recommendation', 'purchase'];

export function mapEntry(row: EntryRow): PackingEntry {
  return {
    id: row.id,
    tripId: row.trip_id,
    inventoryItemId: row.inventory_item_id,
    name: row.name,
    categoryId: row.category_id,
    quantity: row.quantity,
    unit: isEntryUnit(row.unit) ? row.unit : 'pcs',
    travellerId: row.traveller_id,
    luggageId: row.luggage_id,
    isPacked: row.is_packed === 1,
    notes: row.notes,
    source: (SOURCES as readonly string[]).includes(row.source) ? (row.source as EntrySource) : 'manual',
    recommendationId: row.recommendation_id,
    position: row.position,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function parseActivities(json: string): Activity[] {
  try {
    const value: unknown = JSON.parse(json);
    return Array.isArray(value) ? value.filter(isActivity) : [];
  } catch {
    return [];
  }
}

function mapState(row: StateRow): TripPackingState {
  return {
    tripId: row.trip_id,
    activities: parseActivities(row.activities),
    accommodation: isAccommodation(row.accommodation) ? row.accommodation : 'hotel',
    laundry: row.laundry === 1,
    confirmedAt: row.confirmed_at,
    draftReason: row.draft_reason,
    suggestionsGeneratedAt: row.suggestions_generated_at,
  };
}

function mapLuggage(row: LuggageRow): Luggage {
  return {
    id: row.id,
    tripId: row.trip_id,
    name: row.name,
    kind: isLuggageKind(row.kind) ? row.kind : 'custom',
    travellerId: row.traveller_id,
    position: row.position,
  };
}

/* ------------------------------------------------------------------ */
/* Shared helpers (used inside callers' transactions)                  */
/* ------------------------------------------------------------------ */

/** Default accommodation for a new trip's packing profile. */
const DEFAULT_ACCOMMODATION: Accommodation = ACCOMMODATIONS[0];

export async function ensurePackingState(db: Database, tripId: string, timestamp: string): Promise<void> {
  await db.runAsync(
    `INSERT OR IGNORE INTO trip_packing (trip_id, activities, accommodation, laundry, created_at, updated_at)
     VALUES (?, '[]', ?, 0, ?, ?)`,
    [tripId, DEFAULT_ACCOMMODATION, timestamp, timestamp],
  );
}

async function tripDates(db: Database, tripId: string) {
  const row = await db.getFirstAsync<{ start_date: string; end_date: string; name: string }>(
    'SELECT start_date, end_date, name FROM trips WHERE id = ?',
    [tripId],
  );
  if (!row) throw new PackingError('That trip no longer exists.');
  return { startDate: row.start_date, endDate: row.end_date, name: row.name };
}

async function isConfirmed(db: Database, tripId: string): Promise<boolean> {
  const row = await db.getFirstAsync<{ confirmed_at: string | null }>(
    'SELECT confirmed_at FROM trip_packing WHERE trip_id = ?',
    [tripId],
  );
  return Boolean(row?.confirmed_at);
}

async function loadActiveReservations(db: Database, itemIds: readonly string[]): Promise<ActiveReservation[]> {
  if (itemIds.length === 0) return [];
  const placeholders = itemIds.map(() => '?').join(', ');
  const rows = await db.getAllAsync<{
    inventory_item_id: string;
    trip_id: string | null;
    quantity: number;
    start_date: string;
    end_date: string;
  }>(
    `SELECT inventory_item_id, trip_id, quantity, start_date, end_date FROM inventory_reservations
     WHERE status = 'active' AND inventory_item_id IN (${placeholders})`,
    [...itemIds],
  );
  return rows.map((r) => ({
    inventoryItemId: r.inventory_item_id,
    tripId: r.trip_id,
    quantity: r.quantity,
    startDate: r.start_date,
    endDate: r.end_date,
  }));
}

async function loadReservable(db: Database, itemIds: readonly string[]): Promise<Map<string, ReservableItem>> {
  if (itemIds.length === 0) return new Map();
  const placeholders = itemIds.map(() => '?').join(', ');
  const rows = await db.getAllAsync<{ id: string; name: string; quantity: number; availability: string; archived_at: string | null }>(
    `SELECT id, name, quantity, availability, archived_at FROM inventory_items WHERE id IN (${placeholders})`,
    [...itemIds],
  );
  return new Map(
    rows.map((r) => [
      r.id,
      {
        id: r.id,
        name: r.name,
        quantity: r.quantity,
        availability: r.availability === 'damaged' || r.availability === 'borrowed' ? r.availability : 'available',
        archivedAt: r.archived_at,
      },
    ]),
  );
}

/** Conflicts for the trip's current inventory-linked entries (optionally only some items). */
export async function tripConflicts(db: Database, tripId: string, onlyItemIds?: readonly string[]) {
  const dates = await tripDates(db, tripId);
  const entries = await db.getAllAsync<{ inventory_item_id: string; quantity: number }>(
    'SELECT inventory_item_id, quantity FROM packing_entries WHERE trip_id = ? AND inventory_item_id IS NOT NULL',
    [tripId],
  );
  const relevant = onlyItemIds ? entries.filter((e) => onlyItemIds.includes(e.inventory_item_id)) : entries;
  const itemIds = [...new Set(relevant.map((e) => e.inventory_item_id))];
  const [items, reservations] = await Promise.all([loadReservable(db, itemIds), loadActiveReservations(db, itemIds)]);
  return findReservationConflicts(
    tripId,
    dates,
    relevant.map((e) => ({ inventoryItemId: e.inventory_item_id, quantity: e.quantity })),
    items,
    reservations,
  );
}

/** Makes the reservation for one entry match it (confirmed trips only). */
async function syncEntryReservation(db: Database, createId: IdFactory, entryId: string, timestamp: string) {
  const entry = await db.getFirstAsync<EntryRow>('SELECT * FROM packing_entries WHERE id = ?', [entryId]);
  const active = await db.getFirstAsync<{ id: string }>(
    `SELECT id FROM inventory_reservations WHERE packing_entry_id = ? AND status = 'active'`,
    [entryId],
  );
  const shouldReserve = entry && entry.inventory_item_id && (await isConfirmed(db, entry.trip_id));
  if (!shouldReserve || !entry || !entry.inventory_item_id) {
    if (active) {
      await db.runAsync(
        `UPDATE inventory_reservations SET status = 'released', ended_at = ?, updated_at = ? WHERE id = ?`,
        [timestamp, timestamp, active.id],
      );
    }
    return;
  }
  const dates = await tripDates(db, entry.trip_id);
  if (active) {
    await db.runAsync(
      `UPDATE inventory_reservations SET quantity = ?, inventory_item_id = ?, start_date = ?, end_date = ?, updated_at = ?
       WHERE id = ?`,
      [entry.quantity, entry.inventory_item_id, dates.startDate, dates.endDate, timestamp, active.id],
    );
  } else {
    await db.runAsync(
      `INSERT INTO inventory_reservations (id, inventory_item_id, trip_id, packing_entry_id, quantity, start_date,
                                           end_date, status, created_at, updated_at, ended_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, NULL)`,
      [createId(), entry.inventory_item_id, entry.trip_id, entryId, entry.quantity, dates.startDate, dates.endDate, timestamp, timestamp],
    );
  }
}

/** Throws (rolling back the caller's transaction) if the trip now over-books an item. */
async function assertNoConflicts(db: Database, tripId: string, itemIds: readonly string[]) {
  if (itemIds.length === 0 || !(await isConfirmed(db, tripId))) return;
  const conflicts = await tripConflicts(db, tripId, itemIds);
  if (conflicts.length > 0) {
    throw new PackingError(conflicts.map(describeConflict).join(' '), conflicts);
  }
}

function cleanName(name: string): string {
  const clean = name.trim().replace(/\s+/g, ' ');
  if (clean.length === 0) throw new PackingError('Give the item a name.');
  if (clean.length > PACKING_LIMITS.nameMax) throw new PackingError(`Keep names under ${PACKING_LIMITS.nameMax} characters.`);
  return clean;
}

function cleanUnit(unit: unknown): string {
  return isEntryUnit(unit) ? unit : 'pcs';
}

function cleanQuantity(quantity: number): number {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > PACKING_LIMITS.quantityMax) {
    throw new PackingError(`Quantity must be between 1 and ${PACKING_LIMITS.quantityMax}.`);
  }
  return quantity;
}

/**
 * Inserts a packing entry. Inventory-linked entries copy the item's name and
 * category as the entry's own (trip-specific) values. Never modifies the item.
 * On a confirmed list the quantity is reserved, or the call throws.
 */
export async function insertEntry(
  db: Database,
  createId: IdFactory,
  tripId: string,
  input: NewEntryInput,
  timestamp: string,
): Promise<string> {
  await ensurePackingState(db, tripId, timestamp);
  let name = input.name;
  let categoryId = input.categoryId ?? null;
  if (input.inventoryItemId) {
    const item = await db.getFirstAsync<{ name: string; category_id: string | null; archived_at: string | null }>(
      'SELECT name, category_id, archived_at FROM inventory_items WHERE id = ?',
      [input.inventoryItemId],
    );
    if (!item) throw new PackingError('That inventory item no longer exists.');
    if (item.archived_at) throw new PackingError(`${item.name} is archived. Restore it before packing it.`);
    name = name || item.name;
    if (input.categoryId === undefined) categoryId = item.category_id;
  }
  const id = createId();
  const next = await db.getFirstAsync<{ next: number }>(
    'SELECT COALESCE(MAX(position) + 1, 0) AS next FROM packing_entries WHERE trip_id = ?',
    [tripId],
  );
  await db.runAsync(
    `INSERT INTO packing_entries (id, trip_id, inventory_item_id, name, category_id, quantity, unit, traveller_id, luggage_id,
                                  is_packed, notes, source, recommendation_id, position, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      tripId,
      input.inventoryItemId ?? null,
      cleanName(name),
      categoryId,
      cleanQuantity(input.quantity ?? 1),
      cleanUnit(input.unit),
      input.travellerId ?? null,
      input.luggageId ?? null,
      (input.notes ?? '').trim().slice(0, PACKING_LIMITS.notesMax),
      input.source ?? (input.inventoryItemId ? 'inventory' : 'manual'),
      input.recommendationId ?? null,
      next?.next ?? 0,
      timestamp,
      timestamp,
    ],
  );
  if (input.inventoryItemId) {
    await assertNoConflicts(db, tripId, [input.inventoryItemId]);
    await syncEntryReservation(db, createId, id, timestamp);
  }
  return id;
}

/** Closes a trip's reservations and returns its list to draft (trip completed/archived/deleted). */
export async function closeTripReservations(db: Database, tripId: string, timestamp: string, reason: string | null) {
  await db.runAsync(
    `UPDATE inventory_reservations SET status = 'closed', ended_at = ?, updated_at = ? WHERE trip_id = ? AND status = 'active'`,
    [timestamp, timestamp, tripId],
  );
  await db.runAsync(
    `UPDATE trip_packing SET confirmed_at = NULL, draft_reason = ?, updated_at = ? WHERE trip_id = ? AND confirmed_at IS NOT NULL`,
    [reason, timestamp, tripId],
  );
}

/**
 * After a trip's dates change: move its reservations to the new dates and,
 * if that over-books anything, release them and return the list to draft.
 */
export async function revalidateTripReservations(db: Database, tripId: string, timestamp: string) {
  if (!(await isConfirmed(db, tripId))) return;
  const dates = await tripDates(db, tripId);
  await db.runAsync(
    `UPDATE inventory_reservations SET start_date = ?, end_date = ?, updated_at = ? WHERE trip_id = ? AND status = 'active'`,
    [dates.startDate, dates.endDate, timestamp, tripId],
  );
  const conflicts = await tripConflicts(db, tripId);
  if (conflicts.length > 0) {
    await db.runAsync(
      `UPDATE inventory_reservations SET status = 'released', ended_at = ?, updated_at = ? WHERE trip_id = ? AND status = 'active'`,
      [timestamp, timestamp, tripId],
    );
    await db.runAsync(
      `UPDATE trip_packing SET confirmed_at = NULL, draft_reason = ?, updated_at = ? WHERE trip_id = ?`,
      [`The new dates clash with other trips, so reservations were released. ${conflicts.map(describeConflict).join(' ')}`, timestamp, tripId],
    );
  }
}

/** Copies a trip's packing profile, luggage and entries (unpacked, draft) to a duplicate trip. */
export async function copyPacking(
  db: Database,
  createId: IdFactory,
  fromTripId: string,
  toTripId: string,
  travellerMap: ReadonlyMap<string, string>,
  timestamp: string,
) {
  const state = await db.getFirstAsync<StateRow>('SELECT * FROM trip_packing WHERE trip_id = ?', [fromTripId]);
  if (state) {
    await db.runAsync(
      `INSERT INTO trip_packing (trip_id, activities, accommodation, laundry, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [toTripId, state.activities, state.accommodation, state.laundry, timestamp, timestamp],
    );
  }
  const luggageMap = new Map<string, string>();
  const bags = await db.getAllAsync<LuggageRow>('SELECT * FROM trip_luggage WHERE trip_id = ? ORDER BY position', [fromTripId]);
  for (const bag of bags) {
    const id = createId();
    luggageMap.set(bag.id, id);
    await db.runAsync(
      `INSERT INTO trip_luggage (id, trip_id, name, kind, traveller_id, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, toTripId, bag.name, bag.kind, bag.traveller_id ? travellerMap.get(bag.traveller_id) ?? null : null, bag.position, timestamp, timestamp],
    );
  }
  const entries = await db.getAllAsync<EntryRow>('SELECT * FROM packing_entries WHERE trip_id = ? ORDER BY position', [fromTripId]);
  for (const entry of entries) {
    await db.runAsync(
      `INSERT INTO packing_entries (id, trip_id, inventory_item_id, name, category_id, quantity, unit, traveller_id, luggage_id,
                                    is_packed, notes, source, recommendation_id, position, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, NULL, ?, ?, ?)`,
      [
        createId(),
        toTripId,
        entry.inventory_item_id,
        entry.name,
        entry.category_id,
        entry.quantity,
        cleanUnit(entry.unit),
        entry.traveller_id ? travellerMap.get(entry.traveller_id) ?? null : null,
        entry.luggage_id ? luggageMap.get(entry.luggage_id) ?? null : null,
        entry.notes,
        entry.source === 'recommendation' ? 'manual' : entry.source,
        entry.position,
        timestamp,
        timestamp,
      ],
    );
  }
}

/* ------------------------------------------------------------------ */
/* Repository                                                          */
/* ------------------------------------------------------------------ */

export interface PackingOverview {
  state: TripPackingState;
  entries: PackingEntry[];
  luggage: Luggage[];
}

export interface PackingRepository {
  load(tripId: string): Promise<PackingOverview>;
  updateProfile(
    tripId: string,
    patch: Partial<Pick<TripPackingState, 'activities' | 'accommodation' | 'laundry'>>,
  ): Promise<void>;
  addEntry(tripId: string, input: NewEntryInput): Promise<PackingEntry>;
  /** Adds several entries atomically (e.g. from the inventory picker). */
  addEntries(tripId: string, inputs: readonly NewEntryInput[]): Promise<number>;
  updateEntry(entryId: string, patch: EntryPatch): Promise<PackingEntry>;
  /** Removes the entry only. The inventory item is untouched; its reservation is released. */
  removeEntry(entryId: string): Promise<void>;
  addLuggage(tripId: string, input: { name?: string; kind: LuggageKind; travellerId?: string | null }): Promise<Luggage>;
  updateLuggage(id: string, input: { name: string; travellerId: string | null }): Promise<void>;
  /** Sets exactly which entries of the bag's trip are in the bag. */
  setLuggageContents(id: string, entryIds: readonly string[]): Promise<void>;
  /** Deletes the bag; its entries stay on the list, unassigned. */
  removeLuggage(id: string): Promise<void>;
  /** Dry run: what would block confirmation right now. */
  checkConflicts(tripId: string): Promise<ReservationConflict[]>;
  /** Reserves inventory for the list, or returns the conflicts and changes nothing. */
  confirm(tripId: string): Promise<{ ok: true } | { ok: false; conflicts: ReservationConflict[] }>;
  /** Back to draft: releases every reservation. */
  unconfirm(tripId: string): Promise<void>;
  dismissDraftReason(tripId: string): Promise<void>;
  /** Units of each item free for this trip's dates (other trips' reservations subtracted). */
  availability(tripId: string, itemIds: readonly string[]): Promise<Record<string, number>>;
}

export function createPackingRepository(
  db: Database,
  deps: { createId: IdFactory; now?: () => Date },
): PackingRepository {
  const now = deps.now ?? (() => new Date());
  const stamp = () => now().toISOString();

  async function getEntry(entryId: string) {
    const row = await db.getFirstAsync<EntryRow>('SELECT * FROM packing_entries WHERE id = ?', [entryId]);
    if (!row) throw new PackingError('That packing entry no longer exists.');
    return row;
  }

  return {
    async load(tripId) {
      await tripDates(db, tripId);
      await ensurePackingState(db, tripId, stamp());
      const [state, entries, luggage] = await Promise.all([
        db.getFirstAsync<StateRow>('SELECT * FROM trip_packing WHERE trip_id = ?', [tripId]),
        db.getAllAsync<EntryRow>('SELECT * FROM packing_entries WHERE trip_id = ? ORDER BY position, created_at', [tripId]),
        db.getAllAsync<LuggageRow>('SELECT * FROM trip_luggage WHERE trip_id = ? ORDER BY position, created_at', [tripId]),
      ]);
      return {
        state: mapState(state as StateRow),
        entries: entries.map(mapEntry),
        luggage: luggage.map(mapLuggage),
      };
    },

    async updateProfile(tripId, patch) {
      const timestamp = stamp();
      await ensurePackingState(db, tripId, timestamp);
      if (patch.activities) {
        await db.runAsync('UPDATE trip_packing SET activities = ?, updated_at = ? WHERE trip_id = ?', [
          JSON.stringify([...new Set(patch.activities.filter(isActivity))]),
          timestamp,
          tripId,
        ]);
      }
      if (patch.accommodation) {
        if (!isAccommodation(patch.accommodation)) throw new PackingError('Unknown accommodation.');
        await db.runAsync('UPDATE trip_packing SET accommodation = ?, updated_at = ? WHERE trip_id = ?', [
          patch.accommodation,
          timestamp,
          tripId,
        ]);
      }
      if (patch.laundry !== undefined) {
        await db.runAsync('UPDATE trip_packing SET laundry = ?, updated_at = ? WHERE trip_id = ?', [
          patch.laundry ? 1 : 0,
          timestamp,
          tripId,
        ]);
      }
    },

    async addEntry(tripId, input) {
      let id = '';
      const timestamp = stamp();
      await db.withTransactionAsync(async () => {
        id = await insertEntry(db, deps.createId, tripId, input, timestamp);
      });
      return mapEntry(await getEntry(id));
    },

    async addEntries(tripId, inputs) {
      const timestamp = stamp();
      await db.withTransactionAsync(async () => {
        for (const input of inputs) await insertEntry(db, deps.createId, tripId, input, timestamp);
      });
      return inputs.length;
    },

    async updateEntry(entryId, patch) {
      const entry = await getEntry(entryId);
      const timestamp = stamp();
      const next = {
        name: patch.name !== undefined ? cleanName(patch.name) : entry.name,
        categoryId: patch.categoryId !== undefined ? patch.categoryId : entry.category_id,
        quantity: patch.quantity !== undefined ? cleanQuantity(patch.quantity) : entry.quantity,
        unit: patch.unit !== undefined ? cleanUnit(patch.unit) : cleanUnit(entry.unit),
        travellerId: patch.travellerId !== undefined ? patch.travellerId : entry.traveller_id,
        luggageId: patch.luggageId !== undefined ? patch.luggageId : entry.luggage_id,
        isPacked: patch.isPacked !== undefined ? patch.isPacked : entry.is_packed === 1,
        notes: patch.notes !== undefined ? patch.notes.trim().slice(0, PACKING_LIMITS.notesMax) : entry.notes,
      };
      await db.withTransactionAsync(async () => {
        await db.runAsync(
          `UPDATE packing_entries SET name = ?, category_id = ?, quantity = ?, unit = ?, traveller_id = ?, luggage_id = ?,
                  is_packed = ?, notes = ?, updated_at = ? WHERE id = ?`,
          [next.name, next.categoryId, next.quantity, next.unit, next.travellerId, next.luggageId, next.isPacked ? 1 : 0, next.notes, timestamp, entryId],
        );
        if (entry.inventory_item_id && next.quantity !== entry.quantity) {
          await assertNoConflicts(db, entry.trip_id, [entry.inventory_item_id]);
          await syncEntryReservation(db, deps.createId, entryId, timestamp);
        }
      });
      return mapEntry(await getEntry(entryId));
    },

    async removeEntry(entryId) {
      const entry = await db.getFirstAsync<EntryRow>('SELECT * FROM packing_entries WHERE id = ?', [entryId]);
      if (!entry) return;
      const timestamp = stamp();
      await db.withTransactionAsync(async () => {
        await db.runAsync(
          `UPDATE inventory_reservations SET status = 'released', ended_at = ?, updated_at = ?
           WHERE packing_entry_id = ? AND status = 'active'`,
          [timestamp, timestamp, entryId],
        );
        // Removing an accepted suggestion records that the user does not want it.
        await db.runAsync(
          `UPDATE packing_recommendations SET status = 'rejected', packing_entry_id = NULL, decided_at = ?, updated_at = ?
           WHERE packing_entry_id = ?`,
          [timestamp, timestamp, entryId],
        );
        await db.runAsync('DELETE FROM packing_entries WHERE id = ?', [entryId]);
      });
    },

    async addLuggage(tripId, input) {
      await tripDates(db, tripId);
      if (!isLuggageKind(input.kind)) throw new PackingError('Unknown bag type.');
      const name = (input.name ?? '').trim() || LUGGAGE_META[input.kind].label;
      if (name.length > PACKING_LIMITS.luggageNameMax) throw new PackingError('Keep bag names short.');
      const id = deps.createId();
      const timestamp = stamp();
      const next = await db.getFirstAsync<{ next: number }>(
        'SELECT COALESCE(MAX(position) + 1, 0) AS next FROM trip_luggage WHERE trip_id = ?',
        [tripId],
      );
      await db.runAsync(
        `INSERT INTO trip_luggage (id, trip_id, name, kind, traveller_id, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, tripId, name, input.kind, input.travellerId ?? null, next?.next ?? 0, timestamp, timestamp],
      );
      return { id, tripId, name, kind: input.kind, travellerId: input.travellerId ?? null, position: next?.next ?? 0 };
    },

    async updateLuggage(id, input) {
      const name = input.name.trim();
      if (!name) throw new PackingError('Give the bag a name.');
      if (name.length > PACKING_LIMITS.luggageNameMax) throw new PackingError('Keep bag names short.');
      await db.runAsync('UPDATE trip_luggage SET name = ?, traveller_id = ?, updated_at = ? WHERE id = ?', [
        name,
        input.travellerId,
        stamp(),
        id,
      ]);
    },

    async setLuggageContents(id, entryIds) {
      const bag = await db.getFirstAsync<{ trip_id: string }>('SELECT trip_id FROM trip_luggage WHERE id = ?', [id]);
      if (!bag) throw new PackingError('That bag no longer exists.');
      const wanted = new Set(entryIds);
      const timestamp = stamp();
      await db.withTransactionAsync(async () => {
        const entries = await db.getAllAsync<{ id: string; luggage_id: string | null }>(
          'SELECT id, luggage_id FROM packing_entries WHERE trip_id = ?',
          [bag.trip_id],
        );
        for (const entry of entries) {
          const inBag = entry.luggage_id === id;
          if (wanted.has(entry.id) && !inBag) {
            await db.runAsync('UPDATE packing_entries SET luggage_id = ?, updated_at = ? WHERE id = ?', [id, timestamp, entry.id]);
          } else if (!wanted.has(entry.id) && inBag) {
            await db.runAsync('UPDATE packing_entries SET luggage_id = NULL, updated_at = ? WHERE id = ?', [timestamp, entry.id]);
          }
        }
      });
    },

    async removeLuggage(id) {
      await db.runAsync('DELETE FROM trip_luggage WHERE id = ?', [id]);
    },

    checkConflicts: (tripId) => tripConflicts(db, tripId),

    async confirm(tripId) {
      const lifecycle = await db.getFirstAsync<{ completed_at: string | null; archived_at: string | null }>(
        'SELECT completed_at, archived_at FROM trips WHERE id = ?',
        [tripId],
      );
      if (!lifecycle) throw new PackingError('That trip no longer exists.');
      if (lifecycle.completed_at || lifecycle.archived_at) {
        throw new PackingError('Reopen or restore the trip before confirming its packing list.');
      }
      const conflicts = await tripConflicts(db, tripId);
      if (conflicts.length > 0) return { ok: false, conflicts };
      const timestamp = stamp();
      await db.withTransactionAsync(async () => {
        await ensurePackingState(db, tripId, timestamp);
        await db.runAsync(
          'UPDATE trip_packing SET confirmed_at = ?, draft_reason = NULL, updated_at = ? WHERE trip_id = ?',
          [timestamp, timestamp, tripId],
        );
        const entries = await db.getAllAsync<{ id: string }>(
          'SELECT id FROM packing_entries WHERE trip_id = ? AND inventory_item_id IS NOT NULL',
          [tripId],
        );
        for (const entry of entries) await syncEntryReservation(db, deps.createId, entry.id, timestamp);
        // Re-check inside the transaction in case something changed meanwhile.
        const after = await tripConflicts(db, tripId);
        if (after.length > 0) throw new PackingError(after.map(describeConflict).join(' '), after);
      });
      return { ok: true };
    },

    async unconfirm(tripId) {
      const timestamp = stamp();
      await db.withTransactionAsync(async () => {
        await db.runAsync(
          `UPDATE inventory_reservations SET status = 'released', ended_at = ?, updated_at = ? WHERE trip_id = ? AND status = 'active'`,
          [timestamp, timestamp, tripId],
        );
        await db.runAsync('UPDATE trip_packing SET confirmed_at = NULL, updated_at = ? WHERE trip_id = ?', [timestamp, tripId]);
      });
    },

    async dismissDraftReason(tripId) {
      await db.runAsync('UPDATE trip_packing SET draft_reason = NULL WHERE trip_id = ?', [tripId]);
    },

    async availability(tripId, itemIds) {
      const dates = await tripDates(db, tripId);
      const [items, reservations] = await Promise.all([loadReservable(db, itemIds), loadActiveReservations(db, itemIds)]);
      const result: Record<string, number> = {};
      for (const id of itemIds) {
        const item = items.get(id);
        if (!item) continue;
        result[id] =
          item.availability === 'available' && !item.archivedAt
            ? availableQuantity(item.quantity, reservations.filter((r) => r.inventoryItemId === id), dates, tripId)
            : 0;
      }
      return result;
    },
  };
}
