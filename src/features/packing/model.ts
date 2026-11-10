import type { ISODate } from '@/lib/dates';
import { colors } from '@/theme/colors';
import type { IconName } from '@/theme/icons';

import type { Availability, CategoryKey } from '../inventory/model';
import type { Priority } from '../preparation/model';

/* ------------------------------------------------------------------ */
/* Trip packing profile                                                */
/* ------------------------------------------------------------------ */

export const ACTIVITIES = [
  'trekking',
  'swimming',
  'snow',
  'camping',
  'photography',
  'business',
  'temple',
  'nightlife',
  'cycling',
  'road_trip',
] as const;
export type Activity = (typeof ACTIVITIES)[number];

export const ACTIVITY_META: Record<Activity, { label: string; icon: IconName }> = {
  trekking: { label: 'Trekking', icon: 'hiking' },
  swimming: { label: 'Swimming', icon: 'swim' },
  snow: { label: 'Snow', icon: 'snowflake' },
  camping: { label: 'Camping', icon: 'tent' },
  photography: { label: 'Photography', icon: 'camera-outline' },
  business: { label: 'Meetings', icon: 'briefcase-outline' },
  temple: { label: 'Temple visits', icon: 'temple-hindu' },
  nightlife: { label: 'Evenings out', icon: 'glass-cocktail' },
  cycling: { label: 'Cycling', icon: 'bike' },
  road_trip: { label: 'Long drives', icon: 'road-variant' },
};

export const ACCOMMODATIONS = ['hotel', 'homestay', 'hostel', 'camping', 'family', 'train_bus'] as const;
export type Accommodation = (typeof ACCOMMODATIONS)[number];

export const ACCOMMODATION_META: Record<Accommodation, { label: string; icon: IconName }> = {
  hotel: { label: 'Hotel', icon: 'office-building-outline' },
  homestay: { label: 'Homestay', icon: 'home-outline' },
  hostel: { label: 'Hostel', icon: 'bunk-bed-outline' },
  camping: { label: 'Tent / camp', icon: 'tent' },
  family: { label: 'Family or friends', icon: 'home-heart' },
  train_bus: { label: 'Overnight train/bus', icon: 'train' },
};

export interface TripPackingState {
  tripId: string;
  activities: Activity[];
  accommodation: Accommodation;
  laundry: boolean;
  /** Set when the user confirms the packing list; reservations exist only then. */
  confirmedAt: string | null;
  /** Why a confirmed list was returned to draft (shown once to the user). */
  draftReason: string | null;
  suggestionsGeneratedAt: string | null;
}

export const PACKING_STYLES = ['light', 'standard', 'thorough'] as const;
export type PackingStyle = (typeof PACKING_STYLES)[number];
export const PACKING_STYLE_META: Record<PackingStyle, { label: string; description: string }> = {
  light: { label: 'Pack light', description: 'Fewer clothes, assume you can re-wear and wash.' },
  standard: { label: 'Standard', description: 'A sensible amount for each day.' },
  thorough: { label: 'Be prepared', description: 'A spare of the essentials, just in case.' },
};

export interface UserPreferences {
  packingStyle: PackingStyle;
}

export const DEFAULT_PREFERENCES: UserPreferences = { packingStyle: 'standard' };

export const isActivity = (v: unknown): v is Activity =>
  typeof v === 'string' && (ACTIVITIES as readonly string[]).includes(v);
export const isAccommodation = (v: unknown): v is Accommodation =>
  typeof v === 'string' && (ACCOMMODATIONS as readonly string[]).includes(v);
export const isPackingStyle = (v: unknown): v is PackingStyle =>
  typeof v === 'string' && (PACKING_STYLES as readonly string[]).includes(v);

/* ------------------------------------------------------------------ */
/* Luggage                                                             */
/* ------------------------------------------------------------------ */

export const LUGGAGE_KINDS = ['suitcase', 'cabin', 'backpack', 'daypack', 'camera', 'custom'] as const;
export type LuggageKind = (typeof LUGGAGE_KINDS)[number];
export const LUGGAGE_META: Record<LuggageKind, { label: string; icon: IconName }> = {
  suitcase: { label: 'Main suitcase', icon: 'bag-suitcase-outline' },
  cabin: { label: 'Cabin bag', icon: 'bag-carry-on' },
  backpack: { label: 'Backpack', icon: 'bag-personal-outline' },
  daypack: { label: 'Daypack', icon: 'bag-personal-tag-outline' },
  camera: { label: 'Camera bag', icon: 'camera-outline' },
  custom: { label: 'Custom bag', icon: 'bag-checked' },
};
export const isLuggageKind = (v: unknown): v is LuggageKind =>
  typeof v === 'string' && (LUGGAGE_KINDS as readonly string[]).includes(v);

export interface Luggage {
  id: string;
  tripId: string;
  name: string;
  kind: LuggageKind;
  travellerId: string | null;
  position: number;
}

/* ------------------------------------------------------------------ */
/* Packing entries                                                     */
/* ------------------------------------------------------------------ */

export type EntrySource = 'manual' | 'inventory' | 'recommendation' | 'purchase';

/**
 * A trip-specific packing decision. It may reference an inventory item but
 * owns its name, category, quantity, assignment and packed state.
 */
export interface PackingEntry {
  id: string;
  tripId: string;
  /** Null for one-time items (or if the inventory item was later deleted). */
  inventoryItemId: string | null;
  name: string;
  categoryId: string | null;
  quantity: number;
  travellerId: string | null;
  luggageId: string | null;
  isPacked: boolean;
  notes: string;
  source: EntrySource;
  recommendationId: string | null;
  position: number;
  createdAt: string;
  updatedAt: string;
}

export interface EntryPatch {
  name?: string;
  categoryId?: string | null;
  quantity?: number;
  travellerId?: string | null;
  luggageId?: string | null;
  isPacked?: boolean;
  notes?: string;
}

export interface NewEntryInput {
  inventoryItemId?: string | null;
  name: string;
  categoryId?: string | null;
  quantity?: number;
  travellerId?: string | null;
  luggageId?: string | null;
  notes?: string;
  source?: EntrySource;
  recommendationId?: string | null;
}

export const PACKING_LIMITS = { nameMax: 80, notesMax: 300, quantityMax: 99, luggageNameMax: 40 } as const;

/* ------------------------------------------------------------------ */
/* Reservations                                                        */
/* ------------------------------------------------------------------ */

export interface DateRange {
  startDate: ISODate;
  endDate: ISODate;
}

export interface ActiveReservation extends DateRange {
  inventoryItemId: string;
  tripId: string | null;
  quantity: number;
}

export function datesOverlap(a: DateRange, b: DateRange): boolean {
  return a.startDate <= b.endDate && b.startDate <= a.endDate;
}

/**
 * Quantity of an item still free for `range`, ignoring reservations held by
 * `excludeTripId` (the trip being planned).
 */
export function availableQuantity(
  itemQuantity: number,
  reservations: readonly ActiveReservation[],
  range: DateRange,
  excludeTripId: string | null,
): number {
  const held = reservations
    .filter((r) => r.tripId !== excludeTripId && datesOverlap(r, range))
    .reduce((sum, r) => sum + r.quantity, 0);
  return Math.max(0, itemQuantity - held);
}

export type ConflictReason = 'insufficient' | 'damaged' | 'borrowed' | 'archived' | 'missing';

export interface ReservationConflict {
  inventoryItemId: string;
  name: string;
  requested: number;
  available: number;
  reason: ConflictReason;
}

export interface ReservableItem {
  id: string;
  name: string;
  quantity: number;
  availability: Availability;
  archivedAt: string | null;
}

/**
 * Checks whether a trip's inventory-linked entries can be reserved for its
 * dates. Quantities of several entries for the same item are added up.
 */
export function findReservationConflicts(
  tripId: string,
  range: DateRange,
  entries: readonly Pick<PackingEntry, 'inventoryItemId' | 'quantity'>[],
  items: ReadonlyMap<string, ReservableItem>,
  reservations: readonly ActiveReservation[],
): ReservationConflict[] {
  const requested = new Map<string, number>();
  for (const entry of entries) {
    if (!entry.inventoryItemId) continue;
    requested.set(entry.inventoryItemId, (requested.get(entry.inventoryItemId) ?? 0) + entry.quantity);
  }
  const conflicts: ReservationConflict[] = [];
  for (const [itemId, quantity] of requested) {
    const item = items.get(itemId);
    if (!item) {
      conflicts.push({ inventoryItemId: itemId, name: 'Unknown item', requested: quantity, available: 0, reason: 'missing' });
      continue;
    }
    const available = availableQuantity(
      item.quantity,
      reservations.filter((r) => r.inventoryItemId === itemId),
      range,
      tripId,
    );
    const reason: ConflictReason | null = item.archivedAt
      ? 'archived'
      : item.availability === 'damaged'
        ? 'damaged'
        : item.availability === 'borrowed'
          ? 'borrowed'
          : quantity > available
            ? 'insufficient'
            : null;
    if (reason) conflicts.push({ inventoryItemId: itemId, name: item.name, requested: quantity, available, reason });
  }
  return conflicts;
}

export function describeConflict(conflict: ReservationConflict): string {
  switch (conflict.reason) {
    case 'damaged':
      return `${conflict.name} is marked damaged and cannot be reserved.`;
    case 'borrowed':
      return `${conflict.name} is marked borrowed (lent out) and cannot be reserved.`;
    case 'archived':
      return `${conflict.name} is archived.`;
    case 'missing':
      return 'An inventory item on this list no longer exists.';
    case 'insufficient':
      return `${conflict.name}: ${conflict.requested} needed, only ${conflict.available} free for these dates.`;
  }
}

/* ------------------------------------------------------------------ */
/* Progress and luggage summaries                                      */
/* ------------------------------------------------------------------ */

export interface PackingProgress {
  entries: number;
  packedEntries: number;
  units: number;
  packedUnits: number;
}

export function packingProgress(entries: readonly Pick<PackingEntry, 'quantity' | 'isPacked'>[]): PackingProgress {
  let units = 0;
  let packedUnits = 0;
  let packedEntries = 0;
  for (const entry of entries) {
    units += entry.quantity;
    if (entry.isPacked) {
      packedUnits += entry.quantity;
      packedEntries += 1;
    }
  }
  return { entries: entries.length, packedEntries, units, packedUnits };
}

export interface WeightEstimate {
  /** Sum of known weights (grams). */
  knownGrams: number;
  /** Units whose weight is unknown — the estimate is incomplete when > 0. */
  unknownUnits: number;
}

export function estimateWeight(
  entries: readonly Pick<PackingEntry, 'inventoryItemId' | 'quantity'>[],
  weightOf: (inventoryItemId: string) => number | null,
): WeightEstimate {
  let knownGrams = 0;
  let unknownUnits = 0;
  for (const entry of entries) {
    const weight = entry.inventoryItemId ? weightOf(entry.inventoryItemId) : null;
    if (weight === null) unknownUnits += entry.quantity;
    else knownGrams += weight * entry.quantity;
  }
  return { knownGrams, unknownUnits };
}

/* ------------------------------------------------------------------ */
/* Recommendations                                                     */
/* ------------------------------------------------------------------ */

export type RecommendationStatus = 'pending' | 'accepted' | 'rejected' | 'stale';

export interface Suggestion {
  /** Stable key (rule + traveller) used to match across regenerations. */
  key: string;
  name: string;
  quantity: number;
  priority: Priority;
  reason: string;
  categoryKey: CategoryKey;
  travellerId: string | null;
  /** Best-matching inventory item, if the user owns one. */
  inventoryItemId: string | null;
}

export interface Recommendation extends Suggestion {
  id: string;
  tripId: string;
  status: RecommendationStatus;
  packingEntryId: string | null;
  createdAt: string;
  updatedAt: string;
  decidedAt: string | null;
}

export interface RegenerationPlan {
  /** Suggestions not seen before. */
  added: Suggestion[];
  /** Undecided suggestions whose details changed. */
  updated: { recommendation: Recommendation; next: Suggestion }[];
  /** Accepted suggestions whose suggested quantity changed (the packing entry is not touched). */
  quantityChanged: { recommendation: Recommendation; next: Suggestion }[];
  /** Pending or accepted suggestions the rules no longer produce. */
  noLongerRelevant: Recommendation[];
  /** Rejected suggestions the rules still produce — kept rejected. */
  stillRejected: Recommendation[];
}

/**
 * Compares fresh suggestions with stored decisions. Pure: applying the plan is
 * a separate, user-confirmed step, and it never touches packing entries.
 */
export function planRegeneration(
  stored: readonly Recommendation[],
  fresh: readonly Suggestion[],
): RegenerationPlan {
  const byKey = new Map(stored.map((r) => [r.key, r]));
  const freshKeys = new Set(fresh.map((s) => s.key));
  const plan: RegenerationPlan = { added: [], updated: [], quantityChanged: [], noLongerRelevant: [], stillRejected: [] };

  for (const suggestion of fresh) {
    const existing = byKey.get(suggestion.key);
    if (!existing) {
      plan.added.push(suggestion);
      continue;
    }
    if (existing.status === 'rejected') {
      plan.stillRejected.push(existing);
    } else if (existing.status === 'pending' || existing.status === 'stale') {
      const changed =
        existing.status === 'stale' ||
        existing.quantity !== suggestion.quantity ||
        existing.reason !== suggestion.reason ||
        existing.priority !== suggestion.priority ||
        existing.name !== suggestion.name ||
        existing.inventoryItemId !== suggestion.inventoryItemId;
      if (changed) plan.updated.push({ recommendation: existing, next: suggestion });
    } else if (existing.status === 'accepted' && existing.quantity !== suggestion.quantity) {
      plan.quantityChanged.push({ recommendation: existing, next: suggestion });
    }
  }
  for (const recommendation of stored) {
    if (!freshKeys.has(recommendation.key) && (recommendation.status === 'pending' || recommendation.status === 'accepted')) {
      plan.noLongerRelevant.push(recommendation);
    }
  }
  return plan;
}

export function planHasChanges(plan: RegenerationPlan): boolean {
  return (
    plan.added.length + plan.updated.length + plan.quantityChanged.length + plan.noLongerRelevant.length > 0
  );
}

/* ------------------------------------------------------------------ */
/* Purchases                                                           */
/* ------------------------------------------------------------------ */

export const PURCHASE_STATUSES = ['needed', 'purchased', 'owned', 'borrowed', 'skipped'] as const;
export type PurchaseStatus = (typeof PURCHASE_STATUSES)[number];
export const PURCHASE_STATUS_META: Record<PurchaseStatus, { label: string; icon: IconName; color: string }> = {
  needed: { label: 'To buy', icon: 'cart-outline', color: colors.warning },
  purchased: { label: 'Purchased', icon: 'cart-check', color: colors.accent },
  owned: { label: 'Already owned', icon: 'home-outline', color: colors.info },
  borrowed: { label: 'Borrowing', icon: 'account-arrow-left-outline', color: colors.violet },
  skipped: { label: 'Skipped', icon: 'close-circle-outline', color: colors.neutral },
};

export interface PurchaseItem {
  id: string;
  /** Null once the trip has been deleted; `tripName` keeps the history readable. */
  tripId: string | null;
  tripName: string;
  name: string;
  quantity: number;
  categoryId: string | null;
  status: PurchaseStatus;
  recommendationId: string | null;
  inventoryItemId: string | null;
  packingEntryId: string | null;
  notes: string;
  createdAt: string;
  updatedAt: string;
  purchasedAt: string | null;
  resolvedAt: string | null;
}
