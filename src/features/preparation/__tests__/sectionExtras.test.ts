import { itemInput, setupRepositories, tripInput } from '../../../../test/fixtures';
import { createSectionExtrasRepository, supportsInventory } from '../sectionExtrasRepository';

async function setup() {
  const repos = await setupRepositories();
  const extras = createSectionExtrasRepository(repos.database, { createId: repos.deps.createId, checklists: repos.checklists });
  const trip = await repos.trips.create(tripInput({ name: 'Goa' }), { sections: [] });
  const owner = { type: 'trip' as const, id: trip.id };
  const clothing = await repos.checklists.addSection(owner, 'Clothing');
  return { ...repos, extras, trip, owner, clothing };
}

describe('checklist sections: groups and Inventory items', () => {
  it('offers Inventory only where it makes sense', () => {
    expect(supportsInventory('packing')).toBe(true);
    expect(supportsInventory('custom')).toBe(true);
    for (const kind of ['documents', 'vehicle', 'tasks', 'shopping', 'home'] as const) expect(supportsInventory(kind)).toBe(false);
  });

  it('creates, renames and validates groups inside a section', async () => {
    const { extras, clothing } = await setup();
    const tops = await extras.addGroup(clothing.id, 'Tops');
    await extras.addGroup(clothing.id, 'Footwear');
    await expect(extras.addGroup(clothing.id, ' tops ')).rejects.toThrow(/already/);
    await expect(extras.addGroup(clothing.id, '  ')).rejects.toThrow(/name/);
    await extras.renameGroup(tops.id, 'Shirts & tees');
    expect((await extras.groups(clothing.id)).map((g) => g.title)).toEqual(['Shirts & tees', 'Footwear']);
  });

  it('adds tasks manually into a group', async () => {
    const { extras, clothing, checklists, owner } = await setup();
    const tops = await extras.addGroup(clothing.id, 'Tops');
    const task = await extras.addManual(clothing.id, tops.id, 'Linen shirt', 'essential');
    expect((await checklists.load(owner)).tasks.find((t) => t.id === task.id)).toMatchObject({ title: 'Linen shirt', priority: 'essential' });
    expect((await extras.links(clothing.id))[task.id]).toEqual({ groupId: tops.id, inventoryItemId: null, quantity: 1 });
  });

  it('adds from Inventory, linked to the original record, never duplicating it or the task', async () => {
    const { extras, clothing, inventory } = await setup();
    const tee = await inventory.createItem(itemInput({ name: 'Blue tee', quantity: 4 }));
    const shoes = await inventory.createItem(itemInput({ name: 'Trail shoes', quantity: 1 }));
    const countBefore = (await inventory.listItems()).length;
    expect(await extras.addFromInventory(clothing.id, null, [{ itemId: tee.id, quantity: 2 }, { itemId: shoes.id }])).toEqual({ added: 2, skipped: 0 });
    expect(await extras.addFromInventory(clothing.id, null, [{ itemId: tee.id }])).toEqual({ added: 0, skipped: 1 });
    expect((await inventory.listItems()).length).toBe(countBefore);
    const links = Object.values(await extras.links(clothing.id));
    expect(links).toEqual(expect.arrayContaining([{ groupId: null, inventoryItemId: tee.id, quantity: 2 }, { groupId: null, inventoryItemId: shoes.id, quantity: 1 }]));
  });

  it('deleting a group keeps its tasks; deleting tasks or the section never deletes Inventory items', async () => {
    const { extras, clothing, checklists, owner, inventory } = await setup();
    const tops = await extras.addGroup(clothing.id, 'Tops');
    const other = await extras.addGroup(clothing.id, 'Other');
    const tee = await inventory.createItem(itemInput({ name: 'Blue tee' }));
    await extras.addFromInventory(clothing.id, tops.id, [{ itemId: tee.id }]);
    const manual = await extras.addManual(clothing.id, tops.id, 'Hat', 'optional');
    await extras.deleteGroup(tops.id, other.id);
    expect(Object.values(await extras.links(clothing.id)).every((l) => l.groupId === other.id)).toBe(true);
    await extras.deleteGroup(other.id, null);
    expect((await checklists.load(owner)).tasks.map((t) => t.title).sort()).toEqual(['Blue tee', 'Hat']);
    await checklists.deleteTask(manual.id);
    await checklists.deleteSection(clothing.id);
    expect((await inventory.getItem(tee.id))?.name).toBe('Blue tee');
  });

  it('keeps existing tasks, completion and priorities untouched', async () => {
    const { extras, clothing, checklists, owner } = await setup();
    const old = await checklists.addTask(clothing.id, { title: 'Old task', description: '', notes: 'keep me', priority: 'essential' });
    await checklists.setTaskDone(old.id, true);
    const g = await extras.addGroup(clothing.id, 'Misc');
    await extras.setTaskGroup(old.id, g.id);
    expect((await checklists.load(owner)).tasks.find((t) => t.id === old.id)).toMatchObject({ isDone: true, notes: 'keep me', priority: 'essential' });
  });
});
