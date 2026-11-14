import type { IconName } from '@/theme/icons';

import type { Luggage, PackingEntry } from '../packing/model';

/** A trip's clothing category (T-shirts, Shirts, …). Personal; never shared. */
export interface ClothingCategory {
  id: string;
  tripId: string;
  name: string;
  icon: IconName;
  position: number;
}

export const CLOTHING_LIMITS = { nameMax: 40, categoriesMax: 40 } as const;

/** Starter categories, created the first time a trip's clothing is opened (all can be renamed or deleted). */
export const STARTER_CATEGORIES: readonly { name: string; icon: IconName }[] = [
  { name: 'T-shirts', icon: 'tshirt-crew-outline' },
  { name: 'Shirts', icon: 'tshirt-v-outline' },
  { name: 'Pants', icon: 'human-male' },
  { name: 'Dresses', icon: 'human-female' },
  { name: 'Jackets', icon: 'coat-rack' },
  { name: 'Footwear', icon: 'shoe-sneaker' },
  { name: 'Accessories', icon: 'sunglasses' },
  { name: 'Essentials', icon: 'hanger' },
];

export const CATEGORY_ICONS: readonly IconName[] = [
  'tshirt-crew-outline',
  'tshirt-v-outline',
  'human-male',
  'human-female',
  'coat-rack',
  'shoe-sneaker',
  'shoe-formal',
  'sunglasses',
  'hanger',
  'tie',
  'glasses',
  'hat-fedora',
];

export function validateCategoryName(name: string, existing: readonly Pick<ClothingCategory, 'id' | 'name'>[], selfId?: string): string | null {
  const value = name.trim();
  if (!value) return 'Give the category a name.';
  if (value.length > CLOTHING_LIMITS.nameMax) return `Keep it under ${CLOTHING_LIMITS.nameMax} characters.`;
  if (existing.some((c) => c.id !== selfId && c.name.trim().toLowerCase() === value.toLowerCase())) return 'There is already a category with that name.';
  return null;
}

export interface Progress {
  units: number;
  packed: number;
}

const tally = (entries: readonly Pick<PackingEntry, 'quantity' | 'isPacked'>[]): Progress => ({
  units: entries.reduce((n, e) => n + e.quantity, 0),
  packed: entries.reduce((n, e) => n + (e.isPacked ? e.quantity : 0), 0),
});

export interface ClothingSummary {
  total: Progress;
  byCategory: Record<string, Progress & { items: number }>;
  /** Per bag (including clothing and everything else in it), plus 'none' for unassigned clothing. */
  byBag: { id: string | null; name: string; progress: Progress; items: number }[];
  uncategorised: number;
}

/** Packing summary for the clothing organizer: overall, per category and per bag. */
export function summarise(
  entries: readonly PackingEntry[],
  links: Readonly<Record<string, string | null>>,
  categories: readonly ClothingCategory[],
  luggage: readonly Luggage[],
): ClothingSummary {
  const clothing = entries.filter((e) => e.id in links);
  const byCategory: ClothingSummary['byCategory'] = {};
  for (const c of categories) {
    const items = clothing.filter((e) => links[e.id] === c.id);
    byCategory[c.id] = { ...tally(items), items: items.length };
  }
  const byBag: ClothingSummary['byBag'] = luggage.map((bag) => {
    const items = entries.filter((e) => e.luggageId === bag.id);
    return { id: bag.id, name: bag.name, progress: tally(items), items: items.length };
  });
  const loose = clothing.filter((e) => !e.luggageId);
  if (loose.length) byBag.push({ id: null, name: 'Not in a bag', progress: tally(loose), items: loose.length });
  return {
    total: tally(clothing),
    byCategory,
    byBag,
    uncategorised: clothing.filter((e) => !links[e.id] || !categories.some((c) => c.id === links[e.id])).length,
  };
}
