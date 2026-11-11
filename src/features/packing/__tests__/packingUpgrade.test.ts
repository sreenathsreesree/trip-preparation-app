import { itemInput, setupRepositories, tripInput } from '../../../../test/fixtures';

async function setup() {
  const repos = await setupRepositories();
  const tripA = await repos.trips.create(tripInput({ name: 'Goa' }), { sections: [] });
  const tripB = await repos.trips.create(
    tripInput({ name: 'Munnar', startDate: '2027-01-10', endDate: '2027-01-12' }),
    { sections: [] },
  );
  return { ...repos, tripA, tripB };
}

describe('packing entries: units', () => {
  it('stores, updates and copies the unit, defaulting to pieces', async () => {
    const { db, packing, tripA } = await setup();
    const socks = await packing.addEntry(tripA.id, { name: 'Socks', quantity: 4, unit: 'pairs' });
    expect(socks).toMatchObject({ unit: 'pairs', quantity: 4, isPacked: false });
    const towel = await packing.addEntry(tripA.id, { name: 'Towel' });
    expect(towel.unit).toBe('pcs');
    expect((await packing.updateEntry(towel.id, { unit: 'sets' })).unit).toBe('sets');
    expect((await packing.updateEntry(towel.id, { quantity: 2 })).unit).toBe('sets');
    // Unknown units are stored as pieces.
    expect((await packing.updateEntry(towel.id, { unit: 'dozen' as never })).unit).toBe('pcs');
    db.close();
  });
});

describe('inventory reused across trips', () => {
  it('keeps packed state and quantity per trip, never changing the inventory item', async () => {
    const { db, packing, inventory, tripA, tripB } = await setup();
    const shirt = await inventory.createItem(itemInput({ name: 'Linen shirt', quantity: 5 }));
    const row = () => db.getFirstAsync('SELECT * FROM inventory_items WHERE id = ?', [shirt.id]);
    const before = await row();
    const a = await packing.addEntry(tripA.id, { inventoryItemId: shirt.id, name: '', quantity: 3 });
    const b = await packing.addEntry(tripB.id, { inventoryItemId: shirt.id, name: '', quantity: 2 });
    await packing.updateEntry(a.id, { isPacked: true, name: 'Shirts for Goa', notes: 'ironed' });

    expect((await packing.load(tripA.id)).entries[0]).toMatchObject({ isPacked: true, quantity: 3, name: 'Shirts for Goa' });
    expect((await packing.load(tripB.id)).entries[0]).toMatchObject({ isPacked: false, quantity: 2, name: 'Linen shirt' });
    expect(b.isPacked).toBe(false);
    expect(await row()).toEqual(before);
    expect((await inventory.getItem(shirt.id))?.usage.tripCount).toBe(2);

    // A trip-only item never creates inventory.
    const countBefore = (await inventory.listItems()).length;
    await packing.addEntry(tripA.id, { name: 'Sandwiches' });
    expect((await inventory.listItems()).length).toBe(countBefore);
    db.close();
  });
});

describe('category descriptions', () => {
  it('saves a description and keeps it when an update omits it', async () => {
    const { db, inventory } = await setup();
    const gear = await inventory.createCategory({
      name: 'Camera gear',
      icon: 'camera-outline',
      color: '#6FD6C2',
      parentId: null,
      coverImageUri: null,
      description: '  Bodies and lenses  ',
    });
    expect(gear.description).toBe('Bodies and lenses');
    const renamed = await inventory.updateCategory(gear.id, {
      name: 'Photo gear',
      icon: 'camera-outline',
      color: '#6FD6C2',
      parentId: null,
      coverImageUri: null,
    });
    expect(renamed).toMatchObject({ name: 'Photo gear', description: 'Bodies and lenses' });
    await expect(
      inventory.updateCategory(gear.id, { ...renamed, description: 'x'.repeat(201) }),
    ).rejects.toThrow('200');
    db.close();
  });

  it('protects starter categories from deletion but allows renaming them', async () => {
    const { db, inventory } = await setup();
    const clothing = (await inventory.listCategories()).find((c) => c.systemKey === 'clothing')!;
    await expect(inventory.deleteCategory(clothing.id)).rejects.toThrow('starter category');
    const renamed = await inventory.updateCategory(clothing.id, { ...clothing, name: 'Clothes' });
    expect(renamed).toMatchObject({ name: 'Clothes', systemKey: 'clothing' });
    db.close();
  });
});

describe('shopping list linked to packing entries', () => {
  it('creates one purchase per entry and never duplicates it', async () => {
    const { db, packing, purchases, tripA } = await setup();
    const entry = await packing.addEntry(tripA.id, { name: 'Sunscreen', quantity: 2, unit: 'bottles' });
    const first = await purchases.addForEntry(entry.id);
    expect(first.duplicate).toBe(false);
    expect(first.item).toMatchObject({ name: 'Sunscreen', quantity: 2, packingEntryId: entry.id, status: 'needed' });
    const again = await purchases.addForEntry(entry.id);
    expect(again).toMatchObject({ duplicate: true, item: { id: first.item.id } });
    expect(await purchases.list(tripA.id)).toHaveLength(1);
    db.close();
  });

  it('links an existing open purchase with the same name instead of adding another', async () => {
    const { db, packing, purchases, tripA } = await setup();
    const existing = await purchases.add(tripA.id, { name: 'sunscreen', quantity: 1, categoryId: null });
    const entry = await packing.addEntry(tripA.id, { name: 'Sunscreen' });
    const result = await purchases.addForEntry(entry.id);
    expect(result).toMatchObject({ duplicate: true, item: { id: existing.item.id, packingEntryId: entry.id } });
    expect(await purchases.list(tripA.id)).toHaveLength(1);
    db.close();
  });

  it('bought → add to inventory links the trip entry to the new belonging', async () => {
    const { db, packing, purchases, inventory, tripA } = await setup();
    const entry = await packing.addEntry(tripA.id, { name: 'Power bank' });
    const { item } = await purchases.addForEntry(entry.id);
    await purchases.setStatus(item.id, 'purchased');
    await expect(purchases.addToTrip(item.id)).rejects.toThrow('Already on the packing list');
    const added = await purchases.addToInventory(item.id);
    expect(added.inventoryItemId).toBeTruthy();
    const [linked] = (await packing.load(tripA.id)).entries;
    expect(linked).toMatchObject({ id: entry.id, inventoryItemId: added.inventoryItemId, isPacked: false });
    expect((await inventory.getItem(added.inventoryItemId!))?.name).toBe('Power bank');
    db.close();
  });

  it('keeps the purchase when its entry is removed', async () => {
    const { db, packing, purchases, tripA } = await setup();
    const entry = await packing.addEntry(tripA.id, { name: 'Adapter' });
    const { item } = await purchases.addForEntry(entry.id);
    await packing.removeEntry(entry.id);
    expect((await purchases.list(tripA.id))[0]).toMatchObject({ id: item.id, packingEntryId: null });
    db.close();
  });
});
