import { itemInput, setupRepositories, tripInput } from '../../../../test/fixtures';
import type { Traveller } from '../../trips/model';
import { planRegeneration, type Recommendation } from '../model';
import { buildContext, clothingSets, generateSuggestions, type RecommendationInput } from '../recommendations';

const travellers: Traveller[] = [
  { id: 'asha', name: 'Asha', kind: 'adult' },
  { id: 'ravi', name: 'Ravi', kind: 'adult' },
  { id: 'mia', name: 'Mia', kind: 'child' },
];

const base: RecommendationInput = {
  startDate: '2026-11-20',
  endDate: '2026-11-24',
  destinations: ['Jaipur'],
  transportMode: 'train',
  category: 'leisure',
  travellers,
  activities: [],
  accommodation: 'hotel',
  laundry: false,
  packingStyle: 'standard',
  inventory: [],
};

const gen = (overrides: Partial<RecommendationInput> = {}) => generateSuggestions({ ...base, ...overrides });
const keys = (overrides: Partial<RecommendationInput> = {}) => gen(overrides).map((s) => s.key);
const find = (key: string, overrides: Partial<RecommendationInput> = {}) => gen(overrides).find((s) => s.key === key);

describe('recommendation rules', () => {
  it('is deterministic with stable keys', () => {
    expect(gen()).toEqual(gen());
    expect(new Set(keys()).size).toBe(keys().length);
  });

  it('scales clothing with duration, laundry and packing style', () => {
    expect(find('clothing.tops:asha')?.quantity).toBe(5);
    expect(find('clothing.innerwear:asha')?.quantity).toBe(6);
    expect(find('clothing.tops:asha', { endDate: '2026-11-29' })?.quantity).toBe(10);
    expect(find('clothing.tops:asha', { endDate: '2026-11-29', laundry: true })?.quantity).toBe(4);
    expect(find('clothing.tops:asha', { packingStyle: 'light' })?.quantity).toBe(4);
    expect(find('clothing.tops:asha', { packingStyle: 'thorough' })?.quantity).toBe(6);
    expect(find('clothing.tops:asha', { endDate: '2026-11-29', laundry: true })?.reason).toMatch(/laundry/);
    const ctx = buildContext({ ...base, startDate: '2026-11-20', endDate: '2026-12-30' });
    expect(clothingSets(ctx)).toBe(10); // capped
  });

  it('assigns per-traveller items to each traveller, adult-only items to adults, kids items when children travel', () => {
    expect(keys().filter((k) => k.startsWith('documents.id:'))).toEqual(['documents.id:asha', 'documents.id:ravi', 'documents.id:mia']);
    expect(keys().filter((k) => k.startsWith('electronics.phone_charger:'))).toEqual([
      'electronics.phone_charger:asha',
      'electronics.phone_charger:ravi',
    ]);
    expect(find('clothing.tops:mia')?.travellerId).toBe('mia');
    expect(keys()).toContain('medicines.kids');
    expect(keys({ travellers: travellers.slice(0, 2) })).not.toContain('medicines.kids');
  });

  it('responds to transport mode', () => {
    expect(keys()).toContain('documents.tickets');
    expect(keys()).not.toContain('documents.licence');
    const car = keys({ transportMode: 'car' });
    expect(car).toEqual(expect.arrayContaining(['documents.licence', 'documents.vehicle', 'electronics.car_charger', 'food.water']));
    expect(keys({ transportMode: 'bike' })).toEqual(expect.arrayContaining(['accessories.helmet:asha', 'accessories.riding_gear:ravi']));
    expect(keys({ transportMode: 'flight' })).toContain('accessories.pillow:asha');
  });

  it('responds to destinations and season', () => {
    const leh = gen({ destinations: ['Manali', 'Leh'], startDate: '2027-01-05', endDate: '2027-01-10' });
    const jacket = leh.find((s) => s.key === 'clothing.warm_jacket:asha');
    expect(jacket).toMatchObject({ priority: 'essential', reason: 'Manali can be cold' });
    expect(leh.find((s) => s.key === 'medicines.altitude')?.reason).toBe('High altitude at Leh');
    expect(leh.map((s) => s.key)).toContain('documents.permits');
    const goa = gen({ destinations: ['North Goa'] });
    expect(goa.find((s) => s.key === 'clothing.swimwear:asha')?.reason).toBe('Beach time in North Goa');
    expect(keys({ startDate: '2026-07-10', endDate: '2026-07-12' })).toEqual(
      expect.arrayContaining(['accessories.umbrella', 'clothing.rain:asha', 'medicines.mosquito']),
    );
    expect(keys()).not.toContain('accessories.umbrella');
  });

  it('responds to category, activities and accommodation', () => {
    expect(find('clothing.formal:asha', { category: 'business' })?.quantity).toBe(3);
    expect(keys({ category: 'wedding' })).toEqual(expect.arrayContaining(['clothing.festive:mia', 'misc.gifts']));
    const camping = gen({ activities: ['camping', 'trekking', 'photography'], accommodation: 'camping' });
    const campKeys = camping.map((s) => s.key);
    expect(campKeys).toEqual(
      expect.arrayContaining(['outdoor.tent', 'outdoor.sleeping_bag:mia', 'footwear.trekking:asha', 'photography.camera']),
    );
    expect(camping.find((s) => s.key === 'outdoor.tent')?.quantity).toBe(2);
    expect(camping.find((s) => s.key === 'electronics.headlamp')?.priority).toBe('essential');
    expect(find('toiletries.kit', { accommodation: 'hostel' })).toMatchObject({ priority: 'essential' });
    expect(keys({ accommodation: 'hostel' })).toContain('accessories.padlock');
  });

  it('includes every priority level and a reason for each suggestion', () => {
    const all = gen({ transportMode: 'car', activities: ['photography'] });
    expect(new Set(all.map((s) => s.priority))).toEqual(new Set(['essential', 'recommended', 'optional']));
    expect(all.every((s) => s.reason.length > 0 && s.quantity >= 1)).toBe(true);
  });

  it('matches existing inventory by whole words, preferring the right category', () => {
    const inventory = [
      { id: 'laptop', name: 'Work laptop', description: '', categoryKey: 'electronics' as const },
      { id: 'tee', name: 'Cotton tops', description: '', categoryKey: 'clothing' as const },
      { id: 'pb', name: 'Anker power bank', description: '', categoryKey: 'electronics' as const },
    ];
    const suggestions = gen({ inventory });
    expect(suggestions.find((s) => s.key === 'clothing.tops:asha')?.inventoryItemId).toBe('tee');
    expect(suggestions.find((s) => s.key === 'electronics.power_bank')?.inventoryItemId).toBe('pb');
    expect(suggestions.find((s) => s.key === 'footwear.walking:asha')?.inventoryItemId).toBeNull();
  });
});

describe('regeneration planning', () => {
  const rec = (overrides: Partial<Recommendation>): Recommendation => ({
    id: overrides.key ?? 'id',
    tripId: 't',
    key: 'k',
    name: 'Thing',
    quantity: 1,
    priority: 'recommended',
    reason: 'r',
    categoryKey: 'misc',
    travellerId: null,
    inventoryItemId: null,
    status: 'pending',
    packingEntryId: null,
    createdAt: 'x',
    updatedAt: 'x',
    decidedAt: null,
    ...overrides,
  });
  const fresh = (key: string, quantity = 1) => ({
    key,
    name: 'Thing',
    quantity,
    priority: 'recommended' as const,
    reason: 'r',
    categoryKey: 'misc' as const,
    travellerId: null,
    inventoryItemId: null,
  });

  it('classifies new, changed, dropped and still-rejected suggestions', () => {
    const plan = planRegeneration(
      [
        rec({ key: 'same' }),
        rec({ key: 'pending-changed' }),
        rec({ key: 'accepted-changed', status: 'accepted', packingEntryId: 'e1' }),
        rec({ key: 'rejected', status: 'rejected' }),
        rec({ key: 'gone' }),
        rec({ key: 'gone-accepted', status: 'accepted', packingEntryId: 'e2' }),
        rec({ key: 'gone-rejected', status: 'rejected' }),
      ],
      [fresh('same'), fresh('pending-changed', 3), fresh('accepted-changed', 4), fresh('rejected'), fresh('brand-new')],
    );
    expect(plan.added.map((s) => s.key)).toEqual(['brand-new']);
    expect(plan.updated.map((u) => u.recommendation.key)).toEqual(['pending-changed']);
    expect(plan.quantityChanged.map((u) => [u.recommendation.key, u.next.quantity])).toEqual([['accepted-changed', 4]]);
    expect(plan.stillRejected.map((r) => r.key)).toEqual(['rejected']);
    expect(plan.noLongerRelevant.map((r) => r.key)).toEqual(['gone', 'gone-accepted']);
  });
});

describe('recommendation decisions (repository)', () => {
  async function setup() {
    const repos = await setupRepositories();
    const charger = await repos.inventory.createItem(
      itemInput({ name: 'Phone charger', quantity: 2, categoryId: (await repos.inventory.listCategories()).find((c) => c.systemKey === 'electronics')?.id ?? null }),
    );
    const trip = await repos.trips.create(
      tripInput({ startDate: '2026-12-20', endDate: '2026-12-23', transportMode: 'train', category: 'leisure', destinations: [{ name: 'Jaipur' }] }),
      { sections: [] },
    );
    return { ...repos, charger, trip };
  }

  it('stores first suggestions as pending without creating entries or reservations', async () => {
    const { db, recommendations, packing, inventory, charger, trip } = await setup();
    const { firstRun } = await recommendations.preview(trip.id);
    expect(firstRun).toBe(true);
    await recommendations.apply(trip.id);
    const recs = await recommendations.list(trip.id);
    expect(recs.length).toBeGreaterThan(20);
    expect(recs.every((r) => r.status === 'pending')).toBe(true);
    expect((await packing.load(trip.id)).entries).toEqual([]);
    expect((await inventory.getItem(charger.id))?.usage.reservedQuantity).toBe(0);
    expect(recs.find((r) => r.key.startsWith('electronics.phone_charger:'))?.inventoryItemId).toBe(charger.id);
    db.close();
  });

  it('accepting creates packing entries; rejecting records the decision; restore undoes it', async () => {
    const { db, recommendations, packing, trip } = await setup();
    await recommendations.apply(trip.id);
    const recs = await recommendations.list(trip.id);
    const chargerRec = recs.find((r) => r.key.startsWith('electronics.phone_charger:'));
    const towelOrTops = recs.find((r) => r.key.startsWith('clothing.tops:'));
    const sunglasses = recs.find((r) => r.key === 'documents.tickets');
    if (!chargerRec || !towelOrTops || !sunglasses) throw new Error('expected suggestions');

    expect(await recommendations.accept([chargerRec.id, towelOrTops.id])).toBe(2);
    const { entries } = await packing.load(trip.id);
    expect(entries.map((e) => [e.name, e.source, e.quantity])).toEqual([
      ['Phone charger', 'recommendation', 1],
      ['T-shirts or tops', 'recommendation', towelOrTops.quantity],
    ]);
    expect(entries[0]?.inventoryItemId).toBe(chargerRec.inventoryItemId);
    expect(entries[1]?.travellerId).toBe(towelOrTops.travellerId);

    await recommendations.reject(sunglasses.id);
    expect((await recommendations.list(trip.id)).find((r) => r.id === sunglasses.id)?.status).toBe('rejected');
    await recommendations.restore(sunglasses.id);
    expect((await recommendations.list(trip.id)).find((r) => r.id === sunglasses.id)?.status).toBe('pending');
    db.close();
  });

  it('regenerating preserves manual changes, packed state and rejections', async () => {
    const { db, recommendations, packing, trips, trip } = await setup();
    await recommendations.apply(trip.id);
    let recs = await recommendations.list(trip.id);
    const tops = recs.find((r) => r.key.startsWith('clothing.tops:'));
    const tickets = recs.find((r) => r.key === 'documents.tickets');
    if (!tops || !tickets) throw new Error('expected suggestions');
    await recommendations.accept([tops.id]);
    await recommendations.reject(tickets.id);
    const entry = (await packing.load(trip.id)).entries[0];
    await packing.updateEntry(entry?.id ?? '', { quantity: 2, isPacked: true });
    const manual = await packing.addEntry(trip.id, { name: 'Lucky scarf', quantity: 1 });

    // Change the trip: longer, by car, with trekking — so suggestions change.
    await trips.update(trip.id, {
      ...tripInput({ startDate: '2026-12-20', endDate: '2026-12-27', transportMode: 'car', category: 'leisure', destinations: [{ name: 'Jaipur' }] }),
      travellers: trip.travellers.map(({ id, name, kind }) => ({ id, name, kind })),
    });
    await packing.updateProfile(trip.id, { activities: ['trekking'] });
    recs = await recommendations.list(trip.id);

    const { plan } = await recommendations.preview(trip.id);
    expect(plan.added.map((s) => s.key)).toEqual(expect.arrayContaining(['documents.licence', 'footwear.trekking:' + trip.travellers[0]?.id]));
    expect(plan.noLongerRelevant.map((r) => r.key)).not.toContain('documents.tickets'); // rejected stays out of it
    expect(plan.quantityChanged.map((c) => c.recommendation.id)).toContain(tops.id);

    // Nothing changes until the user applies.
    expect(await recommendations.list(trip.id)).toEqual(recs);
    await recommendations.apply(trip.id);
    recs = await recommendations.list(trip.id);

    expect(recs.find((r) => r.id === tickets.id)?.status).toBe('rejected');
    expect(recs.find((r) => r.id === tops.id)).toMatchObject({ status: 'accepted', quantity: 8 });
    const entries = (await packing.load(trip.id)).entries;
    expect(entries.find((e) => e.id === entry?.id)).toMatchObject({ quantity: 2, isPacked: true });
    expect(entries.find((e) => e.id === manual.id)).toMatchObject({ name: 'Lucky scarf' });
    expect(recs.find((r) => r.key === 'documents.licence')?.status).toBe('pending');
    db.close();
  });

  it('marks suggestions that no longer apply as stale and revives them if they return', async () => {
    const { db, recommendations, packing, trip } = await setup();
    await packing.updateProfile(trip.id, { activities: ['photography'] });
    await recommendations.apply(trip.id);
    const camera = (await recommendations.list(trip.id)).find((r) => r.key === 'photography.camera');
    await recommendations.accept([camera?.id ?? '']);

    await packing.updateProfile(trip.id, { activities: [] });
    await recommendations.apply(trip.id);
    const stale = (await recommendations.list(trip.id)).filter((r) => r.status === 'stale').map((r) => r.key);
    expect(stale).toEqual(expect.arrayContaining(['photography.camera', 'photography.cards']));
    expect((await packing.load(trip.id)).entries.some((e) => e.name === 'Camera')).toBe(true);

    await packing.updateProfile(trip.id, { activities: ['photography'] });
    await recommendations.apply(trip.id);
    const after = await recommendations.list(trip.id);
    expect(after.find((r) => r.key === 'photography.camera')?.status).toBe('accepted');
    expect(after.find((r) => r.key === 'photography.cards')?.status).toBe('pending');
    db.close();
  });

  it('removing an accepted suggestion from the list records it as rejected', async () => {
    const { db, recommendations, packing, trip } = await setup();
    await recommendations.apply(trip.id);
    const rec = (await recommendations.list(trip.id))[0];
    await recommendations.accept([rec?.id ?? '']);
    const entry = (await packing.load(trip.id)).entries[0];
    await packing.removeEntry(entry?.id ?? '');
    expect((await recommendations.list(trip.id))[0]).toMatchObject({ status: 'rejected', packingEntryId: null });
    await recommendations.apply(trip.id);
    expect((await recommendations.list(trip.id))[0]?.status).toBe('rejected');
    db.close();
  });

  it('accepting a suggestion for an item already on the list links it instead of duplicating', async () => {
    const { db, recommendations, packing, charger, trip } = await setup();
    const asha = trip.travellers[0];
    const manual = await packing.addEntry(trip.id, { inventoryItemId: charger.id, name: '', quantity: 3, travellerId: asha?.id });
    await recommendations.apply(trip.id);
    const rec = (await recommendations.list(trip.id)).find((r) => r.key === `electronics.phone_charger:${asha?.id}`);
    expect(rec?.inventoryItemId).toBe(charger.id);
    expect(await recommendations.accept([rec?.id ?? ''])).toBe(1);

    const entries = (await packing.load(trip.id)).entries;
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ id: manual.id, quantity: 3 }); // the user's quantity is kept
    expect((await recommendations.list(trip.id)).find((r) => r.id === rec?.id)).toMatchObject({
      status: 'accepted',
      packingEntryId: manual.id,
    });
    db.close();
  });

  it('accepting a suggestion whose matched item is damaged adds a one-time entry', async () => {
    const { db, recommendations, packing, inventory, charger, trip } = await setup();
    await inventory.setAvailability(charger.id, 'damaged');
    await recommendations.apply(trip.id);
    const rec = (await recommendations.list(trip.id)).find((r) => r.key.startsWith('electronics.phone_charger:'));
    expect(rec?.inventoryItemId).toBe(charger.id); // still pointed out to the user
    await recommendations.accept([rec?.id ?? '']);
    const entry = (await packing.load(trip.id)).entries[0];
    expect(entry).toMatchObject({ name: 'Phone charger', inventoryItemId: null });
    await packing.confirm(trip.id);
    expect((await inventory.getItem(charger.id))?.usage.reservedQuantity).toBe(0);
    db.close();
  });

  it('accepting on a confirmed list reserves inventory and refuses to over-book', async () => {
    const { db, recommendations, packing, inventory, charger, trip } = await setup();
    await recommendations.apply(trip.id);
    await packing.confirm(trip.id);
    const chargers = (await recommendations.list(trip.id)).filter((r) => r.key.startsWith('electronics.phone_charger:'));
    await recommendations.accept(chargers.map((r) => r.id));
    expect((await inventory.getItem(charger.id))?.usage.reservedQuantity).toBe(2);
    await inventory.updateItem(charger.id, itemInput({ name: 'Phone charger', quantity: 2 }));
    await expect(packing.addEntry(trip.id, { inventoryItemId: charger.id, name: '', quantity: 1 })).rejects.toThrow(/3 needed, only 2 free/);
    db.close();
  });
});
