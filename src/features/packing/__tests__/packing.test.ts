import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { itemInput, setupRepositories, tripInput } from '../../../../test/fixtures';
import { openTestDatabase } from '../../../../test/nodeSqliteDatabase';
import { effectiveStatus } from '../../inventory/model';
import {
  availableQuantity,
  datesOverlap,
  estimateWeight,
  findReservationConflicts,
  packingProgress,
} from '../model';

const goa = tripInput({ name: 'Goa', startDate: '2026-12-20', endDate: '2026-12-24' });
const overlapping = tripInput({ name: 'Overlap', startDate: '2026-12-23', endDate: '2026-12-27' });
const later = tripInput({ name: 'Later', startDate: '2027-01-10', endDate: '2027-01-12' });

async function setup() {
  const repos = await setupRepositories();
  const camera = await repos.inventory.createItem(itemInput({ name: 'Camera', quantity: 1, weightGrams: 800 }));
  const tees = await repos.inventory.createItem(itemInput({ name: 'T-shirt', quantity: 5, weightGrams: 150 }));
  const tripA = await repos.trips.create(goa, { sections: [] });
  return { ...repos, camera, tees, tripA };
}

describe('pure reservation logic', () => {
  it('detects overlapping date ranges (inclusive)', () => {
    expect(datesOverlap({ startDate: '2026-12-20', endDate: '2026-12-24' }, { startDate: '2026-12-24', endDate: '2026-12-30' })).toBe(true);
    expect(datesOverlap({ startDate: '2026-12-20', endDate: '2026-12-24' }, { startDate: '2026-12-25', endDate: '2026-12-30' })).toBe(false);
  });

  it('subtracts only overlapping reservations of other trips', () => {
    const reservations = [
      { inventoryItemId: 'i', tripId: 'a', quantity: 2, startDate: '2026-12-20', endDate: '2026-12-24' },
      { inventoryItemId: 'i', tripId: 'b', quantity: 1, startDate: '2027-01-10', endDate: '2027-01-12' },
      { inventoryItemId: 'i', tripId: 'self', quantity: 3, startDate: '2026-12-22', endDate: '2026-12-23' },
    ];
    expect(availableQuantity(4, reservations, { startDate: '2026-12-22', endDate: '2026-12-23' }, 'self')).toBe(2);
    expect(availableQuantity(4, reservations, { startDate: '2026-12-26', endDate: '2026-12-28' }, 'self')).toBe(4);
  });

  it('flags insufficient, damaged, borrowed and archived items', () => {
    const items = new Map([
      ['a', { id: 'a', name: 'A', quantity: 1, availability: 'available' as const, archivedAt: null }],
      ['b', { id: 'b', name: 'B', quantity: 5, availability: 'damaged' as const, archivedAt: null }],
      ['c', { id: 'c', name: 'C', quantity: 5, availability: 'borrowed' as const, archivedAt: null }],
      ['d', { id: 'd', name: 'D', quantity: 5, availability: 'available' as const, archivedAt: 'x' }],
    ]);
    const conflicts = findReservationConflicts(
      't',
      { startDate: '2026-12-20', endDate: '2026-12-24' },
      [
        { inventoryItemId: 'a', quantity: 1 },
        { inventoryItemId: 'a', quantity: 1 }, // two entries for the same item add up
        { inventoryItemId: 'b', quantity: 1 },
        { inventoryItemId: 'c', quantity: 1 },
        { inventoryItemId: 'd', quantity: 1 },
        { inventoryItemId: null, quantity: 9 }, // one-time items never conflict
      ],
      items,
      [],
    );
    expect(conflicts.map((c) => [c.inventoryItemId, c.reason])).toEqual([
      ['a', 'insufficient'],
      ['b', 'damaged'],
      ['c', 'borrowed'],
      ['d', 'archived'],
    ]);
  });
});

describe('inventory items vs packing entries', () => {
  it('packing entries copy the item and then live independently', async () => {
    const { db, inventory, packing, tees, tripA } = await setup();
    const entry = await packing.addEntry(tripA.id, { inventoryItemId: tees.id, name: '', quantity: 3 });
    expect(entry).toMatchObject({ name: 'T-shirt', quantity: 3, inventoryItemId: tees.id, source: 'inventory' });

    // Editing the entry never changes the inventory item.
    await packing.updateEntry(entry.id, { name: 'Beach tees', quantity: 2, isPacked: true, notes: 'Light ones' });
    expect(await inventory.getItem(tees.id)).toMatchObject({ name: 'T-shirt', quantity: 5 });

    // Editing the item never rewrites the entry.
    await inventory.updateItem(tees.id, itemInput({ name: 'Cotton tee', quantity: 6, weightGrams: 150 }));
    expect((await packing.load(tripA.id)).entries[0]).toMatchObject({ name: 'Beach tees', quantity: 2, isPacked: true });

    // Removing the entry never deletes the item.
    await packing.removeEntry(entry.id);
    expect((await packing.load(tripA.id)).entries).toEqual([]);
    expect(await inventory.getItem(tees.id)).toMatchObject({ name: 'Cotton tee', quantity: 6 });
    db.close();
  });

  it('supports one-time items that never touch the inventory', async () => {
    const { db, inventory, packing, tripA } = await setup();
    const before = await inventory.countItems();
    const entry = await packing.addEntry(tripA.id, { name: 'Borrowed tent', quantity: 1, notes: 'From Ravi' });
    expect(entry).toMatchObject({ inventoryItemId: null, source: 'manual', name: 'Borrowed tent' });
    expect(await inventory.countItems()).toBe(before);
    db.close();
  });

  it('several trips can use the same inventory item with their own quantities', async () => {
    const { db, trips, packing, tees, tripA } = await setup();
    const tripB = await trips.create(later, { sections: [] });
    const a = await packing.addEntry(tripA.id, { inventoryItemId: tees.id, name: '', quantity: 4 });
    const b = await packing.addEntry(tripB.id, { inventoryItemId: tees.id, name: '', quantity: 2 });
    await packing.updateEntry(a.id, { quantity: 5, isPacked: true });
    expect((await packing.load(tripB.id)).entries[0]).toMatchObject({ id: b.id, quantity: 2, isPacked: false });
    db.close();
  });

  it('deleting an inventory item keeps trip entries as one-time items', async () => {
    const { db, inventory, packing, camera, tripA } = await setup();
    await packing.addEntry(tripA.id, { inventoryItemId: camera.id, name: '', quantity: 1 });
    await packing.confirm(tripA.id);
    await inventory.deleteItem(camera.id);
    expect((await packing.load(tripA.id)).entries[0]).toMatchObject({ name: 'Camera', inventoryItemId: null });
    db.close();
  });
});

describe('reservations', () => {
  it('draft lists reserve nothing; confirming reserves; removing releases', async () => {
    const { db, inventory, packing, camera, tripA } = await setup();
    const entry = await packing.addEntry(tripA.id, { inventoryItemId: camera.id, name: '', quantity: 1 });
    expect((await inventory.getItem(camera.id))?.usage.reservedQuantity).toBe(0);

    expect(await packing.confirm(tripA.id)).toEqual({ ok: true });
    const reserved = await inventory.getItem(camera.id);
    expect(reserved?.usage.reservedQuantity).toBe(1);
    expect(effectiveStatus(reserved!, reserved!.usage)).toBe('reserved');

    await packing.updateEntry(entry.id, { isPacked: true });
    const packed = await inventory.getItem(camera.id);
    expect(effectiveStatus(packed!, packed!.usage)).toBe('packed');

    await packing.removeEntry(entry.id);
    expect((await inventory.getItem(camera.id))?.usage.reservedQuantity).toBe(0);
    const history = await db.getAllAsync<{ status: string }>('SELECT status FROM inventory_reservations', []);
    expect(history).toEqual([{ status: 'released' }]);
    db.close();
  });

  it('prevents overlapping trips from reserving more than you own', async () => {
    const { db, trips, packing, camera, tripA } = await setup();
    const tripB = await trips.create(overlapping, { sections: [] });
    const tripC = await trips.create(later, { sections: [] });
    await packing.addEntry(tripA.id, { inventoryItemId: camera.id, name: '', quantity: 1 });
    await packing.confirm(tripA.id);

    // Overlapping trip: drafting is fine, confirming is refused with a clear conflict.
    await packing.addEntry(tripB.id, { inventoryItemId: camera.id, name: '', quantity: 1 });
    const result = await packing.confirm(tripB.id);
    expect(result).toEqual({
      ok: false,
      conflicts: [{ inventoryItemId: camera.id, name: 'Camera', requested: 1, available: 0, reason: 'insufficient' }],
    });
    expect((await packing.load(tripB.id)).state.confirmedAt).toBeNull();
    expect(await packing.availability(tripB.id, [camera.id])).toEqual({ [camera.id]: 0 });

    // A trip on other dates can reserve the same camera.
    await packing.addEntry(tripC.id, { inventoryItemId: camera.id, name: '', quantity: 1 });
    expect(await packing.confirm(tripC.id)).toEqual({ ok: true });
    db.close();
  });

  it('blocks over-booking changes on a confirmed list and rolls them back', async () => {
    const { db, trips, packing, tees, tripA } = await setup();
    const tripB = await trips.create(overlapping, { sections: [] });
    await packing.addEntry(tripA.id, { inventoryItemId: tees.id, name: '', quantity: 3 });
    await packing.confirm(tripA.id);
    const b = await packing.addEntry(tripB.id, { inventoryItemId: tees.id, name: '', quantity: 2 });
    await packing.confirm(tripB.id);

    await expect(packing.updateEntry(b.id, { quantity: 3 })).rejects.toThrow(/only 2 free/);
    expect((await packing.load(tripB.id)).entries[0]?.quantity).toBe(2);
    await expect(
      packing.addEntry(tripB.id, { inventoryItemId: tees.id, name: '', quantity: 1 }),
    ).rejects.toThrow(/T-shirt/);
    expect((await packing.load(tripB.id)).entries).toHaveLength(1);
    db.close();
  });

  it('damaged and borrowed items cannot be reserved', async () => {
    const { db, inventory, packing, camera, tripA } = await setup();
    await inventory.setAvailability(camera.id, 'damaged');
    await packing.addEntry(tripA.id, { inventoryItemId: camera.id, name: '', quantity: 1 });
    const damaged = await packing.confirm(tripA.id);
    expect(damaged.ok).toBe(false);
    await inventory.setAvailability(camera.id, 'borrowed');
    expect((await packing.checkConflicts(tripA.id))[0]?.reason).toBe('borrowed');
    await inventory.setAvailability(camera.id, 'available');
    expect((await packing.confirm(tripA.id)).ok).toBe(true);
    db.close();
  });

  it('inventory quantity cannot drop below what overlapping trips have reserved', async () => {
    const { db, inventory, packing, tees, tripA } = await setup();
    await packing.addEntry(tripA.id, { inventoryItemId: tees.id, name: '', quantity: 4 });
    await packing.confirm(tripA.id);
    await expect(inventory.adjustQuantity(tees.id, -2)).rejects.toThrow(/reserved/);
    await expect(inventory.setArchived(tees.id, true)).rejects.toThrow(/reserved/);
    expect((await inventory.adjustQuantity(tees.id, -1)).quantity).toBe(4);
    db.close();
  });

  it('completing or archiving a trip closes its reservations and returns the list to draft', async () => {
    const { db, trips, inventory, packing, camera, tripA } = await setup();
    await packing.addEntry(tripA.id, { inventoryItemId: camera.id, name: '', quantity: 1 });
    await packing.confirm(tripA.id);
    await trips.setCompleted(tripA.id, true);
    expect((await inventory.getItem(camera.id))?.usage.reservedQuantity).toBe(0);
    const state = (await packing.load(tripA.id)).state;
    expect(state.confirmedAt).toBeNull();
    expect(state.draftReason).toMatch(/completed/);

    await trips.setCompleted(tripA.id, false);
    await packing.confirm(tripA.id);
    await trips.setArchived(tripA.id, true);
    expect((await inventory.getItem(camera.id))?.usage.reservedQuantity).toBe(0);
    const statuses = await db.getAllAsync<{ status: string }>('SELECT status FROM inventory_reservations ORDER BY created_at', []);
    expect(statuses.map((s) => s.status)).toEqual(['closed', 'closed']);

    // A finished trip cannot hold inventory again until it is restored.
    await expect(packing.confirm(tripA.id)).rejects.toThrow(/Reopen or restore/);
    expect((await inventory.getItem(camera.id))?.usage.reservedQuantity).toBe(0);
    db.close();
  });

  it('moving a confirmed trip onto clashing dates returns it to draft', async () => {
    const { db, trips, packing, camera, tripA } = await setup();
    const tripC = await trips.create(later, { sections: [] });
    await packing.addEntry(tripA.id, { inventoryItemId: camera.id, name: '', quantity: 1 });
    await packing.confirm(tripA.id);
    await packing.addEntry(tripC.id, { inventoryItemId: camera.id, name: '', quantity: 1 });
    await packing.confirm(tripC.id);

    // Non-clashing date change keeps the reservation and moves it.
    await trips.update(tripC.id, { ...later, startDate: '2027-01-11', endDate: '2027-01-13' });
    expect((await packing.load(tripC.id)).state.confirmedAt).not.toBeNull();
    // Clashing change releases it with an explanation.
    await trips.update(tripC.id, { ...later, startDate: '2026-12-22', endDate: '2026-12-26' });
    const state = (await packing.load(tripC.id)).state;
    expect(state.confirmedAt).toBeNull();
    expect(state.draftReason).toMatch(/clash/);
    db.close();
  });
});

describe('luggage', () => {
  it('assigns entries to bags and estimates weight only where known', async () => {
    const { db, packing, inventory, camera, tees, tripA } = await setup();
    const unknown = await inventory.createItem(itemInput({ name: 'Charger', quantity: 1, weightGrams: null }));
    const bag = await packing.addLuggage(tripA.id, { kind: 'cabin' });
    expect(bag.name).toBe('Cabin bag');
    const custom = await packing.addLuggage(tripA.id, { kind: 'custom', name: 'Shoe bag' });

    const e1 = await packing.addEntry(tripA.id, { inventoryItemId: camera.id, name: '', quantity: 1, luggageId: bag.id });
    await packing.addEntry(tripA.id, { inventoryItemId: tees.id, name: '', quantity: 2, luggageId: bag.id });
    await packing.addEntry(tripA.id, { inventoryItemId: unknown.id, name: '', quantity: 1, luggageId: bag.id });
    await packing.addEntry(tripA.id, { name: 'Snacks', quantity: 1, luggageId: custom.id });
    await packing.updateEntry(e1.id, { isPacked: true });

    const { entries, items } = { entries: (await packing.load(tripA.id)).entries, items: await inventory.listItems() };
    const inBag = entries.filter((e) => e.luggageId === bag.id);
    const weightOf = (id: string) => items.find((i) => i.id === id)?.weightGrams ?? null;
    expect(estimateWeight(inBag, weightOf)).toEqual({ knownGrams: 800 + 300, unknownUnits: 1 });
    expect(packingProgress(inBag)).toEqual({ entries: 3, packedEntries: 1, units: 4, packedUnits: 1 });

    await packing.updateLuggage(bag.id, { name: 'Asha’s cabin bag', travellerId: tripA.travellers[0]?.id ?? null });
    await packing.removeLuggage(custom.id);
    const after = await packing.load(tripA.id);
    expect(after.luggage.map((l) => l.name)).toEqual(['Asha’s cabin bag']);
    expect(after.entries.find((e) => e.name === 'Snacks')?.luggageId).toBeNull();
    db.close();
  });

  it('sets a bag’s contents in one step, only within its own trip', async () => {
    const { db, trips, packing, tees, camera, tripA } = await setup();
    const tripB = await trips.create(later, { sections: [] });
    const bag = await packing.addLuggage(tripA.id, { kind: 'backpack' });
    const other = await packing.addLuggage(tripA.id, { kind: 'daypack' });
    const a = await packing.addEntry(tripA.id, { inventoryItemId: tees.id, name: '', quantity: 1, luggageId: other.id });
    const b = await packing.addEntry(tripA.id, { inventoryItemId: camera.id, name: '', quantity: 1 });
    const c = await packing.addEntry(tripA.id, { name: 'Map', quantity: 1, luggageId: bag.id });
    const foreign = await packing.addEntry(tripB.id, { name: 'Elsewhere', quantity: 1 });

    await packing.setLuggageContents(bag.id, [a.id, b.id, foreign.id]);
    const entries = (await packing.load(tripA.id)).entries;
    const bagOf = (id: string) => entries.find((e) => e.id === id)?.luggageId;
    expect(bagOf(a.id)).toBe(bag.id); // moved from the daypack
    expect(bagOf(b.id)).toBe(bag.id);
    expect(bagOf(c.id)).toBeNull(); // taken out
    expect((await packing.load(tripB.id)).entries[0]?.luggageId).toBeNull();
    db.close();
  });

  it('assigns entries to travellers', async () => {
    const { db, packing, tees, tripA } = await setup();
    const [asha, ravi] = tripA.travellers;
    const entry = await packing.addEntry(tripA.id, { inventoryItemId: tees.id, name: '', quantity: 2, travellerId: asha?.id });
    const moved = await packing.updateEntry(entry.id, { travellerId: ravi?.id ?? null });
    expect(moved.travellerId).toBe(ravi?.id);
    db.close();
  });
});

describe('trip duplication and persistence', () => {
  it('duplicating a trip copies its packing list unpacked and unreserved', async () => {
    const { db, trips, packing, inventory, camera, tripA } = await setup();
    const bag = await packing.addLuggage(tripA.id, { kind: 'backpack' });
    const entry = await packing.addEntry(tripA.id, {
      inventoryItemId: camera.id,
      name: '',
      quantity: 1,
      luggageId: bag.id,
      travellerId: tripA.travellers[1]?.id,
    });
    await packing.updateEntry(entry.id, { isPacked: true });
    await packing.confirm(tripA.id);

    const copy = await trips.duplicate(tripA.id);
    const copied = await packing.load(copy.id);
    expect(copied.state.confirmedAt).toBeNull();
    expect(copied.luggage).toHaveLength(1);
    expect(copied.entries[0]).toMatchObject({
      name: 'Camera',
      isPacked: false,
      luggageId: copied.luggage[0]?.id,
      travellerId: copy.travellers[1]?.id,
    });
    expect((await inventory.getItem(camera.id))?.usage.reservedQuantity).toBe(1);
    db.close();
  });

  it('keeps inventory, packing, luggage and reservations after reopening the database', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'trip-prep-m4-'));
    const file = join(dir, 'trip-prep.db');
    try {
      const first = await setupRepositories(openTestDatabase(file));
      const item = await first.inventory.createItem(itemInput({ name: 'Headlamp', quantity: 2 }));
      const trip = await first.trips.create(goa, { sections: [] });
      const bag = await first.packing.addLuggage(trip.id, { kind: 'daypack' });
      await first.packing.addEntry(trip.id, { inventoryItemId: item.id, name: '', quantity: 2, luggageId: bag.id });
      await first.packing.updateProfile(trip.id, { activities: ['trekking'], accommodation: 'camping', laundry: true });
      await first.packing.confirm(trip.id);
      const before = await first.packing.load(trip.id);
      const itemBefore = await first.inventory.getItem(item.id);
      first.db.close();

      const second = await setupRepositories(openTestDatabase(file));
      expect(await second.packing.load(trip.id)).toEqual(before);
      expect(await second.inventory.getItem(item.id)).toEqual(itemBefore);
      expect(itemBefore?.usage.reservedQuantity).toBe(2);
      second.db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
