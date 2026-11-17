import { itemInput, setupRepositories, tripInput } from '../../../../test/fixtures';
import { emptyTaskDraft } from '../model';
import { createSectionExtrasRepository, splitTemplatePlan } from '../sectionExtrasRepository';
import { placeGroup, placeTask, type SectionLayout } from '../sectionLayout';

async function setup() {
  const repos = await setupRepositories();
  const extras = createSectionExtrasRepository(repos.database, { createId: repos.deps.createId, checklists: repos.checklists });
  const trip = await repos.trips.create(tripInput({ name: 'Goa' }), { sections: [] });
  const owner = { type: 'trip' as const, id: trip.id };
  const sectionId = await extras.createSection(owner, { title: 'Gear', holdsItems: true });
  const add = (title: string) => repos.checklists.addTask(sectionId, { ...emptyTaskDraft('recommended'), title });
  return { ...repos, extras, trip, owner, sectionId, add };
}

const order = async (ctx: Awaited<ReturnType<typeof setup>>) => {
  const { tasks } = await ctx.checklists.load(ctx.owner);
  const links = await ctx.extras.links(ctx.sectionId);
  return tasks
    .filter((t) => t.sectionId === ctx.sectionId)
    .sort((a, b) => a.position - b.position)
    .map((t) => `${t.title}@${links[t.id]?.groupId ?? '-'}`);
};

describe('section layout helpers', () => {
  const base: SectionLayout = {
    groupIds: ['g1', 'g2'],
    tasks: [
      { id: 'a', groupId: 'g1' },
      { id: 'b', groupId: 'g1' },
      { id: 'c', groupId: null },
      { id: 'd', groupId: 'g2' },
    ],
  };
  it('moves a task within its group', () => {
    expect(placeTask(base, 'b', 'g1', 0).tasks.filter((t) => t.groupId === 'g1').map((t) => t.id)).toEqual(['b', 'a']);
  });
  it('moves a task into another group and out of any group', () => {
    const into = placeTask(base, 'c', 'g2', 0);
    expect(into.tasks.filter((t) => t.groupId === 'g2').map((t) => t.id)).toEqual(['c', 'd']);
    const out = placeTask(base, 'a', null, 5);
    expect(out.tasks.filter((t) => t.groupId === null).map((t) => t.id)).toEqual(['c', 'a']);
    expect(out.tasks).toHaveLength(4);
  });
  it('moves a task into an empty group', () => {
    const empty = { ...base, groupIds: ['g1', 'g2', 'g3'] };
    expect(placeTask(empty, 'a', 'g3', 0).tasks.find((t) => t.id === 'a')).toEqual({ id: 'a', groupId: 'g3' });
  });
  it('reorders groups', () => {
    expect(placeGroup(base, 'g2', 0).groupIds).toEqual(['g2', 'g1']);
    expect(placeGroup(base, 'g1', 9).groupIds).toEqual(['g2', 'g1']);
  });
});

describe('arranging a section (drag-and-drop and Move up / down)', () => {
  it('saves group order, task order and group membership together', async () => {
    const ctx = await setup();
    const tops = await ctx.extras.addGroup(ctx.sectionId, 'Tops');
    const shoes = await ctx.extras.addGroup(ctx.sectionId, 'Shoes');
    const a = await ctx.add('Tee');
    const b = await ctx.add('Boots');
    const c = await ctx.add('Hat');
    await ctx.extras.arrangeSection(ctx.sectionId, { groupIds: [shoes.id, tops.id], tasks: [{ id: b.id, groupId: shoes.id }, { id: a.id, groupId: tops.id }, { id: c.id, groupId: null }] });
    expect(await order(ctx)).toEqual([`Boots@${shoes.id}`, `Tee@${tops.id}`, 'Hat@-']);
    expect((await ctx.extras.groups(ctx.sectionId)).map((g) => g.title)).toEqual(['Shoes', 'Tops']);
    // Back out of a group.
    await ctx.extras.arrangeSection(ctx.sectionId, { groupIds: [shoes.id, tops.id], tasks: [{ id: a.id, groupId: tops.id }, { id: b.id, groupId: null }, { id: c.id, groupId: null }] });
    expect(await order(ctx)).toEqual([`Tee@${tops.id}`, 'Boots@-', 'Hat@-']);
  });

  it('refuses a stale arrangement and a group from another section, changing nothing', async () => {
    const ctx = await setup();
    const a = await ctx.add('Tee');
    const b = await ctx.add('Boots');
    const before = await order(ctx);
    await expect(ctx.extras.arrangeSection(ctx.sectionId, { groupIds: [], tasks: [{ id: a.id, groupId: null }] })).rejects.toThrow(/changed/);
    await expect(ctx.extras.arrangeSection(ctx.sectionId, { groupIds: [], tasks: [{ id: a.id, groupId: null }, { id: a.id, groupId: null }] })).rejects.toThrow(/changed/);
    const other = await ctx.extras.createSection(ctx.owner, { title: 'Other' });
    const foreign = await ctx.extras.addGroup(other, 'Foreign');
    await expect(ctx.extras.arrangeSection(ctx.sectionId, { groupIds: [], tasks: [{ id: a.id, groupId: foreign.id }, { id: b.id, groupId: null }] })).rejects.toThrow();
    expect(await order(ctx)).toEqual(before);
  });
});

describe('task editor: Inventory link', () => {
  it('links, re-links and unlinks without touching the Inventory item', async () => {
    const ctx = await setup();
    const tee = await ctx.inventory.createItem(itemInput({ name: 'Blue tee', quantity: 3 }));
    const task = await ctx.add('Shirt');
    await ctx.extras.setInventoryLink(task.id, tee.id);
    expect((await ctx.extras.taskLink(task.id))?.inventoryItemName).toBe('Blue tee');
    await ctx.extras.setQuantity(task.id, 2);
    await ctx.extras.setInventoryLink(task.id, null);
    expect(await ctx.extras.taskLink(task.id)).toMatchObject({ inventoryItemId: null, quantity: 2 });
    expect(await ctx.inventory.getItem(tee.id)).toMatchObject({ name: 'Blue tee', quantity: 3 });
  });

  it('refuses a duplicate link in the same section and sections that hold no items', async () => {
    const ctx = await setup();
    const tee = await ctx.inventory.createItem(itemInput({ name: 'Blue tee' }));
    const one = await ctx.add('Shirt');
    const two = await ctx.add('Another shirt');
    await ctx.extras.setInventoryLink(one.id, tee.id);
    await expect(ctx.extras.setInventoryLink(two.id, tee.id)).rejects.toThrow(/already/);
    const docs = await ctx.extras.createSection(ctx.owner, { title: 'Bookings', holdsItems: false });
    const booking = await ctx.checklists.addTask(docs, { ...emptyTaskDraft('recommended'), title: 'Hotel' });
    await expect(ctx.extras.setInventoryLink(booking.id, tee.id)).rejects.toThrow(/does not hold/);
  });
});

describe('templates: packing sections become packing items', () => {
  it('splits packing and clothing sections out of a template plan', () => {
    const { checklist, packing } = splitTemplatePlan({
      sections: [
        { title: 'Packing', kind: 'packing', tasks: [{ title: 'Charger', priority: 'essential' }] },
        { title: 'Clothing', kind: 'custom', tasks: [{ title: 'Rain jacket', priority: 'recommended', notes: 'the blue one' }] },
        { title: 'Documents', kind: 'documents', tasks: [{ title: 'Passport', priority: 'essential' }] },
      ],
    });
    expect(checklist.sections.map((s) => s.title)).toEqual(['Documents']);
    expect(packing).toEqual([
      { title: 'Charger', priority: 'essential', description: undefined, notes: undefined, clothing: false },
      { title: 'Rain jacket', priority: 'recommended', description: undefined, notes: 'the blue one', clothing: true },
    ]);
  });

  it('adds them to Packing with priority and category, never twice', async () => {
    const ctx = await setup();
    const items = [
      { title: 'Charger', priority: 'essential' as const, clothing: false },
      { title: 'Rain jacket', priority: 'optional' as const, notes: 'blue', clothing: true },
    ];
    expect(await ctx.unifiedPacking.addTemplateItems(ctx.trip.id, items)).toEqual({ added: 2, skipped: 0 });
    expect(await ctx.unifiedPacking.addTemplateItems(ctx.trip.id, [{ ...items[0]!, title: ' charger ' }])).toEqual({ added: 0, skipped: 1 });
    const { entries } = await ctx.packing.load(ctx.trip.id);
    expect(entries.map((e) => e.name).sort()).toEqual(['Charger', 'Rain jacket']);
    const cats = await ctx.inventory.listCategories();
    const jacket = entries.find((e) => e.name === 'Rain jacket')!;
    expect(cats.find((c) => c.id === jacket.categoryId)?.systemKey).toBe('clothing');
    expect(jacket.notes).toBe('blue');
    const priorities = await ctx.unifiedPacking.priorities(ctx.trip.id);
    expect(priorities[jacket.id]).toBe('optional');
    // No checklist tasks were created.
    expect((await ctx.checklists.load(ctx.owner)).tasks).toHaveLength(0);
  });
});
