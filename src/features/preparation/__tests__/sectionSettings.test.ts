import { itemInput, setupRepositories, tripInput } from '../../../../test/fixtures';
import { createSectionExtrasRepository, holdsItems } from '../sectionExtrasRepository';

async function setup() {
  const repos = await setupRepositories();
  const extras = createSectionExtrasRepository(repos.database, { createId: repos.deps.createId, checklists: repos.checklists });
  const trip = await repos.trips.create(tripInput({ name: 'Goa' }), { sections: [] });
  const owner = { type: 'trip' as const, id: trip.id };
  return { ...repos, extras, trip, owner };
}

describe('checklist section settings (phase 2)', () => {
  it('decides Inventory eligibility from settings first, then the section kind', () => {
    expect(holdsItems({ kind: 'documents', title: 'Documents' })).toBe(false);
    expect(holdsItems({ kind: 'documents', title: 'Documents' }, { holdsItems: true })).toBe(true);
    expect(holdsItems({ kind: 'custom', title: 'Camera kit' })).toBe(true);
    expect(holdsItems({ kind: 'custom', title: 'Camera kit' }, { holdsItems: false })).toBe(false);
    // Old Packing sections no longer offer Inventory: packing items live in Packing.
    expect(holdsItems({ kind: 'packing', title: 'Packing' })).toBe(false);
    expect(holdsItems({ kind: 'custom', title: 'Clothing' })).toBe(false);
  });

  it('creates a section with icon, description, item setting and starter tasks', async () => {
    const { extras, checklists, owner } = await setup();
    const id = await extras.createSection(owner, { title: '  Camera kit ', icon: 'camera-outline', description: ' Lenses and batteries ', holdsItems: true, starterTasks: ['Charge batteries', ' ', 'Clean lens'] });
    const loaded = await checklists.load(owner);
    expect(loaded.sections.find((s) => s.id === id)).toMatchObject({ title: 'Camera kit', kind: 'custom' });
    expect(loaded.tasks.filter((t) => t.sectionId === id).map((t) => t.title)).toEqual(['Charge batteries', 'Clean lens']);
    expect((await extras.settings([id]))[id]).toEqual({ icon: 'camera-outline', description: 'Lenses and batteries', holdsItems: true, inventoryCategoryId: null });
  });

  it('rejects empty and duplicate section names when creating or renaming', async () => {
    const { extras, owner } = await setup();
    const a = await extras.createSection(owner, { title: 'Documents' });
    const b = await extras.createSection(owner, { title: 'Errands' });
    await expect(extras.createSection(owner, { title: ' documents ' })).rejects.toThrow(/already/i);
    await expect(extras.createSection(owner, { title: '   ' })).rejects.toThrow();
    await expect(extras.renameSection(owner.id, b, 'DOCUMENTS')).rejects.toThrow(/already/i);
    await extras.renameSection(owner.id, a, 'Documents');
    await extras.renameSection(owner.id, b, 'Before leaving');
    expect((await extras.settings([a, b]))[a]).toBeDefined();
  });

  it('reorders sections and refuses a stale order', async () => {
    const { extras, checklists, owner } = await setup();
    const a = await extras.createSection(owner, { title: 'A' });
    const b = await extras.createSection(owner, { title: 'B' });
    const c = await extras.createSection(owner, { title: 'C' });
    await extras.reorderSections(owner.id, [c, a, b]);
    expect((await checklists.load(owner)).sections.map((s) => s.title)).toEqual(['C', 'A', 'B']);
    await expect(extras.reorderSections(owner.id, [a, b])).rejects.toThrow(/changed/);
  });

  it('saves settings without touching the section or its tasks', async () => {
    const { extras, checklists, owner } = await setup();
    const id = await extras.createSection(owner, { title: 'Errands', starterTasks: ['Post letter'] });
    await extras.saveSettings(id, { icon: 'star-outline', description: 'x'.repeat(300) });
    const s = (await extras.settings([id]))[id]!;
    expect(s.icon).toBe('star-outline');
    expect(s.description).toHaveLength(200);
    expect((await checklists.load(owner)).tasks.map((t) => t.title)).toEqual(['Post letter']);
  });

  it('turns an Inventory category into a section once, then lets its items be added', async () => {
    const { extras, inventory, owner, checklists } = await setup();
    const kit = await inventory.createCategory({ name: 'Kite gear', parentId: null, icon: 'shape-outline', color: '#9DCBE5', description: '', coverImageUri: null });
    const first = await extras.sectionForInventoryCategory(owner, kit.id);
    expect(first.created).toBe(true);
    expect(await extras.sectionForInventoryCategory(owner, kit.id)).toEqual({ sectionId: first.sectionId, created: false });
    expect((await extras.settings([first.sectionId]))[first.sectionId]).toMatchObject({ holdsItems: true, inventoryCategoryId: kit.id });
    const kite = await inventory.createItem(itemInput({ name: 'Kite', categoryId: kit.id }));
    expect(await extras.addFromInventory(first.sectionId, null, [{ itemId: kite.id }])).toEqual({ added: 1, skipped: 0 });
    expect((await checklists.load(owner)).sections.filter((s) => s.title === 'Kite gear')).toHaveLength(1);
  });

  it('links a category to an existing section of the same name instead of duplicating it', async () => {
    const { extras, inventory, owner } = await setup();
    const existing = await extras.createSection(owner, { title: 'kite GEAR' });
    const kit = await inventory.createCategory({ name: 'Kite gear', parentId: null, icon: 'shape-outline', color: '#9DCBE5', description: '', coverImageUri: null });
    expect(await extras.sectionForInventoryCategory(owner, kit.id)).toEqual({ sectionId: existing, created: false });
  });

  it('a section that does not hold items refuses Inventory items', async () => {
    const { extras, inventory, owner } = await setup();
    const id = await extras.createSection(owner, { title: 'Bookings', holdsItems: false });
    const item = await inventory.createItem(itemInput({ name: 'Passport' }));
    await expect(extras.addFromInventory(id, null, [{ itemId: item.id }])).rejects.toThrow();
  });

  it('keeps settings per account (each account has its own database)', async () => {
    const one = await setup();
    const two = await setupRepositories(undefined, undefined, 'other');
    const id = await one.extras.createSection(one.owner, { title: 'Private', icon: 'lock-outline' });
    const otherExtras = createSectionExtrasRepository(two.database, { createId: two.deps.createId, checklists: two.checklists });
    expect(await otherExtras.settings([id])).toEqual({});
  });
});
