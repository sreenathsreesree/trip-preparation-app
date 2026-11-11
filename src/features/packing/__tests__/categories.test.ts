import { CATEGORY_KEYS, normalizeName, type InventoryCategory } from '../../inventory/model';
import { PACKING_CATALOGUE } from '../catalogue';
import {
  UNCATEGORISED,
  categoryProgress,
  entriesInCategory,
  groupByCategory,
  isCovered,
  topLevelKey,
} from '../categories';
import { ENTRY_UNITS, formatQuantity, isEntryUnit, type PackingEntry } from '../model';

const category = (id: string, name: string, parentId: string | null = null, position = 0): InventoryCategory => ({
  id,
  parentId,
  name,
  icon: 'shape-outline',
  color: '#9DCBE5',
  position,
  coverImageUri: null,
  systemKey: null,
  description: '',
  createdAt: '',
  updatedAt: '',
});

let seq = 0;
const entry = (name: string, categoryId: string | null, isPacked = false, extra: Partial<PackingEntry> = {}): PackingEntry => ({
  id: `e${(seq += 1)}`,
  tripId: 't',
  inventoryItemId: null,
  name,
  categoryId,
  quantity: 1,
  unit: 'pcs',
  travellerId: null,
  luggageId: null,
  isPacked,
  notes: '',
  source: 'manual',
  recommendationId: null,
  position: seq,
  createdAt: '',
  updatedAt: '',
  ...extra,
});

const clothing = category('c-clothing', 'Clothing', null, 0);
const tops = category('c-tops', 'Tops', 'c-clothing');
const electronics = category('c-electronics', 'Electronics', null, 1);
const camera = category('c-camera', 'Camera gear', null, 2);
const all = [clothing, tops, electronics, camera];
const byId = new Map(all.map((c) => [c.id, c]));
const topLevel = [clothing, electronics, camera];

describe('category progress', () => {
  it('counts items, packed, remaining and a rounded percent', () => {
    const rows = [true, true, true, true, false, false].map((packed, i) => entry(`x${i}`, null, packed));
    expect(categoryProgress(rows)).toEqual({ total: 6, packed: 4, remaining: 2, percent: 67 });
    expect(categoryProgress([])).toEqual({ total: 0, packed: 0, remaining: 0, percent: 0 });
  });
});

describe('grouping by category', () => {
  it('rolls subcategories up, keeps the user order, puts empty categories and uncategorised in place', () => {
    const rows = [
      entry('Linen shirt', 'c-tops', true),
      entry('Jeans', 'c-clothing'),
      entry('Lens cloth', 'c-camera'),
      entry('Sandwiches', null),
      entry('From a deleted category', 'gone'),
    ];
    const grouped = groupByCategory(rows, topLevel, byId);
    expect(grouped.filled.map((g) => [g.key, g.entries.map((e) => e.name), g.progress.packed])).toEqual([
      ['c-clothing', ['Linen shirt', 'Jeans'], 1],
      ['c-camera', ['Lens cloth'], 0],
      [UNCATEGORISED, ['Sandwiches', 'From a deleted category'], 0],
    ]);
    expect(grouped.empty.map((g) => g.key)).toEqual(['c-electronics']);
  });

  it('finds the entries of one category screen, including subcategories', () => {
    const rows = [entry('Linen shirt', 'c-tops'), entry('Jeans', 'c-clothing'), entry('Charger', 'c-electronics')];
    expect(entriesInCategory(rows, 'c-clothing', byId).map((e) => e.name)).toEqual(['Linen shirt', 'Jeans']);
    expect(entriesInCategory(rows, UNCATEGORISED, byId)).toEqual([]);
    expect(topLevelKey(null, byId)).toBe(UNCATEGORISED);
  });

  it('recalculates when items are added or removed', () => {
    const rows = [entry('A', 'c-clothing', true)];
    expect(groupByCategory(rows, topLevel, byId).filled[0]?.progress.percent).toBe(100);
    rows.push(entry('B', 'c-clothing'));
    expect(groupByCategory(rows, topLevel, byId).filled[0]?.progress.percent).toBe(50);
    expect(groupByCategory([], topLevel, byId).filled).toEqual([]);
  });
});

describe('coverage (already on the list)', () => {
  const rows = [
    entry('T-shirts or tops', 'c-clothing'),
    entry('Phone charger', 'c-electronics'),
    entry('Camera', 'c-camera', false, { inventoryItemId: 'inv-cam' }),
  ];
  it('matches by inventory item, by name and by keyword at word starts', () => {
    expect(isCovered({ name: 'T-shirts', keywords: ['t-shirt'] }, rows)).toBe(true);
    expect(isCovered({ name: 'phone CHARGER' }, rows)).toBe(true);
    expect(isCovered({ name: 'My camera', inventoryItemId: 'inv-cam' }, rows)).toBe(true);
    expect(isCovered({ name: 'Camera charger', keywords: ['camera charger'] }, rows)).toBe(false);
    expect(isCovered({ name: 'Laptop', keywords: ['laptop'] }, rows)).toBe(false);
  });
});

describe('default catalogue', () => {
  it('covers every starter category with unique names and valid units', () => {
    expect(Object.keys(PACKING_CATALOGUE).sort()).toEqual([...CATEGORY_KEYS].sort());
    for (const key of CATEGORY_KEYS) {
      const names = PACKING_CATALOGUE[key].map((i) => normalizeName(i.name));
      expect(new Set(names).size).toBe(names.length);
      for (const item of PACKING_CATALOGUE[key]) {
        expect(isEntryUnit(item.unit)).toBe(true);
        expect(item.keywords.length).toBeGreaterThan(0);
      }
    }
    expect(PACKING_CATALOGUE.clothing.map((i) => i.name)).toEqual(
      expect.arrayContaining(['T-shirts', 'Jeans', 'Socks', 'Sleepwear']),
    );
    expect(PACKING_CATALOGUE.accessories.map((i) => i.name)).toEqual(expect.arrayContaining(['Wallet', 'Watch']));
  });

  it('formats quantities with units', () => {
    expect(ENTRY_UNITS).toEqual(['pcs', 'pairs', 'sets', 'bottles', 'packs']);
    expect(formatQuantity(4, 'pairs')).toBe('×4 pairs');
    expect(formatQuantity(1, 'pcs')).toBe('×1 pc');
    expect(isEntryUnit('dozen')).toBe(false);
  });
});
