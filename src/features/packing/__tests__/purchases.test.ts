import { setupRepositories, tripInput } from '../../../../test/fixtures';

async function setup() {
  const repos = await setupRepositories();
  const trip = await repos.trips.create(tripInput({ name: 'Goa' }), { sections: [] });
  return { ...repos, trip };
}

describe('purchase list', () => {
  it('adds items and prevents duplicates of open entries', async () => {
    const { db, purchases, trip } = await setup();
    const first = await purchases.add(trip.id, { name: 'Sunscreen SPF 50', quantity: 1, categoryId: null });
    expect(first.duplicate).toBe(false);
    const again = await purchases.add(trip.id, { name: '  sunscreen   spf 50 ', quantity: 2, categoryId: null });
    expect(again).toMatchObject({ duplicate: true, item: { id: first.item.id, quantity: 1 } });
    expect(await purchases.list(trip.id)).toHaveLength(1);

    // Once skipped, it can be added again — and reopening the skipped one is then refused.
    await purchases.setStatus(first.item.id, 'skipped');
    const reAdded = await purchases.add(trip.id, { name: 'Sunscreen SPF 50', quantity: 1, categoryId: null });
    expect(reAdded.duplicate).toBe(false);
    await expect(purchases.setStatus(first.item.id, 'needed')).rejects.toThrow(/already on this purchase list/);
    db.close();
  });

  it('tracks owned, borrowed, skipped and purchased with timestamps', async () => {
    const { db, purchases, trip } = await setup();
    const { item } = await purchases.add(trip.id, { name: 'Power bank', quantity: 1, categoryId: null });
    const bought = await purchases.setStatus(item.id, 'purchased');
    expect(bought.purchasedAt).toEqual(expect.any(String));
    expect(bought.resolvedAt).toBeNull();
    const owned = await purchases.setStatus(item.id, 'owned');
    expect(owned).toMatchObject({ status: 'owned', resolvedAt: expect.any(String) });
    expect((await purchases.setStatus(item.id, 'borrowed')).status).toBe('borrowed');
    expect((await purchases.setStatus(item.id, 'needed')).purchasedAt).toBeNull();
    db.close();
  });

  it('after purchase: add to inventory and to the trip, never auto-packed', async () => {
    const { db, purchases, packing, inventory, trip } = await setup();
    const { item } = await purchases.add(trip.id, { name: 'Rain poncho', quantity: 2, categoryId: null });
    await expect(purchases.addToInventory(item.id)).rejects.toThrow(/purchased/);
    await purchases.setStatus(item.id, 'purchased');

    const inInventory = await purchases.addToInventory(item.id);
    const stored = await inventory.getItem(inInventory.inventoryItemId ?? '');
    expect(stored).toMatchObject({ name: 'Rain poncho', quantity: 2 });
    await expect(purchases.addToInventory(item.id)).rejects.toThrow(/Already/);

    const onTrip = await purchases.addToTrip(item.id);
    const entry = (await packing.load(trip.id)).entries.find((e) => e.id === onTrip.packingEntryId);
    expect(entry).toMatchObject({ name: 'Rain poncho', quantity: 2, isPacked: false, inventoryItemId: stored?.id, source: 'purchase' });
    await expect(purchases.addToTrip(item.id)).rejects.toThrow(/Already on the packing list/);
    db.close();
  });

  it('can put a purchased item on the trip as a one-time item without adding it to inventory', async () => {
    const { db, purchases, packing, inventory, trip } = await setup();
    const before = await inventory.countItems();
    const { item } = await purchases.add(trip.id, { name: 'Disposable rain cover', quantity: 1, categoryId: null });
    await purchases.setStatus(item.id, 'borrowed');
    await purchases.addToTrip(item.id);
    expect((await packing.load(trip.id)).entries[0]).toMatchObject({ inventoryItemId: null, notes: 'Borrowed', isPacked: false });
    expect(await inventory.countItems()).toBe(before);
    db.close();
  });

  it('keeps purchase history when the trip is renamed or deleted', async () => {
    const { db, purchases, trips, trip } = await setup();
    const { item } = await purchases.add(trip.id, { name: 'Swimwear', quantity: 1, categoryId: null });
    await purchases.setStatus(item.id, 'purchased');
    await trips.update(trip.id, { ...tripInput({ name: 'Goa & Gokarna' }) });
    expect((await purchases.list(trip.id))[0]?.tripName).toBe('Goa & Gokarna');

    await trips.remove(trip.id);
    const history = await purchases.list();
    expect(history).toEqual([expect.objectContaining({ id: item.id, tripId: null, tripName: 'Goa & Gokarna', status: 'purchased' })]);
    db.close();
  });

  it('a missing recommended item can go to the purchase list (once)', async () => {
    const { db, recommendations, purchases, trip } = await setup();
    await recommendations.apply(trip.id);
    const rec = (await recommendations.list(trip.id)).find((r) => r.inventoryItemId === null);
    expect(await recommendations.addToPurchaseList(rec?.id ?? '')).toEqual({ duplicate: false });
    expect(await recommendations.addToPurchaseList(rec?.id ?? '')).toEqual({ duplicate: true });
    const list = await purchases.list(trip.id);
    expect(list).toEqual([expect.objectContaining({ name: rec?.name, recommendationId: rec?.id, status: 'needed' })]);
    expect((await recommendations.list(trip.id)).find((r) => r.id === rec?.id)?.status).toBe('accepted');
    db.close();
  });
});
