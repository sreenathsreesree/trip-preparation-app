import type { InventoryCategory, InventoryItemSummary } from '../../inventory/model';
import { blockedReason, canCreate, inventoryChoices, matchesQuery, quickInventory, suggestionChoices } from '../addOptions';

const category = (id: string, parentId: string | null = null) =>
  ({ id, parentId }) as Pick<InventoryCategory, 'id' | 'parentId'>;
const byId = new Map([
  ['clothing', category('clothing')],
  ['tops', category('tops', 'clothing')],
  ['electronics', category('electronics')],
]);

const item = (name: string, categoryId: string | null, extra: Partial<InventoryItemSummary> = {}) =>
  ({
    id: `id-${name}`,
    name,
    categoryId,
    subcategoryId: null,
    quantity: 1,
    availability: 'available',
    archivedAt: null,
    ...extra,
  }) as InventoryItemSummary;

const items = [
  item('Merino T-shirt', 'clothing', { quantity: 5 }),
  item('Linen shirt', 'tops'),
  item('Phone charger', 'electronics'),
  item('Old jacket', 'clothing', { archivedAt: '2026-01-01' }),
  item('Broken shorts', 'clothing', { availability: 'damaged' }),
];

describe('inventory choices', () => {
  it('lists the category’s own items first and others only while searching', () => {
    const idle = inventoryChoices(items, 'clothing', byId, '');
    expect(idle.here.map((i) => i.name)).toEqual(['Broken shorts', 'Linen shirt', 'Merino T-shirt']);
    expect(idle.elsewhere).toEqual([]);
    const searching = inventoryChoices(items, 'clothing', byId, 'ch');
    expect(searching.here).toEqual([]);
    expect(searching.elsewhere.map((i) => i.name)).toEqual(['Phone charger']);
  });

  it('lists everything owned when opened without a category, never archived items', () => {
    expect(inventoryChoices(items, null, byId, '').here.map((i) => i.name)).not.toContain('Old jacket');
  });

  it('offers one-tap items that are packable and not yet on the trip', () => {
    const quick = quickInventory(items, 'clothing', byId, [{ inventoryItemId: 'id-Linen shirt' }]);
    expect(quick.map((i) => i.name)).toEqual(['Merino T-shirt']);
    expect(blockedReason(items[4]!)).toBe('Marked damaged');
    expect(blockedReason(item('Gone', null, { quantity: 0 }))).toBe('None owned');
  });
});

describe('suggestion choices', () => {
  it('shows the category catalogue minus items already on the trip', () => {
    const entries = [
      { name: 'T-shirts or tops', inventoryItemId: null },
      { name: 'Pairs of socks', inventoryItemId: null },
    ];
    const names = suggestionChoices('clothing', entries, '').map((s) => s.name);
    expect(names).not.toContain('T-shirts');
    expect(names).not.toContain('Socks');
    expect(names).toEqual(expect.arrayContaining(['Jeans', 'Sleepwear']));
    expect(suggestionChoices('clothing', [], '').find((s) => s.name === 'Socks')).toMatchObject({
      unit: 'pairs',
      categoryKey: 'clothing',
    });
  });

  it('leaves out suggestions matched by an owned item shown alongside', () => {
    const owned = [{ id: 'id-Merino T-shirt', name: 'Merino T-shirt' }];
    const names = suggestionChoices('clothing', [], '', owned).map((s) => s.name);
    expect(names).not.toContain('T-shirts');
    expect(names).toContain('Shirts');
  });

  it('searches every category only when there is no starter category', () => {
    expect(suggestionChoices(null, [], '')).toEqual([]);
    const found = suggestionChoices(null, [], 'charger').map((s) => [s.name, s.categoryKey]);
    expect(found).toEqual(
      expect.arrayContaining([
        ['Phone charger', 'electronics'],
        ['Laptop charger', 'electronics'],
      ]),
    );
    // Duplicate names across categories (Camera) appear once.
    expect(suggestionChoices(null, [], 'camera').filter((s) => s.name === 'Camera')).toHaveLength(1);
  });
});

describe('creating trip-only items', () => {
  it('offers to create new names only', () => {
    expect(canCreate('Beach mat', ['Towels'])).toBe(true);
    expect(canCreate('  towels ', ['Towels'])).toBe(false);
    expect(canCreate('   ', [])).toBe(false);
    expect(matchesQuery('Phone charger', 'CHARG')).toBe(true);
  });
});
