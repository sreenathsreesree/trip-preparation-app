import type { Database } from '@/db/types';
import { todayISO, type ISODate } from '@/lib/dates';
import type { IdFactory } from '@/lib/id';
import type { IconName } from '@/theme/icons';

import { copyName } from '../trips/model';
import {
  INVENTORY_LIMITS,
  isAvailability,
  isCategoryKey,
  isProtectedCategory,
  isCondition,
  validateCategoryInput,
  validateItemInput,
  type Availability,
  type CategoryInput,
  type InventoryCategory,
  type InventoryItem,
  type InventoryItemSummary,
  type ItemInput,
} from './model';

interface CategoryRow {
  id: string;
  parent_id: string | null;
  name: string;
  icon: string;
  color: string;
  position: number;
  cover_image_uri: string | null;
  system_key: string | null;
  description: string | null;
  created_at: string;
  updated_at: string;
}

interface ItemRow {
  id: string;
  name: string;
  description: string;
  brand: string;
  model: string;
  quantity: number;
  weight_grams: number | null;
  condition: string;
  storage_location: string;
  category_id: string | null;
  subcategory_id: string | null;
  availability: string;
  image_uri: string | null;
  image_source: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  reserved_quantity?: number | null;
  packed_quantity?: number | null;
  trip_count?: number | null;
}

export class InventoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InventoryError';
  }
}

export function mapCategory(row: CategoryRow): InventoryCategory {
  return {
    id: row.id,
    parentId: row.parent_id,
    name: row.name,
    icon: row.icon as IconName,
    color: row.color,
    position: row.position,
    coverImageUri: row.cover_image_uri,
    systemKey: isCategoryKey(row.system_key) ? row.system_key : null,
    description: row.description ?? '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapItem(row: ItemRow): InventoryItem {
  const source = row.image_source;
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    brand: row.brand,
    model: row.model,
    quantity: row.quantity,
    weightGrams: row.weight_grams,
    condition: isCondition(row.condition) ? row.condition : 'good',
    storageLocation: row.storage_location,
    categoryId: row.category_id,
    subcategoryId: row.subcategory_id,
    availability: isAvailability(row.availability) ? row.availability : 'available',
    image:
      row.image_uri && (source === 'photo' || source === 'library' || source === 'suggested')
        ? { uri: row.image_uri, source }
        : null,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Usage is derived: active reservations for trips that have not ended yet,
 * packed quantities on those trips, and how many trips list the item at all.
 */
const ITEM_SELECT = `
  SELECT i.*,
    (SELECT COALESCE(SUM(r.quantity), 0) FROM inventory_reservations r
      WHERE r.inventory_item_id = i.id AND r.status = 'active' AND r.end_date >= ?) AS reserved_quantity,
    (SELECT COALESCE(SUM(e.quantity), 0) FROM packing_entries e
      JOIN inventory_reservations r ON r.packing_entry_id = e.id AND r.status = 'active' AND r.end_date >= ?
      WHERE e.inventory_item_id = i.id AND e.is_packed = 1) AS packed_quantity,
    (SELECT COUNT(DISTINCT e.trip_id) FROM packing_entries e WHERE e.inventory_item_id = i.id) AS trip_count
  FROM inventory_items i
`;

function summary(row: ItemRow): InventoryItemSummary {
  return {
    ...mapItem(row),
    usage: {
      reservedQuantity: Number(row.reserved_quantity) || 0,
      packedQuantity: Number(row.packed_quantity) || 0,
      tripCount: Number(row.trip_count) || 0,
    },
  };
}

/** Highest number of units held at the same time by overlapping reservations. */
export function peakReserved(reservations: readonly { startDate: ISODate; endDate: ISODate; quantity: number }[]): number {
  let peak = 0;
  for (const probe of reservations) {
    const concurrent = reservations
      .filter((r) => r.startDate <= probe.startDate && probe.startDate <= r.endDate)
      .reduce((sum, r) => sum + r.quantity, 0);
    peak = Math.max(peak, concurrent);
  }
  return peak;
}

export interface ItemTripUsage {
  tripId: string;
  tripName: string;
  startDate: ISODate;
  endDate: ISODate;
  quantity: number;
  packed: boolean;
  reserved: boolean;
}

export interface InventoryRepository {
  listCategories(): Promise<InventoryCategory[]>;
  createCategory(input: CategoryInput): Promise<InventoryCategory>;
  updateCategory(id: string, input: CategoryInput): Promise<InventoryCategory>;
  moveCategory(id: string, direction: -1 | 1): Promise<boolean>;
  /** Deletes a category (and its subcategories). Items are kept and become uncategorised. */
  deleteCategory(id: string): Promise<{ orphanedImageUri: string | null }>;

  listItems(): Promise<InventoryItemSummary[]>;
  getItem(id: string): Promise<InventoryItemSummary | null>;
  createItem(input: ItemInput): Promise<InventoryItemSummary>;
  /** Returns the previous image URI when it is no longer referenced anywhere (so its file can be removed). */
  updateItem(id: string, input: ItemInput): Promise<{ item: InventoryItemSummary; orphanedImageUri: string | null }>;
  duplicateItem(id: string): Promise<InventoryItemSummary>;
  setArchived(id: string, archived: boolean): Promise<InventoryItemSummary>;
  setAvailability(id: string, availability: Availability): Promise<InventoryItemSummary>;
  adjustQuantity(id: string, delta: number): Promise<InventoryItemSummary>;
  /** Deletes the belonging. Trip packing entries keep their own copy of the name as one-time items. */
  deleteItem(id: string): Promise<{ orphanedImageUri: string | null }>;
  usage(id: string): Promise<ItemTripUsage[]>;
  countItems(): Promise<number>;
}

export function createInventoryRepository(
  db: Database,
  deps: { createId: IdFactory; now?: () => Date; today?: () => ISODate },
): InventoryRepository {
  const now = deps.now ?? (() => new Date());
  const today = deps.today ?? todayISO;
  const stamp = () => now().toISOString();

  async function getItem(id: string) {
    const t = today();
    const row = await db.getFirstAsync<ItemRow>(`${ITEM_SELECT} WHERE i.id = ?`, [t, t, id]);
    return row ? summary(row) : null;
  }

  async function mustGetItem(id: string) {
    const item = await getItem(id);
    if (!item) throw new InventoryError('That item no longer exists.');
    return item;
  }

  async function getCategory(id: string) {
    const row = await db.getFirstAsync<CategoryRow>('SELECT * FROM inventory_categories WHERE id = ?', [id]);
    return row ? mapCategory(row) : null;
  }

  /** True when no item or category still points at the URI. */
  async function isUnreferenced(uri: string | null): Promise<boolean> {
    if (!uri) return false;
    const row = await db.getFirstAsync<{ n: number }>(
      `SELECT (SELECT COUNT(*) FROM inventory_items WHERE image_uri = ?) +
              (SELECT COUNT(*) FROM inventory_categories WHERE cover_image_uri = ?) AS n`,
      [uri, uri],
    );
    return (row?.n ?? 0) === 0;
  }

  async function activeReservations(itemId: string) {
    return db.getAllAsync<{ start_date: string; end_date: string; quantity: number }>(
      `SELECT start_date, end_date, quantity FROM inventory_reservations
       WHERE inventory_item_id = ? AND status = 'active' AND end_date >= ?`,
      [itemId, today()],
    );
  }

  async function assertQuantityCoversReservations(itemId: string, quantity: number) {
    const rows = await activeReservations(itemId);
    const peak = peakReserved(rows.map((r) => ({ startDate: r.start_date, endDate: r.end_date, quantity: r.quantity })));
    if (quantity < peak) {
      throw new InventoryError(
        `${peak} ${peak === 1 ? 'is' : 'are'} reserved for overlapping trips. Reduce those packing lists first.`,
      );
    }
  }

  async function validateCategoryRefs(input: Pick<ItemInput, 'categoryId' | 'subcategoryId'>) {
    if (input.categoryId) {
      const category = await getCategory(input.categoryId);
      if (!category || category.parentId) throw new InventoryError('Choose a valid category.');
    }
    if (input.subcategoryId) {
      const sub = await getCategory(input.subcategoryId);
      if (!sub || sub.parentId !== input.categoryId) throw new InventoryError('Choose a subcategory of the selected category.');
    }
  }

  function cleanItem(input: ItemInput): ItemInput {
    const first = Object.values(validateItemInput(input))[0];
    if (first) throw new InventoryError(first);
    return {
      ...input,
      name: input.name.trim().replace(/\s+/g, ' '),
      description: input.description.trim(),
      brand: input.brand.trim(),
      model: input.model.trim(),
      storageLocation: input.storageLocation.trim(),
      weightGrams: input.weightGrams === null ? null : Math.round(input.weightGrams),
      subcategoryId: input.categoryId ? input.subcategoryId : null,
    };
  }

  function cleanCategory(input: CategoryInput): CategoryInput {
    const first = Object.values(validateCategoryInput(input))[0];
    if (first) throw new InventoryError(first);
    return {
      ...input,
      name: input.name.trim().replace(/\s+/g, ' '),
      description: input.description === undefined ? undefined : input.description.trim(),
    };
  }

  return {
    async listCategories() {
      const rows = await db.getAllAsync<CategoryRow>(
        'SELECT * FROM inventory_categories ORDER BY position ASC, created_at ASC',
        [],
      );
      return rows.map(mapCategory);
    },

    async createCategory(input) {
      const clean = cleanCategory(input);
      if (clean.parentId) {
        const parent = await getCategory(clean.parentId);
        if (!parent || parent.parentId) throw new InventoryError('Subcategories can only be one level deep.');
      }
      const id = deps.createId();
      const timestamp = stamp();
      const next = await db.getFirstAsync<{ next: number }>(
        `SELECT COALESCE(MAX(position) + 1, 0) AS next FROM inventory_categories WHERE parent_id IS ?`,
        [clean.parentId],
      );
      await db.runAsync(
        `INSERT INTO inventory_categories (id, parent_id, name, icon, color, position, cover_image_uri, system_key, description, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
        [id, clean.parentId, clean.name, clean.icon, clean.color, next?.next ?? 0, clean.coverImageUri, clean.description ?? '', timestamp, timestamp],
      );
      return (await getCategory(id)) as InventoryCategory;
    },

    async updateCategory(id, input) {
      const existing = await getCategory(id);
      if (!existing) throw new InventoryError('That category no longer exists.');
      const clean = cleanCategory(input);
      // The hierarchy level of a category is fixed once created.
      await db.runAsync(
        `UPDATE inventory_categories SET name = ?, icon = ?, color = ?, cover_image_uri = ?, description = ?, updated_at = ? WHERE id = ?`,
        [clean.name, clean.icon, clean.color, clean.coverImageUri, clean.description ?? existing.description, stamp(), id],
      );
      return (await getCategory(id)) as InventoryCategory;
    },

    async moveCategory(id, direction) {
      const category = await getCategory(id);
      if (!category) return false;
      const siblings = await db.getAllAsync<{ id: string }>(
        `SELECT id FROM inventory_categories WHERE parent_id IS ? ORDER BY position ASC, created_at ASC`,
        [category.parentId],
      );
      const order = siblings.map((s) => s.id);
      const index = order.indexOf(id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= order.length) return false;
      [order[index], order[target]] = [order[target] as string, order[index] as string];
      const timestamp = stamp();
      await db.withTransactionAsync(async () => {
        for (let position = 0; position < order.length; position += 1) {
          await db.runAsync('UPDATE inventory_categories SET position = ?, updated_at = ? WHERE id = ?', [
            position,
            timestamp,
            order[position] as string,
          ]);
        }
      });
      return true;
    },

    async deleteCategory(id) {
      const category = await getCategory(id);
      if (!category) return { orphanedImageUri: null };
      if (isProtectedCategory(category)) {
        throw new InventoryError(`${category.name} is a starter category. You can rename or reorder it, but not delete it.`);
      }
      // Items keep existing: FK actions set category/subcategory to NULL, and
      // trip packing entries simply lose the category label.
      await db.runAsync('DELETE FROM inventory_categories WHERE id = ?', [id]);
      return {
        orphanedImageUri: (await isUnreferenced(category.coverImageUri)) ? category.coverImageUri : null,
      };
    },

    async listItems() {
      const t = today();
      const rows = await db.getAllAsync<ItemRow>(`${ITEM_SELECT} ORDER BY i.name COLLATE NOCASE ASC`, [t, t]);
      return rows.map(summary);
    },

    getItem,

    async createItem(input) {
      const clean = cleanItem(input);
      await validateCategoryRefs(clean);
      const id = deps.createId();
      const timestamp = stamp();
      await db.runAsync(
        `INSERT INTO inventory_items (id, name, description, brand, model, quantity, weight_grams, condition,
                                      storage_location, category_id, subcategory_id, availability, image_uri,
                                      image_source, archived_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
        [
          id,
          clean.name,
          clean.description,
          clean.brand,
          clean.model,
          clean.quantity,
          clean.weightGrams,
          clean.condition,
          clean.storageLocation,
          clean.categoryId,
          clean.subcategoryId,
          clean.availability,
          clean.image?.uri ?? null,
          clean.image?.source ?? null,
          timestamp,
          timestamp,
        ],
      );
      return mustGetItem(id);
    },

    async updateItem(id, input) {
      const existing = await mustGetItem(id);
      const clean = cleanItem(input);
      await validateCategoryRefs(clean);
      if (clean.quantity < existing.quantity) await assertQuantityCoversReservations(id, clean.quantity);
      await db.runAsync(
        `UPDATE inventory_items SET name = ?, description = ?, brand = ?, model = ?, quantity = ?, weight_grams = ?,
                condition = ?, storage_location = ?, category_id = ?, subcategory_id = ?, availability = ?,
                image_uri = ?, image_source = ?, updated_at = ?
         WHERE id = ?`,
        [
          clean.name,
          clean.description,
          clean.brand,
          clean.model,
          clean.quantity,
          clean.weightGrams,
          clean.condition,
          clean.storageLocation,
          clean.categoryId,
          clean.subcategoryId,
          clean.availability,
          clean.image?.uri ?? null,
          clean.image?.source ?? null,
          stamp(),
          id,
        ],
      );
      const previous = existing.image?.uri ?? null;
      const orphanedImageUri =
        previous && previous !== clean.image?.uri && (await isUnreferenced(previous)) ? previous : null;
      return { item: await mustGetItem(id), orphanedImageUri };
    },

    async duplicateItem(id) {
      const source = await mustGetItem(id);
      const copyId = deps.createId();
      const timestamp = stamp();
      // The copy shares the image reference; files are only removed once nothing points at them.
      await db.runAsync(
        `INSERT INTO inventory_items (id, name, description, brand, model, quantity, weight_grams, condition,
                                      storage_location, category_id, subcategory_id, availability, image_uri,
                                      image_source, archived_at, created_at, updated_at)
         SELECT ?, ?, description, brand, model, quantity, weight_grams, condition, storage_location, category_id,
                subcategory_id, 'available', image_uri, image_source, NULL, ?, ?
         FROM inventory_items WHERE id = ?`,
        [copyId, copyName(source.name, INVENTORY_LIMITS.nameMax), timestamp, timestamp, id],
      );
      return mustGetItem(copyId);
    },

    async setArchived(id, archived) {
      const item = await mustGetItem(id);
      if (archived && item.usage.reservedQuantity > 0) {
        throw new InventoryError('This item is reserved for an upcoming trip. Remove it from that packing list first.');
      }
      await db.runAsync('UPDATE inventory_items SET archived_at = ?, updated_at = ? WHERE id = ?', [
        archived ? stamp() : null,
        stamp(),
        id,
      ]);
      return mustGetItem(id);
    },

    async setAvailability(id, availability) {
      if (!isAvailability(availability)) throw new InventoryError('Unknown status.');
      await mustGetItem(id);
      await db.runAsync('UPDATE inventory_items SET availability = ?, updated_at = ? WHERE id = ?', [
        availability,
        stamp(),
        id,
      ]);
      return mustGetItem(id);
    },

    async adjustQuantity(id, delta) {
      const item = await mustGetItem(id);
      const next = item.quantity + delta;
      if (!Number.isInteger(delta) || next < 0 || next > INVENTORY_LIMITS.quantityMax) {
        throw new InventoryError(`Quantity must stay between 0 and ${INVENTORY_LIMITS.quantityMax}.`);
      }
      if (delta < 0) await assertQuantityCoversReservations(id, next);
      await db.runAsync('UPDATE inventory_items SET quantity = ?, updated_at = ? WHERE id = ?', [next, stamp(), id]);
      return mustGetItem(id);
    },

    async deleteItem(id) {
      const item = await getItem(id);
      if (!item) return { orphanedImageUri: null };
      await db.runAsync('DELETE FROM inventory_items WHERE id = ?', [id]);
      const uri = item.image?.source === 'photo' ? item.image.uri : null;
      return { orphanedImageUri: (await isUnreferenced(uri)) ? uri : null };
    },

    async usage(id) {
      const rows = await db.getAllAsync<{
        trip_id: string;
        name: string;
        start_date: string;
        end_date: string;
        quantity: number;
        packed: number;
        reserved: number;
      }>(
        `SELECT t.id AS trip_id, t.name, t.start_date, t.end_date,
                SUM(e.quantity) AS quantity, MIN(e.is_packed) AS packed,
                (SELECT COUNT(*) FROM inventory_reservations r
                  WHERE r.trip_id = t.id AND r.inventory_item_id = ? AND r.status = 'active') AS reserved
         FROM packing_entries e JOIN trips t ON t.id = e.trip_id
         WHERE e.inventory_item_id = ?
         GROUP BY t.id ORDER BY t.start_date ASC`,
        [id, id],
      );
      return rows.map((r) => ({
        tripId: r.trip_id,
        tripName: r.name,
        startDate: r.start_date,
        endDate: r.end_date,
        quantity: Number(r.quantity) || 0,
        packed: r.packed === 1,
        reserved: Number(r.reserved) > 0,
      }));
    },

    async countItems() {
      const row = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM inventory_items WHERE archived_at IS NULL', []);
      return row?.n ?? 0;
    },
  };
}

