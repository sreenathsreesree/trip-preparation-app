import { itemInput, setupRepositories, tripInput } from '../../../../test/fixtures';
import { openTestDatabase } from '../../../../test/nodeSqliteDatabase';
import { migrate } from '../../../db/migrate';
import { migrations } from '../../../db/migrations';
import { emptyTaskDraft } from '../model';
import { createSectionExtrasRepository, findClothingSection, isClothingSection, supportsInventory } from '../sectionExtrasRepository';

async function setup(db = openTestDatabase()) {
  const repos = await setupRepositories(db);
  const extras = createSectionExtrasRepository(repos.database, { createId: repos.deps.createId, checklists: repos.checklists });
  const trip = await repos.trips.create(tripInput({ name: 'Munnar' }), { sections: [] });
  const owner = { type: 'trip' as const, id: trip.id };
  const clothing = await repos.checklists.addSection(owner, 'Clothing');
  const tee = await repos.inventory.createItem(itemInput({ name: 'Blue tee', quantity: 4 }));
  const boots = await repos.inventory.createItem(itemInput({ name: 'Hiking boots', quantity: 1 }));
  const task = async (id: string) => (await repos.checklists.load(owner)).tasks.find((t) => t.id === id);
  return { ...repos, extras, trip, owner, clothing, tee, boots, task };
}

describe('Clothing behaves like an organised packing section', () => {
  it('Clothing offers Add from Inventory; paperwork, vehicle, errands and shopping do not', () => {
    expect(supportsInventory('custom', 'Clothing')).toBe(true);
    expect(supportsInventory('packing', 'Packing')).toBe(true);
    expect(supportsInventory('custom', 'Toiletries')).toBe(true);
    expect(supportsInventory('custom', 'Car essentials')).toBe(true);
    for (const title of ['Documents', 'Passport & visa', 'Vehicle checks', 'Errands', 'Shopping', 'Things to buy']) expect(supportsInventory('custom', title)).toBe(false);
    for (const kind of ['documents', 'vehicle', 'tasks', 'shopping', 'home'] as const) expect(supportsInventory(kind, 'Clothing')).toBe(false);
  });

  it('finds the trip’s Clothing section (one named “Clothing” first) and never confuses other sections', () => {
    const sections = [
      { id: 'p', kind: 'packing' as const, title: 'Packing', position: 0 },
      { id: 'w', kind: 'custom' as const, title: 'Rain wear', position: 1 },
      { id: 'c', kind: 'custom' as const, title: 'clothing', position: 2 },
    ];
    expect(findClothingSection(sections)?.id).toBe('c');
    expect(findClothingSection(sections.slice(0, 2))?.id).toBe('w');
    expect(findClothingSection([{ id: 'p', kind: 'packing' as const, title: 'Packing', position: 0 }])).toBeNull();
    expect(isClothingSection({ kind: 'custom', title: 'Outfits' })).toBe(true);
    expect(isClothingSection({ kind: 'documents', title: 'Clothing receipts' })).toBe(false);
  });

  it('creates, renames and orders user-named groups (no fixed list, no duplicates)', async () => {
    const { extras, clothing } = await setup();
    for (const name of ['Tops', 'Trousers', 'Footwear', 'Nightwear', 'Accessories', 'Innerwear']) await extras.addGroup(clothing.id, name);
    await extras.addGroup(clothing.id, 'Swimwear for the beach');
    await expect(extras.addGroup(clothing.id, 'FOOTWEAR')).rejects.toThrow(/already/);
    const groups = await extras.groups(clothing.id);
    await extras.renameGroup(groups[0]!.id, 'Shirts');
    await expect(extras.renameGroup(groups[1]!.id, 'shirts')).rejects.toThrow(/already/);
    expect((await extras.groups(clothing.id)).map((g) => g.title)).toEqual(['Shirts', 'Trousers', 'Footwear', 'Nightwear', 'Accessories', 'Innerwear', 'Swimwear for the beach']);
  });

  it('adds tasks into a group, moves them between groups and back to “no group”', async () => {
    const { extras, clothing, task } = await setup();
    const tops = await extras.addGroup(clothing.id, 'Tops');
    const night = await extras.addGroup(clothing.id, 'Nightwear');
    const t = await extras.addManual(clothing.id, tops.id, 'Linen shirt', 'essential');
    expect((await extras.links(clothing.id))[t.id]?.groupId).toBe(tops.id);
    await extras.setTaskGroup(t.id, night.id);
    expect((await extras.links(clothing.id))[t.id]?.groupId).toBe(night.id);
    await extras.setTaskGroup(t.id, null);
    expect((await extras.links(clothing.id))[t.id]?.groupId).toBeNull();
    expect(await task(t.id)).toMatchObject({ title: 'Linen shirt', priority: 'essential', isDone: false });
  });

  it('deleting a group asks where tasks go and keeps every detail (done state, priority, notes, quantity, Inventory link)', async () => {
    const { extras, clothing, checklists, owner, tee, task } = await setup();
    const tops = await extras.addGroup(clothing.id, 'Tops');
    const other = await extras.addGroup(clothing.id, 'Other');
    await extras.addFromInventory(clothing.id, tops.id, [{ itemId: tee.id, quantity: 3 }]);
    const shirt = await extras.addManual(clothing.id, tops.id, 'Linen shirt', 'essential');
    await checklists.updateTask(shirt.id, { ...emptyTaskDraft('essential'), title: 'Linen shirt', notes: 'Size M, iron first' });
    await checklists.setTaskDone(shirt.id, true);
    await extras.deleteGroup(tops.id, other.id);
    const links = await extras.links(clothing.id);
    expect(Object.values(links).every((l) => l.groupId === other.id)).toBe(true);
    await extras.deleteGroup(other.id, null);
    const after = await extras.links(clothing.id);
    expect(Object.values(after).find((l) => l.inventoryItemId === tee.id)).toEqual({ groupId: null, inventoryItemId: tee.id, quantity: 3 });
    expect(await task(shirt.id)).toMatchObject({ isDone: true, priority: 'essential', notes: 'Size M, iron first' });
    expect((await checklists.load(owner)).tasks).toHaveLength(2);
    await expect(extras.deleteGroup('missing', 'nowhere')).resolves.toBeUndefined();
  });

  it('links Inventory items (several at once, with quantities) without copying them, and refuses duplicates', async () => {
    const { extras, clothing, inventory, tee, boots } = await setup();
    const before = (await inventory.listItems()).length;
    expect(await extras.addFromInventory(clothing.id, null, [{ itemId: tee.id, quantity: 2 }, { itemId: boots.id }])).toEqual({ added: 2, skipped: 0 });
    expect(await extras.addFromInventory(clothing.id, null, [{ itemId: tee.id }, { itemId: boots.id }])).toEqual({ added: 0, skipped: 2 });
    expect((await inventory.listItems()).length).toBe(before);
    const links = Object.values(await extras.links(clothing.id));
    expect(links.map((l) => [l.inventoryItemId, l.quantity]).sort()).toEqual([[boots.id, 1], [tee.id, 2]].sort());
  });

  it('refuses Inventory items in sections where they don’t belong, and groups of other sections', async () => {
    const { extras, checklists, owner, clothing, tee } = await setup();
    const docs = await checklists.addSection(owner, 'Documents');
    await expect(extras.addFromInventory(docs.id, null, [{ itemId: tee.id }])).rejects.toThrow(/can’t be added/);
    const foreign = await extras.addGroup(docs.id, 'Copies');
    await expect(extras.addFromInventory(clothing.id, foreign.id, [{ itemId: tee.id }])).rejects.toThrow(/group of this section/);
  });

  it('editing, moving or deleting the task never changes or deletes the Inventory item; quantity and notes survive edits', async () => {
    const { extras, clothing, checklists, owner, inventory, tee } = await setup();
    const tops = await extras.addGroup(clothing.id, 'Tops');
    await extras.addFromInventory(clothing.id, tops.id, [{ itemId: tee.id, quantity: 2 }]);
    const [taskId] = Object.keys(await extras.links(clothing.id));
    await extras.setQuantity(taskId!, 3);
    await checklists.updateTask(taskId!, { ...emptyTaskDraft('essential'), title: 'Blue tee (x3)', notes: 'Two for hiking' });
    expect(await extras.taskLink(taskId!)).toEqual({ groupId: tops.id, inventoryItemId: tee.id, quantity: 3, inventoryItemName: 'Blue tee' });
    expect((await checklists.load(owner)).tasks.find((t) => t.id === taskId)).toMatchObject({ notes: 'Two for hiking', priority: 'essential' });

    // Moving to another section: the Inventory link travels, the old group does not.
    const packing = await checklists.addSection(owner, 'Packing', 'packing');
    await checklists.updateTask(taskId!, { ...emptyTaskDraft('essential'), title: 'Blue tee (x3)', notes: 'Two for hiking' }, { sectionId: packing.id });
    await extras.setTaskGroup(taskId!, null);
    expect((await extras.links(packing.id))[taskId!]).toEqual({ groupId: null, inventoryItemId: tee.id, quantity: 3 });

    await checklists.deleteTask(taskId!);
    expect((await inventory.listItems()).find((i) => i.id === tee.id)?.name).toBe('Blue tee');
    expect(await extras.taskLink(taskId!)).toBeNull();
  });

  it('warns before a move would list the same Inventory item twice in a section', async () => {
    const { extras, clothing, checklists, owner, tee } = await setup();
    const packing = await checklists.addSection(owner, 'Packing', 'packing');
    await extras.addFromInventory(clothing.id, null, [{ itemId: tee.id }]);
    await extras.addFromInventory(packing.id, null, [{ itemId: tee.id }]);
    const [inClothing] = Object.keys(await extras.links(clothing.id));
    expect(await extras.linkConflict(inClothing!, packing.id)).toBe('Blue tee');
    const manual = await extras.addManual(clothing.id, null, 'Socks', 'recommended');
    expect(await extras.linkConflict(manual.id, packing.id)).toBeNull();
  });

  it('every entry point reads the same section: one set of tasks and groups, no copies', async () => {
    const { extras, clothing, checklists, owner } = await setup();
    const tops = await extras.addGroup(clothing.id, 'Tops');
    await extras.addManual(clothing.id, tops.id, 'Linen shirt', 'recommended');
    // The dashboard's Clothing entry resolves to the section the Checklist tab lists.
    const listed = (await checklists.load(owner)).sections;
    expect(findClothingSection(listed)?.id).toBe(clothing.id);
    expect(listed.filter((s) => isClothingSection(s))).toHaveLength(1);
    const viaChecklist = await extras.links(clothing.id);
    const viaDashboard = await extras.links(findClothingSection(listed)!.id);
    expect(viaDashboard).toEqual(viaChecklist);
  });

  it('other sections keep only their own actions (groups yes, Inventory only where it belongs)', async () => {
    const { extras, checklists, owner } = await setup();
    for (const [title, kind] of [['Documents', 'documents'], ['Vehicle', 'vehicle'], ['Before you leave', 'home'], ['Shopping', 'shopping'], ['Tasks', 'tasks']] as const) {
      const s = await checklists.addSection(owner, title, kind);
      expect(supportsInventory(s.kind, s.title)).toBe(false);
      const g = await extras.addGroup(s.id, 'First');
      expect((await extras.groups(s.id)).map((x) => x.id)).toEqual([g.id]);
    }
  });

  it('accounts are isolated: another account’s database has none of this', async () => {
    const a = await setup(openTestDatabase());
    const b = await setup(openTestDatabase());
    await a.extras.addGroup(a.clothing.id, 'Tops');
    await a.extras.addFromInventory(a.clothing.id, null, [{ itemId: a.tee.id }]);
    expect(await b.extras.groups(a.clothing.id)).toEqual([]);
    expect(await b.extras.links(b.clothing.id)).toEqual({});
  });
});

describe('existing data', () => {
  it('no schema change: tasks, completion, groups and links written before this change still load', async () => {
    // The schema is unchanged by this work (still the latest migration); data in it is read as-is.
    const db = openTestDatabase();
    await migrate(db, migrations);
    const { extras, checklists, clothing, owner, tee } = await setup(db);
    const tops = await extras.addGroup(clothing.id, 'Tops');
    await extras.addFromInventory(clothing.id, tops.id, [{ itemId: tee.id, quantity: 2 }]);
    const manual = await extras.addManual(clothing.id, null, 'Socks', 'optional');
    await checklists.setTaskDone(manual.id, true);
    // Re-open with fresh repositories (as after an app update).
    const again = await setupRepositories(db);
    const extras2 = createSectionExtrasRepository(again.database, { createId: again.deps.createId, checklists: again.checklists });
    const tasks = (await again.checklists.load(owner)).tasks;
    expect(tasks.find((t) => t.id === manual.id)?.isDone).toBe(true);
    expect(Object.values(await extras2.links(clothing.id)).find((l) => l.inventoryItemId === tee.id)).toEqual({ groupId: tops.id, inventoryItemId: tee.id, quantity: 2 });
  });
});
