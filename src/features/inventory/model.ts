import { categoryPalette, colors } from '@/theme/colors';
import type { IconName } from '@/theme/icons';

/* ------------------------------------------------------------------ */
/* Categories                                                          */
/* ------------------------------------------------------------------ */

/** Stable identities of the starter categories (used by the recommendation rules). */
export const CATEGORY_KEYS = [
  'clothing',
  'footwear',
  'toiletries',
  'electronics',
  'documents',
  'medicines',
  'accessories',
  'outdoor',
  'photography',
  'food',
  'misc',
] as const;
export type CategoryKey = (typeof CATEGORY_KEYS)[number];

export const CATEGORY_COLORS = categoryPalette;

/** Icons offered when creating or editing a category. */
export const CATEGORY_ICONS: readonly IconName[] = [
  'tshirt-crew-outline',
  'shoe-sneaker',
  'toothbrush-paste',
  'cellphone-charging',
  'passport',
  'medical-bag',
  'bag-personal-outline',
  'tent',
  'camera-outline',
  'food-apple-outline',
  'shape-outline',
  'hanger',
  'glasses',
  'watch',
  'umbrella-outline',
  'baby-face-outline',
  'dog',
  'bike',
  'swim',
  'ski',
  'fish',
  'book-open-variant',
  'gamepad-variant-outline',
  'gift-outline',
];

export interface InventoryCategory {
  id: string;
  /** Set for subcategories. */
  parentId: string | null;
  name: string;
  icon: IconName;
  color: string;
  position: number;
  coverImageUri: string | null;
  /** Identity of a starter category (survives renaming); null for user categories. */
  systemKey: CategoryKey | null;
  /** Optional text shown with the category (may be empty). */
  description: string;
  createdAt: string;
  updatedAt: string;
}

export interface CategoryInput {
  name: string;
  /** Optional; omitted keeps the current description (or empty for new categories). */
  description?: string;
  icon: IconName;
  color: string;
  parentId: string | null;
  coverImageUri: string | null;
}

/* ------------------------------------------------------------------ */
/* Items                                                               */
/* ------------------------------------------------------------------ */

export const ITEM_CONDITIONS = ['new', 'good', 'worn', 'needs_repair'] as const;
export type ItemCondition = (typeof ITEM_CONDITIONS)[number];
export const CONDITION_LABELS: Record<ItemCondition, string> = {
  new: 'New',
  good: 'Good',
  worn: 'Worn',
  needs_repair: 'Needs repair',
};

/** Stored, user-controlled availability. */
export const AVAILABILITIES = ['available', 'borrowed', 'damaged'] as const;
export type Availability = (typeof AVAILABILITIES)[number];

/**
 * Status shown to the user. `reserved` and `packed` are derived from trips;
 * `archived` from `archivedAt`; `borrowed` / `damaged` from availability.
 */
export type InventoryStatus = 'available' | 'reserved' | 'packed' | 'borrowed' | 'damaged' | 'archived';

export const STATUS_META: Record<InventoryStatus, { label: string; color: string; icon: IconName }> = {
  available: { label: 'Available', color: colors.accent, icon: 'check-circle-outline' },
  reserved: { label: 'Reserved', color: colors.info, icon: 'calendar-lock' },
  packed: { label: 'Packed', color: colors.teal, icon: 'bag-checked' },
  borrowed: { label: 'Borrowed', color: colors.warning, icon: 'account-arrow-right-outline' },
  damaged: { label: 'Damaged', color: colors.danger, icon: 'wrench-outline' },
  archived: { label: 'Archived', color: colors.neutral, icon: 'archive-outline' },
};

export type ImageSource = 'photo' | 'library' | 'suggested';

/** An item image. `library:` URIs refer to built-in illustrations, never product photos. */
export interface ItemImage {
  uri: string;
  source: ImageSource;
}

export interface InventoryItem {
  id: string;
  name: string;
  description: string;
  brand: string;
  model: string;
  quantity: number;
  /** Per unit, in grams; null when unknown. */
  weightGrams: number | null;
  condition: ItemCondition;
  storageLocation: string;
  categoryId: string | null;
  subcategoryId: string | null;
  availability: Availability;
  image: ItemImage | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** How an item is currently used by trips (derived, never stored on the item). */
export interface ItemUsage {
  /** Quantity held by active reservations for current or future trips. */
  reservedQuantity: number;
  /** Quantity on packed entries of trips with active reservations. */
  packedQuantity: number;
  /** Trips (any lifecycle) with a packing entry for this item. */
  tripCount: number;
}

export interface InventoryItemSummary extends InventoryItem {
  usage: ItemUsage;
}

export interface ItemInput {
  name: string;
  description: string;
  brand: string;
  model: string;
  quantity: number;
  weightGrams: number | null;
  condition: ItemCondition;
  storageLocation: string;
  categoryId: string | null;
  subcategoryId: string | null;
  availability: Availability;
  image: ItemImage | null;
}

export const INVENTORY_LIMITS = {
  nameMax: 80,
  descriptionMax: 500,
  brandMax: 60,
  locationMax: 80,
  quantityMax: 999,
  weightMaxGrams: 100_000,
  categoryNameMax: 40,
  categoryDescriptionMax: 200,
} as const;

/** Starter categories (with a system key) can be renamed and reordered but not deleted. */
export function isProtectedCategory(category: Pick<InventoryCategory, 'systemKey'>): boolean {
  return category.systemKey !== null;
}

export function emptyItemInput(categoryId: string | null = null): ItemInput {
  return {
    name: '',
    description: '',
    brand: '',
    model: '',
    quantity: 1,
    weightGrams: null,
    condition: 'good',
    storageLocation: '',
    categoryId,
    subcategoryId: null,
    availability: 'available',
    image: null,
  };
}

export function itemToInput(item: InventoryItem): ItemInput {
  return {
    name: item.name,
    description: item.description,
    brand: item.brand,
    model: item.model,
    quantity: item.quantity,
    weightGrams: item.weightGrams,
    condition: item.condition,
    storageLocation: item.storageLocation,
    categoryId: item.categoryId,
    subcategoryId: item.subcategoryId,
    availability: item.availability,
    image: item.image,
  };
}

export const isAvailability = (value: unknown): value is Availability =>
  typeof value === 'string' && (AVAILABILITIES as readonly string[]).includes(value);
export const isCondition = (value: unknown): value is ItemCondition =>
  typeof value === 'string' && (ITEM_CONDITIONS as readonly string[]).includes(value);
export const isCategoryKey = (value: unknown): value is CategoryKey =>
  typeof value === 'string' && (CATEGORY_KEYS as readonly string[]).includes(value);

export function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

/**
 * True when `keyword` starts a word in `text` (case-insensitive), so "top"
 * matches "tops" and "tank top" but not "laptop".
 */
export function containsWord(text: string, keyword: string): boolean {
  const escaped = normalizeName(keyword).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escaped}`).test(normalizeName(text));
}

export function validateItemInput(input: ItemInput): Partial<Record<keyof ItemInput, string>> {
  const errors: Partial<Record<keyof ItemInput, string>> = {};
  const name = input.name.trim();
  if (name.length === 0) errors.name = 'Give the item a name.';
  else if (name.length > INVENTORY_LIMITS.nameMax) errors.name = `Keep it under ${INVENTORY_LIMITS.nameMax} characters.`;
  if (input.description.trim().length > INVENTORY_LIMITS.descriptionMax)
    errors.description = `Keep it under ${INVENTORY_LIMITS.descriptionMax} characters.`;
  if (input.brand.trim().length > INVENTORY_LIMITS.brandMax || input.model.trim().length > INVENTORY_LIMITS.brandMax)
    errors.brand = `Keep brand and model under ${INVENTORY_LIMITS.brandMax} characters.`;
  if (input.storageLocation.trim().length > INVENTORY_LIMITS.locationMax)
    errors.storageLocation = `Keep it under ${INVENTORY_LIMITS.locationMax} characters.`;
  if (!Number.isInteger(input.quantity) || input.quantity < 0 || input.quantity > INVENTORY_LIMITS.quantityMax)
    errors.quantity = `Use a whole number from 0 to ${INVENTORY_LIMITS.quantityMax}.`;
  if (
    input.weightGrams !== null &&
    (!Number.isFinite(input.weightGrams) || input.weightGrams < 0 || input.weightGrams > INVENTORY_LIMITS.weightMaxGrams)
  )
    errors.weightGrams = 'Enter a weight between 0 and 100 kg.';
  if (!isCondition(input.condition)) errors.condition = 'Choose a condition.';
  if (!isAvailability(input.availability)) errors.availability = 'Choose a status.';
  return errors;
}

export function validateCategoryInput(input: CategoryInput): Partial<Record<keyof CategoryInput, string>> {
  const errors: Partial<Record<keyof CategoryInput, string>> = {};
  const name = input.name.trim();
  if (name.length === 0) errors.name = 'Give the category a name.';
  else if (name.length > INVENTORY_LIMITS.categoryNameMax)
    errors.name = `Keep it under ${INVENTORY_LIMITS.categoryNameMax} characters.`;
  if (!/^#[0-9A-Fa-f]{6}$/.test(input.color)) errors.color = 'Choose a colour.';
  if ((input.description ?? '').trim().length > INVENTORY_LIMITS.categoryDescriptionMax)
    errors.description = `Keep it under ${INVENTORY_LIMITS.categoryDescriptionMax} characters.`;
  return errors;
}

/* ------------------------------------------------------------------ */
/* Status, search, filter, sort                                        */
/* ------------------------------------------------------------------ */

export function effectiveStatus(item: InventoryItem, usage: ItemUsage): InventoryStatus {
  if (item.archivedAt) return 'archived';
  if (item.availability === 'damaged') return 'damaged';
  if (item.availability === 'borrowed') return 'borrowed';
  if (usage.packedQuantity > 0) return 'packed';
  if (usage.reservedQuantity > 0) return 'reserved';
  return 'available';
}

export type StatusFilter = 'all' | 'active' | InventoryStatus;
export type SortKey = 'name' | 'recent' | 'quantity' | 'category';

export const SORT_LABELS: Record<SortKey, string> = {
  name: 'Name',
  recent: 'Recently updated',
  quantity: 'Quantity',
  category: 'Category',
};

export interface ItemFilters {
  query: string;
  status: StatusFilter;
  /** Category or subcategory id; null for all; 'uncategorised' for items without one. */
  categoryId: string | null;
}

export const DEFAULT_FILTERS: ItemFilters = { query: '', status: 'active', categoryId: null };

export function matchesFilters(
  item: InventoryItemSummary,
  filters: ItemFilters,
  categoryNames: ReadonlyMap<string, string> = new Map(),
): boolean {
  const status = effectiveStatus(item, item.usage);
  if (filters.status === 'active' && status === 'archived') return false;
  if (filters.status !== 'all' && filters.status !== 'active' && status !== filters.status) return false;
  if (filters.categoryId === 'uncategorised') {
    if (item.categoryId) return false;
  } else if (filters.categoryId && item.categoryId !== filters.categoryId && item.subcategoryId !== filters.categoryId) {
    return false;
  }
  const query = normalizeName(filters.query);
  if (!query) return true;
  const haystack = [
    item.name,
    item.description,
    item.brand,
    item.model,
    item.storageLocation,
    item.categoryId ? categoryNames.get(item.categoryId) : '',
    item.subcategoryId ? categoryNames.get(item.subcategoryId) : '',
  ]
    .join(' ')
    .toLocaleLowerCase();
  return query.split(' ').every((token) => haystack.includes(token));
}

export function sortItems(
  items: readonly InventoryItemSummary[],
  key: SortKey,
  categoryNames: ReadonlyMap<string, string> = new Map(),
): InventoryItemSummary[] {
  const byName = (a: InventoryItem, b: InventoryItem) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  return [...items].sort((a, b) => {
    switch (key) {
      case 'recent':
        return b.updatedAt.localeCompare(a.updatedAt) || byName(a, b);
      case 'quantity':
        return b.quantity - a.quantity || byName(a, b);
      case 'category': {
        const ca = (a.categoryId && categoryNames.get(a.categoryId)) || '￿';
        const cb = (b.categoryId && categoryNames.get(b.categoryId)) || '￿';
        return ca.localeCompare(cb) || byName(a, b);
      }
      case 'name':
      default:
        return byName(a, b);
    }
  });
}

/* ------------------------------------------------------------------ */
/* Weight                                                              */
/* ------------------------------------------------------------------ */

export function formatWeight(grams: number): string {
  if (grams < 1000) return `${Math.round(grams)} g`;
  const kg = grams / 1000;
  return `${kg >= 10 ? kg.toFixed(0) : kg.toFixed(1)} kg`;
}

/** Parses "1.2 kg", "350 g", "350" (grams) — returns grams or null; NaN for invalid input. */
export function parseWeight(text: string): number | null {
  const value = text.trim().toLocaleLowerCase().replace(',', '.');
  if (value === '') return null;
  const match = /^(\d+(?:\.\d+)?)\s*(kg|g)?$/.exec(value);
  if (!match) return Number.NaN;
  const amount = Number(match[1]);
  return Math.round(match[2] === 'kg' ? amount * 1000 : amount);
}

/* ------------------------------------------------------------------ */
/* Image library (illustrations, not product photos)                   */
/* ------------------------------------------------------------------ */

export interface Illustration {
  key: string;
  label: string;
  icon: IconName;
  keywords: readonly string[];
}

/**
 * Built-in illustrations a user can pick for an item. They are generic icons,
 * so they never pretend to be a photo of the user's actual product.
 */
export const ILLUSTRATIONS: readonly Illustration[] = [
  { key: 'tshirt', label: 'T-shirt', icon: 'tshirt-crew-outline', keywords: ['t-shirt', 'tshirt', 'tee', 'top', 'shirt', 'kurta'] },
  { key: 'jacket', label: 'Jacket', icon: 'coat-rack', keywords: ['jacket', 'coat', 'fleece', 'hoodie', 'sweater', 'windcheater'] },
  { key: 'trousers', label: 'Trousers', icon: 'human-male', keywords: ['trouser', 'pants', 'jeans', 'shorts', 'leggings'] },
  { key: 'socks', label: 'Socks', icon: 'shoe-formal', keywords: ['sock'] },
  { key: 'hat', label: 'Cap or hat', icon: 'hat-fedora', keywords: ['cap', 'hat', 'beanie'] },
  { key: 'sneaker', label: 'Shoes', icon: 'shoe-sneaker', keywords: ['shoe', 'sneaker', 'boot', 'trainer'] },
  { key: 'sandal', label: 'Sandals', icon: 'shoe-print', keywords: ['sandal', 'slipper', 'flip-flop', 'flip flop', 'chappal'] },
  { key: 'toothbrush', label: 'Toothbrush', icon: 'toothbrush', keywords: ['toothbrush', 'toothpaste', 'dental'] },
  { key: 'toiletry', label: 'Toiletry bottle', icon: 'bottle-tonic-outline', keywords: ['shampoo', 'soap', 'lotion', 'sunscreen', 'toiletr', 'deodorant', 'moisturi'] },
  { key: 'razor', label: 'Razor', icon: 'razor-double-edge', keywords: ['razor', 'trimmer', 'shaver'] },
  { key: 'charger', label: 'Charger', icon: 'power-plug-outline', keywords: ['charger', 'adapter', 'plug'] },
  { key: 'cable', label: 'Cable', icon: 'cable-data', keywords: ['cable', 'usb', 'cord'] },
  { key: 'powerbank', label: 'Power bank', icon: 'battery-charging-high', keywords: ['power bank', 'powerbank', 'battery'] },
  { key: 'phone', label: 'Phone', icon: 'cellphone', keywords: ['phone', 'mobile'] },
  { key: 'laptop', label: 'Laptop', icon: 'laptop', keywords: ['laptop', 'notebook', 'macbook'] },
  { key: 'headphones', label: 'Headphones', icon: 'headphones', keywords: ['headphone', 'earphone', 'earbud', 'airpod'] },
  { key: 'camera', label: 'Camera', icon: 'camera-outline', keywords: ['camera', 'gopro', 'dslr', 'lens'] },
  { key: 'tripod', label: 'Tripod', icon: 'camera-enhance-outline', keywords: ['tripod', 'gimbal'] },
  { key: 'passport', label: 'Passport or ID', icon: 'passport', keywords: ['passport', 'aadhaar', 'id card', 'licence', 'license', 'pan card'] },
  { key: 'ticket', label: 'Ticket', icon: 'ticket-outline', keywords: ['ticket', 'boarding'] },
  { key: 'medkit', label: 'First-aid kit', icon: 'medical-bag', keywords: ['first aid', 'first-aid', 'medkit', 'bandage'] },
  { key: 'pill', label: 'Medicine', icon: 'pill', keywords: ['medicine', 'tablet', 'pill', 'ors', 'paracetamol'] },
  { key: 'bottle', label: 'Water bottle', icon: 'bottle-soda-classic-outline', keywords: ['bottle', 'flask', 'sipper'] },
  { key: 'backpack', label: 'Backpack', icon: 'bag-personal-outline', keywords: ['backpack', 'daypack', 'rucksack'] },
  { key: 'suitcase', label: 'Suitcase', icon: 'bag-suitcase-outline', keywords: ['suitcase', 'trolley', 'luggage'] },
  { key: 'pillow', label: 'Travel pillow', icon: 'bed-outline', keywords: ['pillow', 'neck pillow'] },
  { key: 'sunglasses', label: 'Sunglasses', icon: 'sunglasses', keywords: ['sunglass', 'shades', 'glasses'] },
  { key: 'umbrella', label: 'Umbrella', icon: 'umbrella-outline', keywords: ['umbrella', 'raincoat', 'poncho', 'rain'] },
  { key: 'tent', label: 'Tent', icon: 'tent', keywords: ['tent', 'tarp'] },
  { key: 'sleepingbag', label: 'Sleeping bag', icon: 'sleep', keywords: ['sleeping bag', 'sleeping mat'] },
  { key: 'torch', label: 'Torch', icon: 'flashlight', keywords: ['torch', 'headlamp', 'flashlight', 'lantern'] },
  { key: 'food', label: 'Snacks', icon: 'food-apple-outline', keywords: ['snack', 'food', 'biscuit', 'nuts', 'fruit'] },
  { key: 'towel', label: 'Towel', icon: 'paper-roll-outline', keywords: ['towel'] },
  { key: 'lock', label: 'Lock', icon: 'lock-outline', keywords: ['lock', 'padlock'] },
  { key: 'book', label: 'Book', icon: 'book-open-variant', keywords: ['book', 'kindle', 'journal', 'notebook'] },
  { key: 'helmet', label: 'Helmet', icon: 'racing-helmet', keywords: ['helmet'] },
  { key: 'swim', label: 'Swimwear', icon: 'swim', keywords: ['swim', 'goggles', 'bikini', 'trunks'] },
];

const LIBRARY_PREFIX = 'library:';

export const illustrationUri = (key: string) => `${LIBRARY_PREFIX}${key}`;

export function illustrationFor(uri: string | null | undefined): Illustration | null {
  if (!uri || !uri.startsWith(LIBRARY_PREFIX)) return null;
  const key = uri.slice(LIBRARY_PREFIX.length);
  return ILLUSTRATIONS.find((illustration) => illustration.key === key) ?? null;
}

/**
 * Suggests an illustration whose keywords appear in the item name. The caller
 * must ask the user before using it; nothing is assigned automatically.
 */
export function suggestIllustration(name: string): Illustration | null {
  const text = normalizeName(name);
  if (!text) return null;
  return ILLUSTRATIONS.find((illustration) => illustration.keywords.some((keyword) => containsWord(text, keyword))) ?? null;
}
