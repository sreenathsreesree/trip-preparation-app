import type { Migration } from '../migrate';

const UUID_SQL = `lower(
  hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' ||
  substr('89ab', 1 + (abs(random()) % 4), 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))
)`;

/** Starter categories: system key, name, icon, colour. */
export const STARTER_CATEGORIES = [
  ['clothing', 'Clothing', 'tshirt-crew-outline', '#B8F36B'],
  ['footwear', 'Footwear', 'shoe-sneaker', '#F2B85B'],
  ['toiletries', 'Toiletries', 'toothbrush-paste', '#9DCBE5'],
  ['electronics', 'Electronics', 'cellphone-charging', '#B8A6F2'],
  ['documents', 'Documents', 'passport', '#E8EDF0'],
  ['medicines', 'Medicines and first aid', 'medical-bag', '#F28B7D'],
  ['accessories', 'Travel accessories', 'bag-personal-outline', '#6FD6C2'],
  ['outdoor', 'Camping and outdoor', 'tent', '#8FCB4A'],
  ['photography', 'Photography', 'camera-outline', '#D9C49A'],
  ['food', 'Food and essentials', 'food-apple-outline', '#F2B85B'],
  ['misc', 'Miscellaneous', 'shape-outline', '#9DCBE5'],
] as const;

/** A few starter subcategories so the hierarchy is visible from day one. */
const STARTER_SUBCATEGORIES = [
  ['clothing', 'Tops'],
  ['clothing', 'Bottoms'],
  ['clothing', 'Outerwear'],
  ['clothing', 'Innerwear and sleepwear'],
  ['electronics', 'Chargers and cables'],
  ['electronics', 'Devices'],
] as const;

const sqlString = (value: string) => `'${value.replace(/'/g, "''")}'`;

/**
 * Personal inventory and the trip packing engine.
 *
 * Core separation:
 * - `inventory_items` are reusable physical belongings (one row per belonging,
 *   with a quantity). They are never created or deleted by packing actions.
 * - `packing_entries` are trip-specific packing decisions. An entry may point
 *   to an inventory item (ON DELETE SET NULL) or be a one-time item. It keeps
 *   its own name, category, quantity, traveller, luggage and packed state.
 *
 * Other tables:
 * - `inventory_reservations`: quantity of an item held for a trip's dates.
 *   Created only when a trip's packing list is confirmed; released when an
 *   entry is removed; closed when the trip is completed or archived. Keeps
 *   history rows (`status`) and is shaped for future shared inventory.
 * - `trip_packing`: per-trip packing profile (activities, accommodation,
 *   laundry) and confirmation state.
 * - `trip_luggage`: bags/containers for a trip.
 * - `packing_recommendations`: rules-engine suggestions and the user's
 *   decisions (pending / accepted / rejected / stale), keyed by rule so
 *   regeneration never loses history.
 * - `purchase_items`: the shopping list. `trip_id` is SET NULL on trip delete
 *   and `trip_name` is snapshotted, so purchase history survives.
 * - `user_preferences`: small key/value settings (e.g. packing style).
 *
 * No existing table is altered; v2 trips and checklists are untouched.
 */
export const inventoryAndPacking: Migration = {
  version: 3,
  name: 'inventory_and_packing',
  async up(db) {
    await db.execAsync(`
      CREATE TABLE inventory_categories (
        id TEXT PRIMARY KEY NOT NULL,
        parent_id TEXT REFERENCES inventory_categories (id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        icon TEXT NOT NULL DEFAULT 'shape-outline',
        color TEXT NOT NULL DEFAULT '#9DCBE5',
        position INTEGER NOT NULL DEFAULT 0,
        cover_image_uri TEXT,
        system_key TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_inventory_categories_parent ON inventory_categories (parent_id, position);

      CREATE TABLE inventory_items (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        brand TEXT NOT NULL DEFAULT '',
        model TEXT NOT NULL DEFAULT '',
        quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity >= 0),
        weight_grams INTEGER CHECK (weight_grams IS NULL OR weight_grams >= 0),
        condition TEXT NOT NULL DEFAULT 'good',
        storage_location TEXT NOT NULL DEFAULT '',
        category_id TEXT REFERENCES inventory_categories (id) ON DELETE SET NULL,
        subcategory_id TEXT REFERENCES inventory_categories (id) ON DELETE SET NULL,
        availability TEXT NOT NULL DEFAULT 'available',
        image_uri TEXT,
        image_source TEXT,
        archived_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_inventory_items_category ON inventory_items (category_id);

      CREATE TABLE trip_packing (
        trip_id TEXT PRIMARY KEY NOT NULL REFERENCES trips (id) ON DELETE CASCADE,
        activities TEXT NOT NULL DEFAULT '[]',
        accommodation TEXT NOT NULL DEFAULT 'hotel',
        laundry INTEGER NOT NULL DEFAULT 0 CHECK (laundry IN (0, 1)),
        confirmed_at TEXT,
        draft_reason TEXT,
        suggestions_generated_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE trip_luggage (
        id TEXT PRIMARY KEY NOT NULL,
        trip_id TEXT NOT NULL REFERENCES trips (id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'custom',
        traveller_id TEXT REFERENCES trip_travellers (id) ON DELETE SET NULL,
        position INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_trip_luggage_trip ON trip_luggage (trip_id, position);

      CREATE TABLE packing_entries (
        id TEXT PRIMARY KEY NOT NULL,
        trip_id TEXT NOT NULL REFERENCES trips (id) ON DELETE CASCADE,
        inventory_item_id TEXT REFERENCES inventory_items (id) ON DELETE SET NULL,
        name TEXT NOT NULL,
        category_id TEXT REFERENCES inventory_categories (id) ON DELETE SET NULL,
        quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity >= 1),
        traveller_id TEXT REFERENCES trip_travellers (id) ON DELETE SET NULL,
        luggage_id TEXT REFERENCES trip_luggage (id) ON DELETE SET NULL,
        is_packed INTEGER NOT NULL DEFAULT 0 CHECK (is_packed IN (0, 1)),
        notes TEXT NOT NULL DEFAULT '',
        source TEXT NOT NULL DEFAULT 'manual',
        recommendation_id TEXT,
        position INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_packing_entries_trip ON packing_entries (trip_id, position);
      CREATE INDEX idx_packing_entries_item ON packing_entries (inventory_item_id);

      CREATE TABLE inventory_reservations (
        id TEXT PRIMARY KEY NOT NULL,
        inventory_item_id TEXT NOT NULL REFERENCES inventory_items (id) ON DELETE CASCADE,
        trip_id TEXT REFERENCES trips (id) ON DELETE SET NULL,
        packing_entry_id TEXT REFERENCES packing_entries (id) ON DELETE SET NULL,
        quantity INTEGER NOT NULL CHECK (quantity >= 1),
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        ended_at TEXT
      );
      CREATE INDEX idx_reservations_item ON inventory_reservations (inventory_item_id, status);
      CREATE INDEX idx_reservations_trip ON inventory_reservations (trip_id, status);

      CREATE TABLE packing_recommendations (
        id TEXT PRIMARY KEY NOT NULL,
        trip_id TEXT NOT NULL REFERENCES trips (id) ON DELETE CASCADE,
        rule_key TEXT NOT NULL,
        name TEXT NOT NULL,
        category_key TEXT NOT NULL DEFAULT 'misc',
        quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity >= 1),
        priority TEXT NOT NULL DEFAULT 'recommended',
        reason TEXT NOT NULL DEFAULT '',
        traveller_id TEXT REFERENCES trip_travellers (id) ON DELETE SET NULL,
        inventory_item_id TEXT REFERENCES inventory_items (id) ON DELETE SET NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        packing_entry_id TEXT REFERENCES packing_entries (id) ON DELETE SET NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        decided_at TEXT,
        UNIQUE (trip_id, rule_key)
      );

      CREATE TABLE purchase_items (
        id TEXT PRIMARY KEY NOT NULL,
        trip_id TEXT REFERENCES trips (id) ON DELETE SET NULL,
        trip_name TEXT NOT NULL DEFAULT '',
        name TEXT NOT NULL,
        normalized_name TEXT NOT NULL,
        quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity >= 1),
        category_id TEXT REFERENCES inventory_categories (id) ON DELETE SET NULL,
        status TEXT NOT NULL DEFAULT 'needed',
        recommendation_id TEXT,
        inventory_item_id TEXT REFERENCES inventory_items (id) ON DELETE SET NULL,
        packing_entry_id TEXT REFERENCES packing_entries (id) ON DELETE SET NULL,
        notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        purchased_at TEXT,
        resolved_at TEXT
      );
      CREATE INDEX idx_purchase_items_trip ON purchase_items (trip_id, status);
      -- One open (to buy / bought) entry per name per trip.
      CREATE UNIQUE INDEX idx_purchase_items_open_unique
        ON purchase_items (trip_id, normalized_name)
        WHERE trip_id IS NOT NULL AND status IN ('needed', 'purchased');

      CREATE TABLE user_preferences (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);

    const now = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
    const rows = STARTER_CATEGORIES.map(
      ([key, name, icon, color], index) =>
        `(${UUID_SQL}, NULL, ${sqlString(name)}, ${sqlString(icon)}, ${sqlString(color)}, ${index}, NULL, ${sqlString(key)}, ${now}, ${now})`,
    ).join(',\n');
    await db.execAsync(`
      INSERT INTO inventory_categories
        (id, parent_id, name, icon, color, position, cover_image_uri, system_key, created_at, updated_at)
      VALUES ${rows};
    `);

    for (let index = 0; index < STARTER_SUBCATEGORIES.length; index += 1) {
      const [parentKey, name] = STARTER_SUBCATEGORIES[index] as readonly [string, string];
      await db.execAsync(`
        INSERT INTO inventory_categories
          (id, parent_id, name, icon, color, position, cover_image_uri, system_key, created_at, updated_at)
        SELECT ${UUID_SQL}, p.id, ${sqlString(name)}, p.icon, p.color, ${index}, NULL, NULL, ${now}, ${now}
        FROM inventory_categories p WHERE p.system_key = ${sqlString(parentKey)} AND p.parent_id IS NULL;
      `);
    }
  },
};
