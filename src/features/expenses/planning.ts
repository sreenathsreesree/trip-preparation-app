import type { IconName } from '@/theme/icons';

import { allocate, MAX_MINOR, minorDigits } from './money';

/**
 * Budgets, spending summaries and travel calculators (pure). Everything is per
 * currency; nothing is converted.
 */

export interface CategoryMeta {
  key: string;
  label: string;
  icon: IconName;
}

export const BUILT_IN_CATEGORIES: readonly CategoryMeta[] = [
  { key: 'food', label: 'Food & drinks', icon: 'silverware-fork-knife' },
  { key: 'stay', label: 'Stay', icon: 'bed-outline' },
  { key: 'transport', label: 'Transport', icon: 'bus' },
  { key: 'fuel', label: 'Fuel', icon: 'gas-station-outline' },
  { key: 'tickets', label: 'Tickets & entry', icon: 'ticket-outline' },
  { key: 'activities', label: 'Activities', icon: 'hiking' },
  { key: 'shopping', label: 'Shopping', icon: 'shopping-outline' },
  { key: 'tolls', label: 'Tolls & parking', icon: 'boom-gate-outline' },
  { key: 'other', label: 'Other', icon: 'dots-horizontal-circle-outline' },
];

export const CUSTOM_PREFIX = 'custom:';

export function categoryMeta(key: string, custom: readonly { id: string; name: string }[]): CategoryMeta {
  const builtIn = BUILT_IN_CATEGORIES.find((c) => c.key === key);
  if (builtIn) return builtIn;
  if (key.startsWith(CUSTOM_PREFIX)) {
    const found = custom.find((c) => `${CUSTOM_PREFIX}${c.id}` === key);
    if (found) return { key, label: found.name, icon: 'tag-outline' };
  }
  return { key, label: 'Other', icon: 'dots-horizontal-circle-outline' };
}

/* ------------------------------------------------------------------ */
/* Spending and budgets                                                */
/* ------------------------------------------------------------------ */

export interface SpendItem {
  amountMinor: number;
  currency: string;
  category: string;
  spentOn: string;
}

export interface BudgetPlan {
  currency: string;
  totalMinor: number | null;
  dailyLimitMinor: number | null;
  lines: { category: string; plannedMinor: number }[];
}

export type BudgetLevel = 'ok' | 'near' | 'over';
/** Warn from 80% of a limit. */
export const NEAR_LIMIT = 0.8;

export const budgetLevel = (actual: number, planned: number | null): BudgetLevel | null =>
  planned === null || planned <= 0 ? null : actual > planned ? 'over' : actual >= planned * NEAR_LIMIT ? 'near' : 'ok';

export interface BudgetSummary {
  currency: string;
  spentMinor: number;
  total: { plannedMinor: number | null; level: BudgetLevel | null; remainingMinor: number | null };
  categories: { category: string; plannedMinor: number | null; actualMinor: number; level: BudgetLevel | null }[];
  days: { date: string; actualMinor: number; level: BudgetLevel | null }[];
  today: { actualMinor: number; limitMinor: number | null; level: BudgetLevel | null; remainingMinor: number | null } | null;
}

/** Planned versus actual for one currency: total, per category and per day against the daily limit. */
export function budgetSummary(items: readonly SpendItem[], plan: BudgetPlan | null, currency: string, today: string | null): BudgetSummary {
  const mine = items.filter((i) => i.currency === currency);
  const spent = mine.reduce((a, i) => a + i.amountMinor, 0);
  const byCategory = new Map<string, number>();
  const byDay = new Map<string, number>();
  for (const i of mine) {
    byCategory.set(i.category, (byCategory.get(i.category) ?? 0) + i.amountMinor);
    byDay.set(i.spentOn, (byDay.get(i.spentOn) ?? 0) + i.amountMinor);
  }
  const planned = new Map((plan?.lines ?? []).map((l) => [l.category, l.plannedMinor]));
  const categories = [...new Set([...planned.keys(), ...byCategory.keys()])].map((category) => {
    const p = planned.get(category) ?? null;
    const actual = byCategory.get(category) ?? 0;
    return { category, plannedMinor: p, actualMinor: actual, level: budgetLevel(actual, p) };
  });
  categories.sort((a, b) => b.actualMinor - a.actualMinor || a.category.localeCompare(b.category));
  const limit = plan?.dailyLimitMinor ?? null;
  const days = [...byDay.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([date, actual]) => ({ date, actualMinor: actual, level: budgetLevel(actual, limit) }));
  const totalPlanned = plan?.totalMinor ?? null;
  const todayActual = today ? (byDay.get(today) ?? 0) : 0;
  return {
    currency,
    spentMinor: spent,
    total: { plannedMinor: totalPlanned, level: budgetLevel(spent, totalPlanned), remainingMinor: totalPlanned === null ? null : totalPlanned - spent },
    categories,
    days,
    today: today
      ? { actualMinor: todayActual, limitMinor: limit, level: budgetLevel(todayActual, limit), remainingMinor: limit === null ? null : limit - todayActual }
      : null,
  };
}

/* ------------------------------------------------------------------ */
/* Calculators                                                         */
/* ------------------------------------------------------------------ */

export type Efficiency = { unit: 'km_per_l'; value: number } | { unit: 'l_per_100km'; value: number };

/** Litres needed for a distance, rounded to 0.1 L. */
export function fuelLitres(distanceKm: number, efficiency: Efficiency): number {
  if (!(distanceKm > 0)) throw new RangeError('Enter a distance.');
  if (!(efficiency.value > 0)) throw new RangeError('Enter the fuel efficiency.');
  const litres = efficiency.unit === 'km_per_l' ? distanceKm / efficiency.value : (distanceKm * efficiency.value) / 100;
  return Math.round(litres * 10) / 10;
}

/** Fuel cost in minor units: litres × price per litre (minor), rounded to the nearest minor unit. */
export function fuelCostMinor(distanceKm: number, efficiency: Efficiency, pricePerLitreMinor: number): { litres: number; costMinor: number } {
  if (!(pricePerLitreMinor > 0)) throw new RangeError('Enter the fuel price.');
  const litres = efficiency.unit === 'km_per_l' ? distanceKm / efficiency.value : (distanceKm * efficiency.value) / 100;
  if (!(distanceKm > 0) || !(efficiency.value > 0)) throw new RangeError('Enter the distance and fuel efficiency.');
  const costMinor = Math.round(litres * pricePerLitreMinor);
  if (costMinor > MAX_MINOR) throw new RangeError('That is too large.');
  return { litres: Math.round(litres * 10) / 10, costMinor };
}

/** Splits a total between people exactly (the first few pay one minor unit more when it does not divide). */
export function perPerson(totalMinor: number, people: number): { eachMinor: number; extra: number; shares: number[] } {
  if (!Number.isInteger(people) || people < 1) throw new RangeError('Enter how many people.');
  const shares = allocate(totalMinor, Array.from({ length: people }, () => 1));
  return { eachMinor: Math.floor(totalMinor / people), extra: totalMinor % people, shares };
}

export interface TravelCostInput {
  fuelMinor: number;
  tollsMinor: number;
  parkingMinor: number;
  otherMinor: number;
  people: number;
  distanceKm: number | null;
}

/** Total road-trip cost, per person and per km. */
export function travelCost(input: TravelCostInput, currency: string) {
  const total = input.fuelMinor + input.tollsMinor + input.parkingMinor + input.otherMinor;
  const split = perPerson(total, input.people);
  const perKmMinor = input.distanceKm && input.distanceKm > 0 ? Math.round(total / input.distanceKm) : null;
  return { totalMinor: total, ...split, perKmMinor, digits: minorDigits(currency) };
}

/** Parses a positive decimal like "12.5" (for km, litres and efficiency). */
export function parseDecimal(text: string): number | null {
  const clean = text.trim().replace(/,/g, '');
  if (!/^\d+(\.\d+)?$/.test(clean)) return null;
  const n = Number(clean);
  return n > 0 && Number.isFinite(n) ? n : null;
}
