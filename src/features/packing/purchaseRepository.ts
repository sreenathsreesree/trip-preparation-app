import type { Database } from '@/db/types';
import type { IdFactory } from '@/lib/id';

import { createInventoryRepository } from '../inventory/inventoryRepository';
import { emptyItemInput, normalizeName } from '../inventory/model';
import { PURCHASE_STATUSES, type PurchaseItem, type PurchaseStatus } from './model';
import { insertEntry, PackingError } from './packingRepository';

interface PurchaseRow {
  id: string;
  trip_id: string | null;
  trip_name: string;
  name: string;
  normalized_name: string;
  quantity: number;
  category_id: string | null;
  status: string;
  recommendation_id: string | null;
  inventory_item_id: string | null;
  packing_entry_id: string | null;
  notes: string;
  created_at: string;
  updated_at: string;
  purchased_at: string | null;
  resolved_at: string | null;
}

const isStatus = (value: unknown): value is PurchaseStatus =>
  typeof value === 'string' && (PURCHASE_STATUSES as readonly string[]).includes(value);

function mapPurchase(row: PurchaseRow): PurchaseItem {
  return {
    id: row.id,
    tripId: row.trip_id,
    tripName: row.trip_name,
    name: row.name,
    quantity: row.quantity,
    categoryId: row.category_id,
    status: isStatus(row.status) ? row.status : 'needed',
    recommendationId: row.recommendation_id,
    inventoryItemId: row.inventory_item_id,
    packingEntryId: row.packing_entry_id,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    purchasedAt: row.purchased_at,
    resolvedAt: row.resolved_at,
  };
}

const OPEN_STATUSES = "('needed', 'purchased')";

/**
 * Adds an item to a trip's purchase list unless an open entry (to buy or
 * bought) with the same name already exists — then that entry is returned.
 */
export async function insertPurchase(
  db: Database,
  createId: IdFactory,
  input: { tripId: string; name: string; quantity: number; categoryId: string | null; recommendationId?: string | null },
  timestamp: string,
): Promise<{ id: string; duplicate: boolean }> {
  const name = input.name.trim().replace(/\s+/g, ' ');
  if (!name) throw new PackingError('Give the item a name.');
  if (!Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > 99) {
    throw new PackingError('Quantity must be between 1 and 99.');
  }
  const normalized = normalizeName(name);
  const existing = await db.getFirstAsync<{ id: string }>(
    `SELECT id FROM purchase_items WHERE trip_id = ? AND normalized_name = ? AND status IN ${OPEN_STATUSES}`,
    [input.tripId, normalized],
  );
  if (existing) return { id: existing.id, duplicate: true };
  const trip = await db.getFirstAsync<{ name: string }>('SELECT name FROM trips WHERE id = ?', [input.tripId]);
  if (!trip) throw new PackingError('That trip no longer exists.');
  const id = createId();
  await db.runAsync(
    `INSERT INTO purchase_items (id, trip_id, trip_name, name, normalized_name, quantity, category_id, status,
                                 recommendation_id, inventory_item_id, packing_entry_id, notes, created_at, updated_at,
                                 purchased_at, resolved_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'needed', ?, NULL, NULL, '', ?, ?, NULL, NULL)`,
    [id, input.tripId, trip.name, name, normalized, input.quantity, input.categoryId, input.recommendationId ?? null, timestamp, timestamp],
  );
  return { id, duplicate: false };
}

export interface PurchaseRepository {
  /** A trip's purchase list, or every purchase (including those of deleted trips) when no trip is given. */
  list(tripId?: string): Promise<PurchaseItem[]>;
  add(
    tripId: string,
    input: { name: string; quantity: number; categoryId: string | null },
  ): Promise<{ item: PurchaseItem; duplicate: boolean }>;
  setStatus(id: string, status: PurchaseStatus): Promise<PurchaseItem>;
  setQuantity(id: string, quantity: number): Promise<PurchaseItem>;
  remove(id: string): Promise<void>;
  /** After buying (or for an item you already own): create a permanent inventory item. */
  addToInventory(id: string): Promise<PurchaseItem>;
  /** Put it on the trip's packing list (unpacked). Linked to inventory if it was added there. */
  addToTrip(id: string): Promise<PurchaseItem>;
}

export function createPurchaseRepository(
  db: Database,
  deps: { createId: IdFactory; now?: () => Date },
): PurchaseRepository {
  const now = deps.now ?? (() => new Date());
  const stamp = () => now().toISOString();
  const inventory = createInventoryRepository(db, deps);

  async function get(id: string) {
    const row = await db.getFirstAsync<PurchaseRow>('SELECT * FROM purchase_items WHERE id = ?', [id]);
    if (!row) throw new PackingError('That purchase item no longer exists.');
    return row;
  }

  return {
    async list(tripId) {
      const rows = await db.getAllAsync<PurchaseRow>(
        `SELECT * FROM purchase_items ${tripId ? 'WHERE trip_id = ?' : ''}
         ORDER BY CASE status WHEN 'needed' THEN 0 WHEN 'purchased' THEN 1 ELSE 2 END, created_at DESC`,
        tripId ? [tripId] : [],
      );
      return rows.map(mapPurchase);
    },

    async add(tripId, input) {
      let result = { id: '', duplicate: false };
      await db.withTransactionAsync(async () => {
        result = await insertPurchase(db, deps.createId, { tripId, ...input }, stamp());
      });
      return { item: mapPurchase(await get(result.id)), duplicate: result.duplicate };
    },

    async setStatus(id, status) {
      if (!isStatus(status)) throw new PackingError('Unknown status.');
      const row = await get(id);
      const timestamp = stamp();
      const reopening = status === 'needed' || status === 'purchased';
      if (reopening && row.trip_id && !['needed', 'purchased'].includes(row.status)) {
        const clash = await db.getFirstAsync<{ id: string }>(
          `SELECT id FROM purchase_items WHERE trip_id = ? AND normalized_name = ? AND id <> ? AND status IN ${OPEN_STATUSES}`,
          [row.trip_id, row.normalized_name, id],
        );
        if (clash) throw new PackingError(`"${row.name}" is already on this purchase list.`);
      }
      await db.runAsync(
        `UPDATE purchase_items SET status = ?, purchased_at = ?, resolved_at = ?, updated_at = ? WHERE id = ?`,
        [
          status,
          status === 'purchased' ? (row.purchased_at ?? timestamp) : status === 'needed' ? null : row.purchased_at,
          status === 'needed' || status === 'purchased' ? null : timestamp,
          timestamp,
          id,
        ],
      );
      return mapPurchase(await get(id));
    },

    async setQuantity(id, quantity) {
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
        throw new PackingError('Quantity must be between 1 and 99.');
      }
      await db.runAsync('UPDATE purchase_items SET quantity = ?, updated_at = ? WHERE id = ?', [quantity, stamp(), id]);
      return mapPurchase(await get(id));
    },

    async remove(id) {
      await db.runAsync('DELETE FROM purchase_items WHERE id = ?', [id]);
    },

    async addToInventory(id) {
      const row = await get(id);
      if (row.inventory_item_id) throw new PackingError('Already added to your inventory.');
      if (row.status !== 'purchased' && row.status !== 'owned') {
        throw new PackingError('Mark it as purchased (or already owned) first.');
      }
      const item = await inventory.createItem({
        ...emptyItemInput(row.category_id),
        name: row.name,
        quantity: row.quantity,
      });
      await db.runAsync('UPDATE purchase_items SET inventory_item_id = ?, updated_at = ? WHERE id = ?', [item.id, stamp(), id]);
      return mapPurchase(await get(id));
    },

    async addToTrip(id) {
      const row = await get(id);
      if (!row.trip_id) throw new PackingError('The trip for this purchase no longer exists.');
      if (row.packing_entry_id) throw new PackingError('Already on the packing list.');
      if (row.status === 'needed' || row.status === 'skipped') {
        throw new PackingError('Mark it as purchased, owned or borrowed first.');
      }
      const timestamp = stamp();
      await db.withTransactionAsync(async () => {
        const entryId = await insertEntry(
          db,
          deps.createId,
          row.trip_id as string,
          {
            inventoryItemId: row.inventory_item_id,
            name: row.name,
            categoryId: row.category_id,
            quantity: row.quantity,
            source: 'purchase',
            notes: row.status === 'borrowed' ? 'Borrowed' : '',
          },
          timestamp,
        );
        await db.runAsync('UPDATE purchase_items SET packing_entry_id = ?, updated_at = ? WHERE id = ?', [entryId, timestamp, id]);
      });
      return mapPurchase(await get(id));
    },
  };
}
