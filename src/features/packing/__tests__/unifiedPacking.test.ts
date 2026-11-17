import { itemInput, setupRepositories, tripInput } from '../../../../test/fixtures';
import { createClothingRepository } from '../../clothing/clothingRepository';
import { createSectionExtrasRepository } from '../../preparation/sectionExtrasRepository';
import { buildStarterChecklist } from '../../preparation/starter';
import { emptyTaskDraft } from '../../preparation/model';
import { preparationProgress } from '../../preparation/readiness';

async function setup() {
  const repos = await setupRepositories();
  const trip = await repos.trips.create(tripInput({ name: 'Munnar' }), { sections: [] });
  const owner = { type: 'trip' as const, id: trip.id };
  const categories = await repos.inventory.listCategories();
  const byKey = (k: string) => categories.find((c) => c.systemKey === k && !c.parentId)!;
  const extras = createSectionExtrasRepository(repos.database, { createId: repos.deps.createId, checklists: repos.checklists });
  const clothingRepo = createClothingRepository(repos.database, { createId: repos.deps.createId, now: () => repos.deps.now().toISOString() });
  return { ...repos, trip, owner, byKey, categories, extras, clothingRepo };
}
type Ctx = Awaited<ReturnType<typeof setup>>;

const count = async (ctx: Ctx, sql: string, params: (string | number)[] = []) => (await ctx.database.getFirstAsync<{ n: number }>(sql, params))?.n ?? 0;

describe('packing items: priority', () => {
  it('sets and clears a priority, kept on this device per item', async () => {
    const ctx = await setup();
    const e = await ctx.packing.addEntry(ctx.trip.id, { name: 'Rain jacket', categoryId: ctx.byKey('clothing').id });
    await ctx.unifiedPacking.setPriority(e.id, 'essential');
    expect(await ctx.unifiedPacking.priorities(ctx.trip.id)).toEqual({ [e.id]: 'essential' });
    await ctx.unifiedPacking.setPriority(e.id, null);
    expect(await ctx.unifiedPacking.priorities(ctx.trip.id)).toEqual({});
    await expect(ctx.unifiedPacking.setPriority('missing', 'optional')).rejects.toThrow(/no longer/);
  });
});

describe('Clothing organiser → Clothing groups', () => {
  it('moves organised clothing into groups of the same name, once, without touching the organiser', async () => {
    const ctx = await setup();
    const clothing = ctx.byKey('clothing');
    await ctx.clothingRepo.ensureStarter(ctx.trip.id);
    const organiser = await ctx.clothingRepo.categories(ctx.trip.id);
    const tees = organiser.find((c) => c.name === 'T-shirts')!;
    const pants = organiser.find((c) => c.name === 'Pants')!;
    const a = await ctx.packing.addEntry(ctx.trip.id, { name: 'Blue tee', categoryId: clothing.id, quantity: 3 });
    const b = await ctx.packing.addEntry(ctx.trip.id, { name: 'Chinos', categoryId: clothing.id });
    const c = await ctx.packing.addEntry(ctx.trip.id, { name: 'Socks', categoryId: clothing.id });
    await ctx.clothingRepo.link(ctx.trip.id, a.id, tees.id);
    await ctx.clothingRepo.link(ctx.trip.id, b.id, pants.id);

    expect(await ctx.unifiedPacking.adoptClothingGroups(ctx.trip.id)).toBe(2);
    const entries = await ctx.packing.load(ctx.trip.id).then((o) => o.entries);
    const group = (id: string) => ctx.database.getFirstAsync<{ name: string; parent_id: string }>('SELECT c.name, c.parent_id FROM packing_entries e JOIN inventory_categories c ON c.id = e.category_id WHERE e.id = ?', [id]);
    expect(await group(a.id)).toEqual({ name: 'T-shirts', parent_id: clothing.id });
    expect(await group(b.id)).toEqual({ name: 'Pants', parent_id: clothing.id });
    expect(entries.find((e) => e.id === c.id)?.categoryId).toBe(clothing.id);
    expect(entries.find((e) => e.id === a.id)?.quantity).toBe(3);

    // Repeating changes nothing and creates no duplicate groups; the organiser's records are kept.
    const groupsBefore = await count(ctx, 'SELECT COUNT(*) AS n FROM inventory_categories WHERE parent_id = ?', [clothing.id]);
    expect(await ctx.unifiedPacking.adoptClothingGroups(ctx.trip.id)).toBe(0);
    expect(await count(ctx, 'SELECT COUNT(*) AS n FROM inventory_categories WHERE parent_id = ?', [clothing.id])).toBe(groupsBefore);
    expect(await count(ctx, 'SELECT COUNT(*) AS n FROM clothing_items WHERE trip_id = ?', [ctx.trip.id])).toBe(2);
  });

  it('reuses an existing group with the same name', async () => {
    const ctx = await setup();
    const clothing = ctx.byKey('clothing');
    const existing = ctx.categories.find((x) => x.parentId === clothing.id && x.name === 'Tops')!;
    const mine = await ctx.clothingRepo.addCategory(ctx.trip.id, { name: 'tops', icon: 'hanger' });
    const e = await ctx.packing.addEntry(ctx.trip.id, { name: 'Linen shirt', categoryId: clothing.id });
    await ctx.clothingRepo.link(ctx.trip.id, e.id, mine.id);
    await ctx.unifiedPacking.adoptClothingGroups(ctx.trip.id);
    expect((await ctx.packing.load(ctx.trip.id).then((o) => o.entries))[0]?.categoryId).toBe(existing.id);
  });
});

describe('deleting categories and groups never loses items', () => {
  it('a group: its items move to another group or back to the category', async () => {
    const ctx = await setup();
    const clothing = ctx.byKey('clothing');
    const group = await ctx.inventory.createCategory({ name: 'Swimwear', parentId: clothing.id, icon: 'hanger', color: '#B8F36B', description: '', coverImageUri: null });
    const tops = ctx.categories.find((x) => x.parentId === clothing.id && x.name === 'Tops')!;
    const a = await ctx.packing.addEntry(ctx.trip.id, { name: 'Trunks', categoryId: group.id });
    const owned = await ctx.inventory.createItem(itemInput({ name: 'Goggles', categoryId: clothing.id, subcategoryId: group.id }));
    await ctx.unifiedPacking.deleteCategoryMoving(group.id, tops.id);
    expect((await ctx.packing.load(ctx.trip.id).then((o) => o.entries)).find((e) => e.id === a.id)?.categoryId).toBe(tops.id);
    expect((await ctx.inventory.getItem(owned.id))?.subcategoryId).toBe(tops.id);

    const other = await ctx.inventory.createCategory({ name: 'Rainwear', parentId: clothing.id, icon: 'hanger', color: '#B8F36B', description: '', coverImageUri: null });
    const b = await ctx.packing.addEntry(ctx.trip.id, { name: 'Poncho', categoryId: other.id });
    await ctx.unifiedPacking.deleteCategoryMoving(other.id, null);
    expect((await ctx.packing.load(ctx.trip.id).then((o) => o.entries)).find((e) => e.id === b.id)?.categoryId).toBe(clothing.id);
    expect(await ctx.packing.load(ctx.trip.id).then((o) => o.entries)).toHaveLength(2);
  });

  it('a custom category: items (and its groups’ items) move to the chosen category; starters are protected', async () => {
    const ctx = await setup();
    const custom = await ctx.inventory.createCategory({ name: 'Kite gear', parentId: null, icon: 'shape-outline', color: '#9DCBE5', description: '', coverImageUri: null });
    const sub = await ctx.inventory.createCategory({ name: 'Lines', parentId: custom.id, icon: 'shape-outline', color: '#9DCBE5', description: '', coverImageUri: null });
    const a = await ctx.packing.addEntry(ctx.trip.id, { name: 'Kite', categoryId: custom.id });
    const b = await ctx.packing.addEntry(ctx.trip.id, { name: 'Spare line', categoryId: sub.id });
    const misc = ctx.byKey('misc');
    await expect(ctx.unifiedPacking.deleteCategoryMoving(custom.id, null)).rejects.toThrow(/another category/);
    await ctx.unifiedPacking.deleteCategoryMoving(custom.id, misc.id);
    const entries = await ctx.packing.load(ctx.trip.id).then((o) => o.entries);
    expect(entries.map((e) => [e.id, e.categoryId]).sort()).toEqual([[a.id, misc.id], [b.id, misc.id]].sort());
    await expect(ctx.unifiedPacking.deleteCategoryMoving(ctx.byKey('clothing').id, misc.id)).rejects.toThrow(/Starter/);
  });
});

describe('old Packing checklist tasks', () => {
  async function withOldTasks() {
    const ctx = await setup();
    const packingSection = await ctx.checklists.addSection(ctx.owner, 'Packing', 'packing');
    const docs = await ctx.checklists.addSection(ctx.owner, 'Documents', 'documents');
    const charger = await ctx.checklists.addTask(packingSection.id, { ...emptyTaskDraft('essential'), title: 'Phone charger', description: 'USB-C', notes: 'Pack in daypack' });
    const meds = await ctx.checklists.addTask(packingSection.id, { ...emptyTaskDraft('recommended'), title: 'First-aid kit' });
    const id = await ctx.checklists.addTask(docs.id, { ...emptyTaskDraft('essential'), title: 'ID card' });
    const boots = await ctx.inventory.createItem(itemInput({ name: 'Hiking boots', categoryId: ctx.byKey('footwear').id, quantity: 1 }));
    await ctx.extras.addFromInventory(packingSection.id, null, [{ itemId: boots.id, quantity: 2 }]);
    const clothing = await ctx.checklists.addSection(ctx.owner, 'Clothing');
    const shirt = await ctx.checklists.addTask(clothing.id, { ...emptyTaskDraft('optional'), title: 'Linen shirt' });
    await ctx.checklists.setTaskDone(shirt.id, true);
    return { ...ctx, packingSection, docs, charger, meds, id, boots, clothing, shirt };
  }

  it('lists the unresolved tasks of the old Packing and Clothing sections only', async () => {
    const ctx = await withOldTasks();
    const tasks = await ctx.unifiedPacking.oldChecklistTasks(ctx.trip.id);
    expect(tasks.map((t) => t.title)).toEqual(['Phone charger', 'First-aid kit', 'Hiking boots', 'Linen shirt']);
    expect(tasks.find((t) => t.title === 'Hiking boots')).toMatchObject({ inventoryItemId: ctx.boots.id, quantity: 2 });
  });

  it('“Move to packing list”: creates the item first (quantity, priority, notes, link, done state), then removes the task — once', async () => {
    const ctx = await withOldTasks();
    const bootsTask = (await ctx.unifiedPacking.oldChecklistTasks(ctx.trip.id)).find((t) => t.title === 'Hiking boots')!;
    const { entryId } = await ctx.unifiedPacking.convertTask(ctx.trip.id, bootsTask.taskId);
    const entry = (await ctx.packing.load(ctx.trip.id).then((o) => o.entries)).find((e) => e.id === entryId)!;
    expect(entry).toMatchObject({ name: 'Hiking boots', quantity: 2, inventoryItemId: ctx.boots.id, categoryId: ctx.byKey('footwear').id, isPacked: false });
    expect(await ctx.unifiedPacking.priorities(ctx.trip.id)).toMatchObject({ [entryId]: 'recommended' });
    expect((await ctx.checklists.load(ctx.owner)).tasks.some((t) => t.id === bootsTask.taskId)).toBe(false);
    expect(await ctx.inventory.getItem(ctx.boots.id)).toBeTruthy();
    // No second conversion.
    expect((await ctx.unifiedPacking.convertTask(ctx.trip.id, bootsTask.taskId)).entryId).toBe(entryId);
    expect((await ctx.packing.load(ctx.trip.id).then((o) => o.entries)).filter((e) => e.name === 'Hiking boots')).toHaveLength(1);

    const { entryId: chargerEntry } = await ctx.unifiedPacking.convertTask(ctx.trip.id, ctx.charger.id);
    expect((await ctx.packing.load(ctx.trip.id).then((o) => o.entries)).find((e) => e.id === chargerEntry)).toMatchObject({ categoryId: ctx.byKey('misc').id, notes: 'USB-C\nPack in daypack' });
    expect(await ctx.unifiedPacking.priorities(ctx.trip.id)).toMatchObject({ [chargerEntry]: 'essential' });

    const { entryId: shirtEntry } = await ctx.unifiedPacking.convertTask(ctx.trip.id, ctx.shirt.id);
    expect((await ctx.packing.load(ctx.trip.id).then((o) => o.entries)).find((e) => e.id === shirtEntry)).toMatchObject({ categoryId: ctx.byKey('clothing').id, isPacked: true });
  });

  it('never removes the task when the packing item could not be created', async () => {
    const ctx = await withOldTasks();
    const failing = { ...ctx.packing, addEntry: async () => Promise.reject(new Error('disk full')) };
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createUnifiedPackingRepository } = require('../unifiedPackingRepository') as typeof import('../unifiedPackingRepository');
    const repo = createUnifiedPackingRepository(ctx.database, { packing: failing as typeof ctx.packing, checklists: ctx.checklists });
    await expect(repo.convertTask(ctx.trip.id, ctx.meds.id)).rejects.toThrow(/disk full/);
    expect((await ctx.checklists.load(ctx.owner)).tasks.some((t) => t.id === ctx.meds.id)).toBe(true);
    expect(await repo.decision(ctx.meds.id)).toBeNull();
  });

  it('“Keep in checklist” keeps the task and stops offering it; “Remove from trip” removes only the task', async () => {
    const ctx = await withOldTasks();
    await ctx.unifiedPacking.keepTask(ctx.trip.id, ctx.meds.id);
    expect((await ctx.unifiedPacking.oldChecklistTasks(ctx.trip.id)).some((t) => t.taskId === ctx.meds.id)).toBe(false);
    expect((await ctx.checklists.load(ctx.owner)).tasks.some((t) => t.id === ctx.meds.id)).toBe(true);
    await expect(ctx.unifiedPacking.convertTask(ctx.trip.id, ctx.meds.id)).rejects.toThrow(/already resolved/);

    const bootsTask = (await ctx.unifiedPacking.oldChecklistTasks(ctx.trip.id)).find((t) => t.title === 'Hiking boots')!;
    await ctx.unifiedPacking.removeTask(ctx.trip.id, bootsTask.taskId);
    expect((await ctx.checklists.load(ctx.owner)).tasks.some((t) => t.id === bootsTask.taskId)).toBe(false);
    expect(await ctx.inventory.getItem(ctx.boots.id)).toBeTruthy();
    expect(await ctx.packing.load(ctx.trip.id).then((o) => o.entries)).toEqual([]);
    // Other sections are never offered.
    expect((await ctx.unifiedPacking.oldChecklistTasks(ctx.trip.id)).some((t) => t.taskId === ctx.id.id)).toBe(false);
  });
});

describe('new trips and readiness', () => {
  it('new trips get no Packing checklist section (packing lives in Packing)', () => {
    const plan = buildStarterChecklist(tripInput({ transportMode: 'car' }));
    expect(plan.sections.map((s) => s.kind)).not.toContain('packing');
    expect(plan.sections.map((s) => s.kind)).toEqual(expect.arrayContaining(['documents', 'vehicle', 'tasks', 'shopping', 'home']));
  });

  it('combines checklist tasks and packing items, each counted once', () => {
    const tasks = [
      { priority: 'essential' as const, isDone: true },
      { priority: 'essential' as const, isDone: false },
    ];
    const entries = [{ isPacked: true }, { isPacked: false }, { isPacked: false }];
    expect(preparationProgress(tasks, entries)).toEqual({ percent: 40, done: 2, total: 5, essentialsOpen: 1, tasks: { done: 1, total: 2 }, packing: { done: 1, total: 3 } });
    expect(preparationProgress([], [])).toMatchObject({ percent: 0, done: 0, total: 0 });
  });
});
