import { itemInput, setupRepositories, tripInput } from '../../../../test/fixtures';
import {
  DEFAULT_FILTERS,
  effectiveStatus,
  formatWeight,
  illustrationFor,
  matchesFilters,
  parseWeight,
  sortItems,
  suggestIllustration,
  type InventoryItemSummary,
} from '../model';

async function setup() {
  const repos = await setupRepositories();
  const categories = await repos.inventory.listCategories();
  const clothing = categories.find((c) => c.systemKey === 'clothing');
  const tops = categories.find((c) => c.name === 'Tops');
  const electronics = categories.find((c) => c.systemKey === 'electronics');
  if (!clothing || !tops || !electronics) throw new Error('starter categories missing');
  return { ...repos, clothing, tops, electronics };
}

describe('inventory items', () => {
  it('creates, reads, edits and deletes items with all their details', async () => {
    const { db, inventory, clothing, tops } = await setup();
    const created = await inventory.createItem(
      itemInput({
        name: '  Merino   T-shirt ',
        description: 'Odour resistant',
        brand: 'Decathlon',
        model: 'MT500',
        quantity: 3,
        weightGrams: 150,
        condition: 'new',
        storageLocation: 'Wardrobe, top shelf',
        categoryId: clothing.id,
        subcategoryId: tops.id,
        image: { uri: 'library:tshirt', source: 'library' },
      }),
    );
    expect(created).toMatchObject({
      name: 'Merino T-shirt',
      quantity: 3,
      weightGrams: 150,
      condition: 'new',
      categoryId: clothing.id,
      subcategoryId: tops.id,
      availability: 'available',
      image: { uri: 'library:tshirt', source: 'library' },
      usage: { reservedQuantity: 0, packedQuantity: 0, tripCount: 0 },
    });

    const { item: edited } = await inventory.updateItem(created.id, {
      ...itemInput({ name: 'Merino tee', quantity: 4, categoryId: clothing.id, subcategoryId: null }),
    });
    expect(edited).toMatchObject({ name: 'Merino tee', quantity: 4, subcategoryId: null, image: null });

    await inventory.deleteItem(created.id);
    expect(await inventory.getItem(created.id)).toBeNull();
    db.close();
  });

  it('validates input', async () => {
    const { db, inventory, tops, electronics } = await setup();
    await expect(inventory.createItem(itemInput({ name: ' ' }))).rejects.toThrow(/name/);
    await expect(inventory.createItem(itemInput({ quantity: -1 }))).rejects.toThrow(/whole number/);
    await expect(inventory.createItem(itemInput({ weightGrams: 200_000 }))).rejects.toThrow(/weight/);
    await expect(
      inventory.createItem(itemInput({ categoryId: electronics.id, subcategoryId: tops.id })),
    ).rejects.toThrow(/subcategory/);
    db.close();
  });

  it('duplicates, archives, restores, adjusts quantity and changes availability', async () => {
    const { db, inventory } = await setup();
    const item = await inventory.createItem(itemInput({ name: 'Power bank', quantity: 1 }));
    const copy = await inventory.duplicateItem(item.id);
    expect(copy).toMatchObject({ name: 'Power bank (copy)', quantity: 1 });
    expect(copy.id).not.toBe(item.id);

    const archived = await inventory.setArchived(item.id, true);
    expect(effectiveStatus(archived, archived.usage)).toBe('archived');
    const restored = await inventory.setArchived(item.id, false);
    expect(effectiveStatus(restored, restored.usage)).toBe('available');

    expect((await inventory.adjustQuantity(item.id, 2)).quantity).toBe(3);
    expect((await inventory.adjustQuantity(item.id, -3)).quantity).toBe(0);
    await expect(inventory.adjustQuantity(item.id, -1)).rejects.toThrow(/between 0/);

    const damaged = await inventory.setAvailability(item.id, 'damaged');
    expect(effectiveStatus(damaged, damaged.usage)).toBe('damaged');
    const lent = await inventory.setAvailability(item.id, 'borrowed');
    expect(effectiveStatus(lent, lent.usage)).toBe('borrowed');
    db.close();
  });

  it('reports which removed images are safe to delete from disk', async () => {
    const { db, inventory } = await setup();
    const photo = { uri: 'file:///app/inventory-images/a.jpg', source: 'photo' as const };
    const item = await inventory.createItem(itemInput({ name: 'Camera', image: photo }));
    const copy = await inventory.duplicateItem(item.id);
    // The copy still uses the photo, so replacing it on the original must not orphan it.
    const first = await inventory.updateItem(item.id, itemInput({ name: 'Camera', image: null }));
    expect(first.orphanedImageUri).toBeNull();
    expect((await inventory.deleteItem(copy.id)).orphanedImageUri).toBe(photo.uri);
    db.close();
  });
});

describe('categories', () => {
  it('creates custom categories and subcategories, edits and reorders them', async () => {
    const { db, inventory } = await setup();
    const gear = await inventory.createCategory({
      name: 'Climbing gear',
      icon: 'hiking',
      color: '#6FD6C2',
      parentId: null,
      coverImageUri: null,
    });
    const ropes = await inventory.createCategory({
      name: 'Ropes',
      icon: 'hiking',
      color: '#6FD6C2',
      parentId: gear.id,
      coverImageUri: null,
    });
    expect(ropes.parentId).toBe(gear.id);
    await expect(
      inventory.createCategory({ name: 'Too deep', icon: 'hiking', color: '#6FD6C2', parentId: ropes.id, coverImageUri: null }),
    ).rejects.toThrow(/one level/);

    const renamed = await inventory.updateCategory(gear.id, {
      name: 'Climbing',
      icon: 'tent',
      color: '#F28B7D',
      parentId: null,
      coverImageUri: 'library:tent',
    });
    expect(renamed).toMatchObject({ name: 'Climbing', icon: 'tent', color: '#F28B7D', coverImageUri: 'library:tent' });

    expect(await inventory.moveCategory(gear.id, -1)).toBe(true);
    const top = (await inventory.listCategories()).filter((c) => !c.parentId).map((c) => c.name);
    expect(top.indexOf('Climbing')).toBe(top.length - 2);
    await expect(
      inventory.createCategory({ name: '', icon: 'tent', color: '#FFFFFF', parentId: null, coverImageUri: null }),
    ).rejects.toThrow(/name/);
    db.close();
  });

  it('deleting or changing a category never deletes or alters items, nor trip packing entries', async () => {
    const { db, inventory, packing, trips, clothing, tops } = await setup();
    const shirt = await inventory.createItem(
      itemInput({ name: 'Linen shirt', quantity: 2, categoryId: clothing.id, subcategoryId: tops.id }),
    );
    const trip = await trips.create(tripInput(), { sections: [] });
    const entry = await packing.addEntry(trip.id, { inventoryItemId: shirt.id, name: '', quantity: 1 });
    expect(entry.categoryId).toBe(clothing.id);

    // Moving the item to another category leaves the trip's entry with its own category.
    const misc = (await inventory.listCategories()).find((c) => c.systemKey === 'misc');
    await inventory.updateItem(shirt.id, itemInput({ name: 'Linen shirt', quantity: 2, categoryId: misc?.id ?? null }));
    expect((await packing.load(trip.id)).entries[0]?.categoryId).toBe(clothing.id);

    await inventory.deleteCategory(tops.id);
    const afterSub = await inventory.getItem(shirt.id);
    expect(afterSub).toMatchObject({ name: 'Linen shirt', quantity: 2 });

    // Starter categories are protected; custom categories can be deleted.
    await expect(inventory.deleteCategory(clothing.id)).rejects.toThrow('starter category');
    const gear = await inventory.createCategory({
      name: 'Camera gear',
      icon: 'camera-outline',
      color: '#6FD6C2',
      parentId: null,
      coverImageUri: null,
      description: 'Bodies, lenses and batteries',
    });
    const lenses = await inventory.createCategory({
      name: 'Lenses',
      icon: 'camera-outline',
      color: '#6FD6C2',
      parentId: gear.id,
      coverImageUri: null,
    });
    await packing.updateEntry(entry.id, { categoryId: gear.id });
    await inventory.updateItem(shirt.id, itemInput({ name: 'Linen shirt', quantity: 2, categoryId: gear.id, subcategoryId: lenses.id }));
    await inventory.deleteCategory(gear.id);
    expect((await inventory.listCategories()).some((c) => c.id === lenses.id)).toBe(false);
    expect((await inventory.getItem(shirt.id))?.quantity).toBe(2);
    const [kept] = (await packing.load(trip.id)).entries;
    expect(kept).toMatchObject({ name: 'Linen shirt', quantity: 1, categoryId: null, inventoryItemId: shirt.id });
    db.close();
  });
});

describe('search, filters and sorting', () => {
  const base = (overrides: Partial<InventoryItemSummary>): InventoryItemSummary => ({
    id: 'x',
    name: 'Item',
    description: '',
    brand: '',
    model: '',
    quantity: 1,
    weightGrams: null,
    condition: 'good',
    storageLocation: '',
    categoryId: null,
    subcategoryId: null,
    availability: 'available',
    image: null,
    archivedAt: null,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    usage: { reservedQuantity: 0, packedQuantity: 0, tripCount: 0 },
    ...overrides,
  });
  const items = [
    base({ id: 'a', name: 'Rain jacket', brand: 'Quechua', categoryId: 'c1', updatedAt: '2026-03-01', quantity: 1 }),
    base({ id: 'b', name: 'Phone charger', categoryId: 'c2', storageLocation: 'Desk drawer', quantity: 3 }),
    base({ id: 'c', name: 'Old tent', archivedAt: '2026-02-01' }),
    base({ id: 'd', name: 'Headlamp', availability: 'damaged' }),
    base({ id: 'e', name: 'Camera', usage: { reservedQuantity: 1, packedQuantity: 1, tripCount: 1 } }),
  ];
  const names = new Map([
    ['c1', 'Clothing'],
    ['c2', 'Electronics'],
  ]);
  const ids = (list: InventoryItemSummary[]) => list.map((i) => i.id);

  it('searches name, brand, location and category names', () => {
    const find = (query: string) => ids(items.filter((i) => matchesFilters(i, { ...DEFAULT_FILTERS, query }, names)));
    expect(find('quechua')).toEqual(['a']);
    expect(find('drawer')).toEqual(['b']);
    expect(find('electronics')).toEqual(['b']);
    expect(find('rain jack')).toEqual(['a']);
  });

  it('hides archived items by default and filters by derived status and category', () => {
    const filter = (f: Partial<typeof DEFAULT_FILTERS>) =>
      ids(items.filter((i) => matchesFilters(i, { ...DEFAULT_FILTERS, ...f }, names)));
    expect(filter({})).toEqual(['a', 'b', 'd', 'e']);
    expect(filter({ status: 'all' })).toHaveLength(5);
    expect(filter({ status: 'archived' })).toEqual(['c']);
    expect(filter({ status: 'damaged' })).toEqual(['d']);
    expect(filter({ status: 'packed' })).toEqual(['e']);
    expect(filter({ categoryId: 'c1' })).toEqual(['a']);
    expect(filter({ categoryId: 'uncategorised' })).toEqual(['d', 'e']);
  });

  it('sorts by name, recency, quantity and category', () => {
    expect(ids(sortItems(items, 'name'))).toEqual(['e', 'd', 'c', 'b', 'a']);
    expect(ids(sortItems(items, 'recent'))[0]).toBe('a');
    expect(ids(sortItems(items, 'quantity'))[0]).toBe('b');
    expect(ids(sortItems(items, 'category', names)).slice(0, 2)).toEqual(['a', 'b']);
  });
});

describe('weights and illustrations', () => {
  it('parses and formats weights', () => {
    expect(parseWeight('350')).toBe(350);
    expect(parseWeight('1.2 kg')).toBe(1200);
    expect(parseWeight('0,5kg')).toBe(500);
    expect(parseWeight('')).toBeNull();
    expect(parseWeight('heavy')).toBeNaN();
    expect(formatWeight(350)).toBe('350 g');
    expect(formatWeight(1250)).toBe('1.3 kg');
    expect(formatWeight(12_400)).toBe('12 kg');
  });

  it('suggests a generic illustration but never assigns it by itself', () => {
    expect(suggestIllustration('Anker power bank')?.key).toBe('powerbank');
    expect(suggestIllustration('Grandma’s recipe book')?.key).toBe('book');
    expect(suggestIllustration('Thing')).toBeNull();
    expect(illustrationFor('library:camera')?.icon).toBe('camera-outline');
    expect(illustrationFor('file:///photo.jpg')).toBeNull();
  });
});
