import type { Database } from '@/db/types';
import type { IdFactory } from '@/lib/id';

import { isCategoryKey, type CategoryKey } from '../inventory/model';
import { isPriority } from '../preparation/model';
import { isTransportMode, isTravellerKind, isTripCategory, type Traveller } from '../trips/model';
import {
  planRegeneration,
  type Recommendation,
  type RecommendationStatus,
  type RegenerationPlan,
  type Suggestion,
} from './model';
import { ensurePackingState, insertEntry, PackingError } from './packingRepository';
import { getPreferences } from './preferencesRepository';
import { insertPurchase } from './purchaseRepository';
import { generateSuggestions, type RecommendationInput } from './recommendations';

interface RecRow {
  id: string;
  trip_id: string;
  rule_key: string;
  name: string;
  category_key: string;
  quantity: number;
  priority: string;
  reason: string;
  traveller_id: string | null;
  inventory_item_id: string | null;
  status: string;
  packing_entry_id: string | null;
  created_at: string;
  updated_at: string;
  decided_at: string | null;
}

const STATUSES: readonly RecommendationStatus[] = ['pending', 'accepted', 'rejected', 'stale'];

function mapRecommendation(row: RecRow): Recommendation {
  return {
    id: row.id,
    tripId: row.trip_id,
    key: row.rule_key,
    name: row.name,
    categoryKey: isCategoryKey(row.category_key) ? row.category_key : 'misc',
    quantity: row.quantity,
    priority: isPriority(row.priority) ? row.priority : 'recommended',
    reason: row.reason,
    travellerId: row.traveller_id,
    inventoryItemId: row.inventory_item_id,
    status: (STATUSES as readonly string[]).includes(row.status) ? (row.status as RecommendationStatus) : 'pending',
    packingEntryId: row.packing_entry_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    decidedAt: row.decided_at,
  };
}

/** Collects everything the rules look at for one trip. */
export async function recommendationInput(db: Database, tripId: string): Promise<RecommendationInput> {
  const trip = await db.getFirstAsync<{
    start_date: string;
    end_date: string;
    transport_mode: string;
    category: string;
  }>('SELECT start_date, end_date, transport_mode, category FROM trips WHERE id = ?', [tripId]);
  if (!trip || !isTransportMode(trip.transport_mode) || !isTripCategory(trip.category)) {
    throw new PackingError('That trip no longer exists.');
  }
  const [destinations, travellers, state, inventory, preferences] = await Promise.all([
    db.getAllAsync<{ name: string }>('SELECT name FROM trip_destinations WHERE trip_id = ? ORDER BY position', [tripId]),
    db.getAllAsync<{ id: string; name: string; kind: string }>(
      'SELECT id, name, kind FROM trip_travellers WHERE trip_id = ? ORDER BY position',
      [tripId],
    ),
    db.getFirstAsync<{ activities: string; accommodation: string; laundry: number }>(
      'SELECT activities, accommodation, laundry FROM trip_packing WHERE trip_id = ?',
      [tripId],
    ),
    db.getAllAsync<{ id: string; name: string; description: string; system_key: string | null }>(
      `SELECT i.id, i.name, i.description, c.system_key FROM inventory_items i
       LEFT JOIN inventory_categories c ON c.id = i.category_id
       WHERE i.archived_at IS NULL`,
      [],
    ),
    getPreferences(db),
  ]);
  let activities: unknown = [];
  try {
    activities = JSON.parse(state?.activities ?? '[]');
  } catch {
    activities = [];
  }
  return {
    startDate: trip.start_date,
    endDate: trip.end_date,
    destinations: destinations.map((d) => d.name),
    transportMode: trip.transport_mode,
    category: trip.category,
    travellers: travellers.map(
      (t): Traveller => ({ id: t.id, name: t.name, kind: isTravellerKind(t.kind) ? t.kind : 'adult' }),
    ),
    activities: Array.isArray(activities) ? (activities as RecommendationInput['activities']) : [],
    accommodation: (state?.accommodation as RecommendationInput['accommodation']) ?? 'hotel',
    laundry: state?.laundry === 1,
    packingStyle: preferences.packingStyle,
    inventory: inventory.map((i) => ({
      id: i.id,
      name: i.name,
      description: i.description,
      categoryKey: isCategoryKey(i.system_key) ? i.system_key : null,
    })),
  };
}

async function categoryIdForKey(db: Database, key: CategoryKey): Promise<string | null> {
  const row = await db.getFirstAsync<{ id: string }>(
    'SELECT id FROM inventory_categories WHERE system_key = ? AND parent_id IS NULL',
    [key],
  );
  return row?.id ?? null;
}

export interface RecommendationRepository {
  list(tripId: string): Promise<Recommendation[]>;
  /** Fresh suggestions and how they differ from stored decisions. Changes nothing. */
  preview(tripId: string): Promise<{ suggestions: Suggestion[]; plan: RegenerationPlan; firstRun: boolean }>;
  /** Applies the current regeneration plan. Never touches packing entries or rejected suggestions. */
  apply(tripId: string): Promise<RegenerationPlan>;
  /** Approves suggestions: each becomes a packing entry (reserved if the list is confirmed). */
  accept(recommendationIds: readonly string[], overrides?: { quantity?: number }): Promise<number>;
  reject(recommendationId: string): Promise<void>;
  /** Undo a rejection: the suggestion becomes pending again. */
  restore(recommendationId: string): Promise<void>;
  /** Missing item: put it on the trip's purchase list instead of packing it now. */
  addToPurchaseList(recommendationId: string): Promise<{ duplicate: boolean }>;
}

export function createRecommendationRepository(
  db: Database,
  deps: { createId: IdFactory; now?: () => Date },
): RecommendationRepository {
  const now = deps.now ?? (() => new Date());
  const stamp = () => now().toISOString();

  async function list(tripId: string) {
    const rows = await db.getAllAsync<RecRow>(
      'SELECT * FROM packing_recommendations WHERE trip_id = ? ORDER BY created_at, rowid',
      [tripId],
    );
    return rows.map(mapRecommendation);
  }

  async function getRow(id: string) {
    const row = await db.getFirstAsync<RecRow>('SELECT * FROM packing_recommendations WHERE id = ?', [id]);
    if (!row) throw new PackingError('That suggestion no longer exists.');
    return row;
  }

  async function preview(tripId: string) {
    const input = await recommendationInput(db, tripId);
    const suggestions = generateSuggestions(input);
    const stored = await list(tripId);
    return { suggestions, plan: planRegeneration(stored, suggestions), firstRun: stored.length === 0 };
  }

  return {
    list,
    preview,

    async apply(tripId) {
      const { plan } = await preview(tripId);
      const timestamp = stamp();
      await db.withTransactionAsync(async () => {
        await ensurePackingState(db, tripId, timestamp);
        for (const s of plan.added) {
          await db.runAsync(
            `INSERT INTO packing_recommendations (id, trip_id, rule_key, name, category_key, quantity, priority, reason,
                                                  traveller_id, inventory_item_id, status, packing_entry_id, created_at, updated_at, decided_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NULL, ?, ?, NULL)`,
            [deps.createId(), tripId, s.key, s.name, s.categoryKey, s.quantity, s.priority, s.reason, s.travellerId, s.inventoryItemId, timestamp, timestamp],
          );
        }
        for (const { recommendation, next } of plan.updated) {
          // A stale suggestion that was accepted earlier goes back to accepted (its entry still exists).
          const status = recommendation.packingEntryId ? 'accepted' : 'pending';
          await db.runAsync(
            `UPDATE packing_recommendations SET name = ?, category_key = ?, quantity = ?, priority = ?, reason = ?,
                    inventory_item_id = ?, status = ?, updated_at = ? WHERE id = ?`,
            [next.name, next.categoryKey, next.quantity, next.priority, next.reason, next.inventoryItemId, status, timestamp, recommendation.id],
          );
        }
        for (const { recommendation, next } of plan.quantityChanged) {
          // Record the new suggestion only; the user's packing entry keeps its quantity.
          await db.runAsync(
            'UPDATE packing_recommendations SET quantity = ?, reason = ?, updated_at = ? WHERE id = ?',
            [next.quantity, next.reason, timestamp, recommendation.id],
          );
        }
        for (const recommendation of plan.noLongerRelevant) {
          await db.runAsync(`UPDATE packing_recommendations SET status = 'stale', updated_at = ? WHERE id = ?`, [
            timestamp,
            recommendation.id,
          ]);
        }
        await db.runAsync('UPDATE trip_packing SET suggestions_generated_at = ?, updated_at = ? WHERE trip_id = ?', [
          timestamp,
          timestamp,
          tripId,
        ]);
      });
      return plan;
    },

    async accept(recommendationIds, overrides = {}) {
      const timestamp = stamp();
      let accepted = 0;
      await db.withTransactionAsync(async () => {
        for (const id of recommendationIds) {
          const rec = await getRow(id);
          if (rec.status === 'accepted' && rec.packing_entry_id) continue;
          // Already on the list (e.g. added from the inventory)? Link it instead of duplicating.
          const listed = rec.inventory_item_id
            ? await db.getFirstAsync<{ id: string }>(
                `SELECT e.id FROM packing_entries e
                 WHERE e.trip_id = ? AND e.inventory_item_id = ? AND e.traveller_id IS ?
                   AND NOT EXISTS (SELECT 1 FROM packing_recommendations r WHERE r.packing_entry_id = e.id)
                 ORDER BY e.position LIMIT 1`,
                [rec.trip_id, rec.inventory_item_id, rec.traveller_id],
              )
            : null;
          if (listed) {
            await db.runAsync(
              `UPDATE packing_recommendations SET status = 'accepted', packing_entry_id = ?, decided_at = ?, updated_at = ? WHERE id = ?`,
              [listed.id, timestamp, timestamp, id],
            );
            accepted += 1;
            continue;
          }
          const categoryId = await categoryIdForKey(db, isCategoryKey(rec.category_key) ? rec.category_key : 'misc');
          // A damaged, lent-out or archived match cannot be packed: add a one-time entry instead.
          const usable = rec.inventory_item_id
            ? await db.getFirstAsync<{ id: string }>(
                `SELECT id FROM inventory_items WHERE id = ? AND availability = 'available' AND archived_at IS NULL`,
                [rec.inventory_item_id],
              )
            : null;
          const entryId = await insertEntry(
            db,
            deps.createId,
            rec.trip_id,
            {
              inventoryItemId: usable ? rec.inventory_item_id : null,
              name: rec.name,
              categoryId,
              quantity: overrides.quantity ?? rec.quantity,
              travellerId: rec.traveller_id,
              source: 'recommendation',
              recommendationId: rec.id,
            },
            timestamp,
          );
          await db.runAsync(
            `UPDATE packing_recommendations SET status = 'accepted', packing_entry_id = ?, decided_at = ?, updated_at = ? WHERE id = ?`,
            [entryId, timestamp, timestamp, id],
          );
          accepted += 1;
        }
      });
      return accepted;
    },

    async reject(recommendationId) {
      const rec = await getRow(recommendationId);
      if (rec.packing_entry_id) throw new PackingError('Remove it from the packing list instead.');
      const timestamp = stamp();
      await db.runAsync(
        `UPDATE packing_recommendations SET status = 'rejected', decided_at = ?, updated_at = ? WHERE id = ?`,
        [timestamp, timestamp, recommendationId],
      );
    },

    async restore(recommendationId) {
      const rec = await getRow(recommendationId);
      if (rec.status !== 'rejected') return;
      await db.runAsync(
        `UPDATE packing_recommendations SET status = 'pending', decided_at = NULL, updated_at = ? WHERE id = ?`,
        [stamp(), recommendationId],
      );
    },

    async addToPurchaseList(recommendationId) {
      const rec = await getRow(recommendationId);
      const timestamp = stamp();
      let duplicate = false;
      await db.withTransactionAsync(async () => {
        const categoryId = await categoryIdForKey(db, isCategoryKey(rec.category_key) ? rec.category_key : 'misc');
        const result = await insertPurchase(
          db,
          deps.createId,
          { tripId: rec.trip_id, name: rec.name, quantity: rec.quantity, categoryId, recommendationId: rec.id },
          timestamp,
        );
        duplicate = result.duplicate;
        await db.runAsync(
          `UPDATE packing_recommendations SET status = 'accepted', decided_at = ?, updated_at = ? WHERE id = ?`,
          [timestamp, timestamp, recommendationId],
        );
      });
      return { duplicate };
    },
  };
}
