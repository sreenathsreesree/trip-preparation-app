import { itemInput, setupRepositories, tripInput } from '../../../../test/fixtures';
import { createClothingRepository } from '../clothingRepository';
import { STARTER_CATEGORIES, summarise } from '../model';

async function setup() {
  const repos = await setupRepositories();
  const clothing = createClothingRepository(repos.database, { createId: repos.deps.createId });
  const trip = await repos.trips.create(tripInput({ name: 'Goa', startDate: '2026-12-20', endDate: '2026-12-24' }), { sections: [] });
  return { ...repos, clothing, trip };
}

describe('clothing organizer', () => {
  it('creates starter categories once, and never again after the user changes them', async () => {
    const { clothing, trip } = await setup();
    expect(await clothing.ensureStarter(trip.id)).toBe(true);
    const cats = await clothing.categories(trip.id);
    expect(cats.map((c) => c.name)).toEqual(STARTER_CATEGORIES.map((c) => c.name));
    for (const c of cats) await clothing.removeCategory(c.id, null);
    expect(await clothing.ensureStarter(trip.id)).toBe(true);
    await clothing.addCategory(trip.id, { name: 'Swimwear', icon: 'hanger' });
    expect(await clothing.ensureStarter(trip.id)).toBe(false);
  });

  it('adds, renames and validates categories', async () => {
    const { clothing, trip } = await setup();
    const tees = await clothing.addCategory(trip.id, { name: 'T-shirts', icon: 'tshirt-crew-outline' });
    await expect(clothing.addCategory(trip.id, { name: ' t-shirts ', icon: 'hanger' })).rejects.toThrow(/already/);
    await clothing.updateCategory(tees.id, { name: 'Tees', icon: 'tshirt-v-outline' });
    expect((await clothing.categories(trip.id))[0]).toMatchObject({ name: 'Tees', icon: 'tshirt-v-outline' });
  });

  it('keeps items when a category is deleted: moved to another one or left without a category', async () => {
    const { clothing, trip, packing } = await setup();
    const tees = await clothing.addCategory(trip.id, { name: 'T-shirts', icon: 'hanger' });
    const shirts = await clothing.addCategory(trip.id, { name: 'Shirts', icon: 'hanger' });
    const e1 = await packing.addEntry(trip.id, { name: 'Blue tee', quantity: 2 });
    await clothing.link(trip.id, e1.id, tees.id);
    await clothing.removeCategory(tees.id, shirts.id);
    expect(await clothing.links(trip.id)).toEqual({ [e1.id]: shirts.id });
    await clothing.removeCategory(shirts.id, null);
    expect(await clothing.links(trip.id)).toEqual({ [e1.id]: null });
    expect((await packing.load(trip.id)).entries.map((e) => e.name)).toEqual(['Blue tee']);
  });

  it('links inventory items without changing the inventory record', async () => {
    const { clothing, trip, packing, inventory } = await setup();
    const shirt = await inventory.createItem(itemInput({ name: 'Linen shirt', quantity: 3 }));
    const cat = await clothing.addCategory(trip.id, { name: 'Shirts', icon: 'hanger' });
    const entry = await packing.addEntry(trip.id, { name: shirt.name, inventoryItemId: shirt.id, quantity: 1, source: 'inventory' });
    await clothing.link(trip.id, entry.id, cat.id);
    await packing.removeEntry(entry.id);
    expect(await clothing.links(trip.id)).toEqual({});
    expect((await inventory.getItem(shirt.id))?.quantity).toBe(3);
  });

  it('refuses to link another trip’s entry', async () => {
    const { clothing, trip, packing, trips } = await setup();
    const other = await trips.create(tripInput({ name: 'Other' }), { sections: [] });
    const entry = await packing.addEntry(other.id, { name: 'Sock' });
    await expect(clothing.link(trip.id, entry.id, null)).rejects.toThrow(/not on this trip/);
  });

  it('moves a deleted bag’s contents to another bag, or out of any bag, never deleting them', async () => {
    const { trip, packing } = await setup();
    const a = await packing.addLuggage(trip.id, { kind: 'suitcase' });
    const b = await packing.addLuggage(trip.id, { kind: 'cabin' });
    const e = await packing.addEntry(trip.id, { name: 'Jacket', luggageId: a.id });
    await packing.removeLuggageMoving(a.id, b.id);
    let state = await packing.load(trip.id);
    expect(state.entries.find((x) => x.id === e.id)?.luggageId).toBe(b.id);
    expect(state.luggage.map((l) => l.id)).toEqual([b.id]);
    await packing.removeLuggageMoving(b.id, null);
    state = await packing.load(trip.id);
    expect(state.entries.find((x) => x.id === e.id)?.luggageId).toBeNull();
    expect(state.luggage).toEqual([]);
  });

  it('summarises clothing per category and per bag', () => {
    const entry = (id: string, quantity: number, isPacked: boolean, luggageId: string | null) => ({ id, quantity, isPacked, luggageId }) as never;
    const s = summarise(
      [entry('1', 2, true, 'bag'), entry('2', 1, false, null), entry('3', 4, false, 'bag')],
      { '1': 'c1', '2': null },
      [{ id: 'c1', tripId: 't', name: 'Tees', icon: 'hanger', position: 0 }],
      [{ id: 'bag', tripId: 't', name: 'Suitcase', kind: 'suitcase', travellerId: null, position: 0 }],
    );
    expect(s.total).toEqual({ units: 3, packed: 2 });
    expect(s.byCategory.c1).toEqual({ units: 2, packed: 2, items: 1 });
    expect(s.byBag).toEqual([
      { id: 'bag', name: 'Suitcase', progress: { units: 6, packed: 2 }, items: 2 },
      { id: null, name: 'Not in a bag', progress: { units: 1, packed: 0 }, items: 1 },
    ]);
    expect(s.uncategorised).toBe(1);
  });
});
