import { itemInput, tripInput } from '../../../test/fixtures';
import { openTestDatabase, sequentialIds } from '../../../test/nodeSqliteDatabase';
import { createInventoryRepository } from '../../features/inventory/inventoryRepository';
import { createPackingRepository } from '../../features/packing/packingRepository';
import { createPlannerRepository } from '../../features/planner/plannerRepository';
import { routeNodes } from '../../features/planner/model';
import { tripOwner } from '../../features/preparation/model';
import { buildStarterChecklist } from '../../features/preparation/starter';
import { createChecklistRepository, insertPlan } from '../../features/preparation/checklistRepository';
import { createTripRepository } from '../../features/trips/tripRepository';
import { getSchemaVersion, migrate } from '../migrate';
import { migrations } from '../migrations';

describe('migration 4: destination planner', () => {
  it('upgrades a v3 database, keeping every trip, checklist, inventory and packing row', async () => {
    const db = openTestDatabase();
    await migrate(db, migrations.slice(0, 3));
    const deps = { createId: sequentialIds('v3'), now: () => new Date('2026-11-01T00:00:00Z') };

    // Write v3 data with v3-era SQL (the current trip repository already expects v4 tables).
    await db.runAsync(
      `INSERT INTO trips (id, name, destination, start_date, end_date, adults, children, transport_mode, category,
         created_at, updated_at) VALUES ('trip-1', 'Kerala Road Trip', 'Munnar', '2026-12-20', '2026-12-24', 2, 0,
         'car', 'leisure', '2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z')`,
      [],
    );
    for (const [id, name, position] of [
      ['d-ath', 'Athirappilly', 1],
      ['d-mun', 'Munnar', 0],
    ] as const) {
      await db.runAsync(
        `INSERT INTO trip_destinations (id, trip_id, name, position, created_at, updated_at)
         VALUES (?, 'trip-1', ?, ?, '2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z')`,
        [id, name, position],
      );
    }
    await db.runAsync(
      `INSERT INTO trip_travellers (id, trip_id, name, kind, position, created_at, updated_at)
       VALUES ('tr-1', 'trip-1', 'Asha', 'adult', 0, '2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z')`,
      [],
    );
    const checklists = createChecklistRepository(db, deps);
    const inventory = createInventoryRepository(db, deps);
    const packing = createPackingRepository(db, deps);
    await db.withTransactionAsync(async () => {
      await insertPlan(db, tripOwner('trip-1'), buildStarterChecklist(tripInput()), {
        createId: deps.createId,
        timestamp: '2026-11-01T00:00:00Z',
      });
    });
    const camera = await inventory.createItem(itemInput({ name: 'Camera', quantity: 1 }));
    // v3-era SQL: the current packing repository writes v5 columns.
    await db.runAsync(
      `INSERT INTO packing_entries (id, trip_id, inventory_item_id, name, category_id, quantity, traveller_id, luggage_id,
         is_packed, notes, source, recommendation_id, position, created_at, updated_at)
       VALUES ('e-1', 'trip-1', ?, 'Camera', NULL, 1, NULL, NULL, 0, '', 'inventory', NULL, 0,
         '2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z')`,
      [camera.id],
    );
    const checklistBefore = await checklists.load(tripOwner('trip-1'));
    const packingBefore = await packing.load('trip-1');
    const itemsBefore = await inventory.listItems();
    const tripRow = await db.getFirstAsync('SELECT * FROM trips WHERE id = ?', ['trip-1']);

    const result = await migrate(db, migrations.slice(0, 4));
    expect(result.applied).toEqual(['destination_planner']);
    expect(await getSchemaVersion(db)).toBe(4);

    const trips = createTripRepository(db, deps);
    const trip = await trips.getById('trip-1');
    expect(trip?.destinations.map((d) => d.name)).toEqual(['Munnar', 'Athirappilly']);
    expect(trip?.travellers.map((t) => t.name)).toEqual(['Asha']);
    expect(await checklists.load(tripOwner('trip-1'))).toEqual(checklistBefore);
    expect(await packing.load('trip-1')).toEqual(packingBefore);
    expect(await inventory.listItems()).toEqual(itemsBefore);
    expect(await db.getFirstAsync('SELECT * FROM trips WHERE id = ?', ['trip-1'])).toEqual({
      ...(tripRow as object),
      planner_opened_at: null,
    });

    // Destinations became main destinations and route stops, in their order.
    const plan = await createPlannerRepository(db, deps).load('trip-1');
    expect(plan.nodes.map((n) => [n.name, n.parentId, n.origin, n.tripDestinationId, n.position])).toEqual(
      expect.arrayContaining([
        ['Munnar', null, 'trip', 'd-mun', 0],
        ['Athirappilly', null, 'trip', 'd-ath', 1],
      ]),
    );
    expect(routeNodes(plan).map((n) => n.name)).toEqual(['Munnar', 'Athirappilly']);
    expect(new Set(plan.nodes.map((n) => n.id)).size).toBe(2);
    db.close();
  });

  it('upgrades an empty v3 database', async () => {
    const db = openTestDatabase();
    await migrate(db, migrations.slice(0, 3));
    await migrate(db, migrations.slice(0, 4));
    expect(await getSchemaVersion(db)).toBe(4);
    expect(await db.getAllAsync('SELECT * FROM trip_plan_nodes', [])).toEqual([]);
    db.close();
  });
});
