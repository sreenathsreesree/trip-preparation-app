import { itemInput, setupRepositories, tripInput } from '../../../../test/fixtures';
import { LOCAL_ONLY_TABLES, SYNC_TABLES } from '../../sync/tables';
import { emptyTaskDraft } from '../model';
import { createSectionExtrasRepository } from '../sectionExtrasRepository';

/** Every standard Checklist section kind (Packing lives in the Packing list). */
const KINDS = ['documents', 'vehicle', 'tasks', 'shopping', 'home', 'custom'] as const;

async function setup() {
  const repos = await setupRepositories();
  const extras = createSectionExtrasRepository(repos.database, { createId: repos.deps.createId, checklists: repos.checklists });
  const sections = KINDS.filter((k) => k !== 'custom').map((kind) => ({ kind, title: kind[0]!.toUpperCase() + kind.slice(1), tasks: [{ title: `Starter ${kind}`, priority: 'recommended' as const }] }));
  const trip = await repos.trips.create(tripInput({ name: 'Goa' }), { sections });
  const owner = { type: 'trip' as const, id: trip.id };
  const loaded = await repos.checklists.load(owner);
  const byKind = (kind: string) => loaded.sections.find((s) => s.kind === kind)!;
  return { ...repos, extras, trip, owner, byKind };
}

describe('groups in every Checklist section', () => {
  it.each(KINDS.filter((k) => k !== 'custom'))('%s: create, rename, reorder and delete groups', async (kind) => {
    const ctx = await setup();
    const section = ctx.byKind(kind);
    const a = await ctx.extras.addGroup(section.id, 'First');
    const b = await ctx.extras.addGroup(section.id, 'Second');
    await ctx.extras.renameGroup(a.id, 'Renamed');
    await ctx.extras.reorderGroups(section.id, [b.id, a.id]);
    expect((await ctx.extras.groups(section.id)).map((g) => g.title)).toEqual(['Second', 'Renamed']);
    await expect(ctx.extras.reorderGroups(section.id, [b.id])).rejects.toThrow(/changed/);
    await ctx.extras.deleteGroup(b.id, null);
    expect((await ctx.extras.groups(section.id)).map((g) => g.title)).toEqual(['Renamed']);
  });

  it('Documents: tasks inside and outside groups; deleting a group never deletes its tasks', async () => {
    const ctx = await setup();
    const docs = ctx.byKind('documents');
    const identity = await ctx.extras.addGroup(docs.id, 'Identity documents');
    const tickets = await ctx.extras.addGroup(docs.id, 'Tickets and bookings');
    const passport = await ctx.extras.addManual(docs.id, identity.id, 'Passport', 'essential');
    const loose = await ctx.extras.addManual(docs.id, null, 'Copy of insurance', 'optional');
    let links = await ctx.extras.links(docs.id);
    expect(links[passport.id]?.groupId).toBe(identity.id);
    expect(links[loose.id]?.groupId ?? null).toBeNull();
    const before = (await ctx.checklists.load(ctx.owner)).tasks.length;
    await ctx.extras.deleteGroup(identity.id, tickets.id);
    links = await ctx.extras.links(docs.id);
    expect(links[passport.id]?.groupId).toBe(tickets.id);
    await ctx.extras.deleteGroup(tickets.id, null);
    expect((await ctx.checklists.load(ctx.owner)).tasks.length).toBe(before);
    expect((await ctx.extras.links(docs.id))[passport.id]?.groupId).toBeNull();
  });

  it('moves tasks between groups, back to ungrouped and to another section, keeping every detail and never duplicating', async () => {
    const ctx = await setup();
    const shopping = ctx.byKind('shopping');
    const home = ctx.byKind('home');
    const g1 = await ctx.extras.addGroup(shopping.id, 'Pharmacy');
    const g2 = await ctx.extras.addGroup(shopping.id, 'Gear');
    const item = await ctx.inventory.createItem(itemInput({ name: 'First-aid kit', quantity: 2 }));
    const task = await ctx.checklists.addTask(shopping.id, { ...emptyTaskDraft('essential'), title: 'Restock kit', description: 'Plasters and gauze', notes: 'Check expiry' });
    await ctx.checklists.setTaskDone(task.id, true);
    await ctx.extras.saveSettings(shopping.id, { holdsItems: true });
    await ctx.extras.setInventoryLink(task.id, item.id);
    await ctx.extras.setQuantity(task.id, 2);

    await ctx.extras.setTaskGroup(task.id, g1.id);
    await ctx.extras.setTaskGroup(task.id, g2.id);
    await ctx.extras.setTaskGroup(task.id, null);
    const others = (await ctx.checklists.load(ctx.owner)).tasks.filter((t) => t.sectionId === shopping.id && t.id !== task.id).map((t) => ({ id: t.id, groupId: null }));
    await ctx.extras.arrangeSection(shopping.id, { groupIds: [g2.id, g1.id], tasks: [{ id: task.id, groupId: g1.id }, ...others] });
    expect((await ctx.extras.links(shopping.id))[task.id]).toEqual({ groupId: g1.id, inventoryItemId: item.id, quantity: 2 });

    const count = (await ctx.checklists.load(ctx.owner)).tasks.length;
    await ctx.checklists.updateTask(task.id, { title: 'Restock kit', description: 'Plasters and gauze', notes: 'Check expiry', priority: 'essential' }, { sectionId: home.id });
    await ctx.extras.setTaskGroup(task.id, null);
    const after = await ctx.checklists.load(ctx.owner);
    expect(after.tasks.length).toBe(count);
    expect(after.tasks.filter((t) => t.title === 'Restock kit')).toHaveLength(1);
    expect(after.tasks.find((t) => t.id === task.id)).toMatchObject({ sectionId: home.id, title: 'Restock kit', description: 'Plasters and gauze', notes: 'Check expiry', priority: 'essential', isDone: true });
    expect((await ctx.extras.links(home.id))[task.id]).toEqual({ groupId: null, inventoryItemId: item.id, quantity: 2 });
    expect(await ctx.inventory.getItem(item.id)).toMatchObject({ name: 'First-aid kit', quantity: 2 });
  });

  it('a group of one section cannot receive tasks of another', async () => {
    const ctx = await setup();
    const docs = ctx.byKind('documents');
    const vehicle = ctx.byKind('vehicle');
    const g = await ctx.extras.addGroup(vehicle.id, 'Maintenance');
    const task = await ctx.extras.addManual(docs.id, null, 'Licence', 'essential');
    await expect(ctx.extras.setTaskGroup(task.id, g.id)).rejects.toThrow(/same section/);
  });

  it('existing tasks stay visible and unchanged when groups are added later', async () => {
    const ctx = await setup();
    const tasksBefore = (await ctx.checklists.load(ctx.owner)).tasks.map((t) => [t.id, t.title, t.isDone, t.priority]);
    const docs = ctx.byKind('documents');
    await ctx.extras.addGroup(docs.id, 'Identity documents');
    expect((await ctx.checklists.load(ctx.owner)).tasks.map((t) => [t.id, t.title, t.isDone, t.priority])).toEqual(tasksBefore);
  });
});

describe('privacy: group organisation stays on the device', () => {
  it('groups, links and section settings are local-only and never in the sync set', () => {
    const synced = new Set(SYNC_TABLES.map((t) => t.name));
    for (const table of ['checklist_groups', 'checklist_task_links', 'checklist_section_settings']) {
      expect(LOCAL_ONLY_TABLES[table]).toBeDefined();
      expect(synced.has(table)).toBe(false);
    }
  });

  it('another account never sees these groups', async () => {
    const one = await setup();
    const docs = one.byKind('documents');
    await one.extras.addGroup(docs.id, 'Private');
    const two = await setupRepositories(undefined, undefined, 'other');
    const extras2 = createSectionExtrasRepository(two.database, { createId: two.deps.createId, checklists: two.checklists });
    expect(await extras2.groups(docs.id)).toEqual([]);
  });
});
