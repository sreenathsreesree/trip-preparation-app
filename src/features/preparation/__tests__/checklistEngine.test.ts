import { setupRepositories, tripInput } from '../../../../test/fixtures';
import { templateOwner, tripOwner, type TaskDraft } from '../model';
import { buildStarterChecklist } from '../starter';

const task = (title: string, priority: TaskDraft['priority'] = 'recommended', extra: Partial<TaskDraft> = {}) => ({
  title,
  description: '',
  notes: '',
  priority,
  ...extra,
});

async function setupWithTemplate() {
  const repos = await setupRepositories();
  const template = await repos.templates.create({ name: 'Trek kit', description: 'For high-altitude treks' });
  const owner = templateOwner(template.id);
  const gear = await repos.checklists.addSection(owner, 'Gear');
  const packing = await repos.checklists.addSection(owner, 'Packing', 'packing');
  await repos.checklists.addTask(gear.id, task('Trekking poles', 'essential', { description: 'Adjustable', notes: 'Rent in Manali' }));
  await repos.checklists.addTask(gear.id, task('Headlamp', 'recommended'));
  await repos.checklists.addTask(packing.id, task('Thermal layers', 'essential'));
  return { ...repos, template, owner, gear, packing };
}

describe('checklist editing', () => {
  it('adds, edits, reorders and deletes tasks with full details', async () => {
    const { db, checklists, owner, gear } = await setupWithTemplate();
    const extra = await checklists.addTask(gear.id, task('  Gaiters  ', 'optional'));
    expect(extra.title).toBe('Gaiters');

    await checklists.updateTask(extra.id, task('Snow gaiters', 'essential', { description: 'Waterproof', notes: 'Size M' }));
    expect(await checklists.moveTask(extra.id, -1)).toBe(true);
    expect(await checklists.moveTask(extra.id, -1)).toBe(true);
    expect(await checklists.moveTask(extra.id, -1)).toBe(false); // already first

    const { tasks } = await checklists.load(owner);
    const gearTasks = tasks.filter((t) => t.sectionId === gear.id);
    expect(gearTasks.map((t) => t.title)).toEqual(['Snow gaiters', 'Trekking poles', 'Headlamp']);
    expect(gearTasks.map((t) => t.position)).toEqual([0, 1, 2]);
    expect(gearTasks[0]).toMatchObject({ description: 'Waterproof', notes: 'Size M', priority: 'essential' });

    await checklists.deleteTask(extra.id);
    expect((await checklists.load(owner)).tasks.some((t) => t.id === extra.id)).toBe(false);
    db.close();
  });

  it('renames, reorders and deletes sections (deleting removes their tasks)', async () => {
    const { db, checklists, owner, gear, packing } = await setupWithTemplate();
    await checklists.renameSection(gear.id, 'Trek gear');
    await checklists.moveSection(packing.id, -1);
    let checklist = await checklists.load(owner);
    expect(checklist.sections.map((s) => s.title)).toEqual(['Packing', 'Trek gear']);

    await checklists.deleteSection(gear.id);
    checklist = await checklists.load(owner);
    expect(checklist.sections.map((s) => s.title)).toEqual(['Packing']);
    expect(checklist.tasks.map((t) => t.title)).toEqual(['Thermal layers']);
    db.close();
  });

  it('moves a task to another section of the same checklist only', async () => {
    const { db, trips, checklists, owner, gear, packing } = await setupWithTemplate();
    const headlamp = (await checklists.load(owner)).tasks.find((t) => t.title === 'Headlamp');
    await checklists.updateTask(headlamp?.id ?? '', task('Headlamp'), { sectionId: packing.id });
    const moved = (await checklists.load(owner)).tasks.find((t) => t.id === headlamp?.id);
    expect(moved?.sectionId).toBe(packing.id);

    const trip = await trips.create(tripInput(), buildStarterChecklist(tripInput()));
    const tripSection = (await checklists.load(tripOwner(trip.id))).sections[0];
    await expect(
      checklists.updateTask(headlamp?.id ?? '', task('Headlamp'), { sectionId: tripSection?.id }),
    ).rejects.toThrow(/same checklist/);
    expect(gear.id).toBeDefined();
    db.close();
  });

  it('validates titles and lengths', async () => {
    const { db, checklists, owner, gear } = await setupWithTemplate();
    await expect(checklists.addTask(gear.id, task('   '))).rejects.toThrow(/title/);
    await expect(checklists.addTask(gear.id, task('x'.repeat(121)))).rejects.toThrow(/120/);
    await expect(checklists.addSection(owner, ' ')).rejects.toThrow(/name/);
    db.close();
  });

  it('only allows completing tasks on trips, never on templates', async () => {
    const { db, checklists, owner } = await setupWithTemplate();
    const templateTask = (await checklists.load(owner)).tasks[0];
    await expect(checklists.setTaskDone(templateTask?.id ?? '', true)).rejects.toThrow();
    db.close();
  });
});

describe('templates reused across trips', () => {
  it('copies template tasks into trips with independent completion per trip', async () => {
    const { db, trips, checklists, templates, template } = await setupWithTemplate();
    const plan = await templates.toPlan(template.id);
    const a = await trips.create(tripInput({ name: 'A' }), plan);
    const b = await trips.create(tripInput({ name: 'B' }), plan);

    const aTasks = (await checklists.load(tripOwner(a.id))).tasks;
    const bTasks = (await checklists.load(tripOwner(b.id))).tasks;
    expect(aTasks.map((t) => t.title)).toEqual(bTasks.map((t) => t.title));
    expect(aTasks[0]).toMatchObject({
      title: 'Trekking poles',
      description: 'Adjustable',
      notes: 'Rent in Manali',
      priority: 'essential',
      sourceTemplateId: template.id,
    });
    expect(new Set([...aTasks, ...bTasks].map((t) => t.id)).size).toBe(aTasks.length + bTasks.length);

    await checklists.setTaskDone(aTasks[0]?.id ?? '', true);
    expect((await trips.getById(a.id))?.readiness.done).toBe(1);
    expect((await trips.getById(b.id))?.readiness.done).toBe(0);
    db.close();
  });

  it('allows trip-specific customisation without changing the template', async () => {
    const { db, trips, checklists, templates, template, owner } = await setupWithTemplate();
    const trip = await trips.create(tripInput(), await templates.toPlan(template.id));
    const templateBefore = await checklists.load(owner);

    const tripChecklist = await checklists.load(tripOwner(trip.id));
    await checklists.updateTask(tripChecklist.tasks[0]?.id ?? '', task('Poles (borrowed)', 'optional'));
    await checklists.deleteTask(tripChecklist.tasks[1]?.id ?? '');
    await checklists.addSection(tripOwner(trip.id), 'Permits');

    expect(await checklists.load(owner)).toEqual(templateBefore);
    db.close();
  });

  it('never silently changes existing trips when the template is edited or deleted', async () => {
    const { db, trips, checklists, templates, template, owner, gear } = await setupWithTemplate();
    const trip = await trips.create(tripInput(), await templates.toPlan(template.id));
    const tripBefore = await checklists.load(tripOwner(trip.id));

    const poles = (await checklists.load(owner)).tasks.find((t) => t.title === 'Trekking poles');
    await checklists.updateTask(poles?.id ?? '', task('Carbon trekking poles', 'optional'));
    await checklists.addTask(gear.id, task('Microspikes', 'essential'));
    await checklists.renameSection(gear.id, 'Renamed');
    expect(await checklists.load(tripOwner(trip.id))).toEqual(tripBefore);

    await templates.remove(template.id);
    expect(await checklists.load(tripOwner(trip.id))).toEqual(tripBefore);
    db.close();
  });

  it('re-applying an edited template adds only what is missing', async () => {
    const { db, trips, checklists, templates, template, gear } = await setupWithTemplate();
    const trip = await trips.create(tripInput(), await templates.toPlan(template.id));
    const owner = tripOwner(trip.id);
    const firstTask = (await checklists.load(owner)).tasks[0];
    await checklists.setTaskDone(firstTask?.id ?? '', true);
    // Rename a copied task on the trip; it must still be recognised by its origin.
    await checklists.updateTask(firstTask?.id ?? '', task('My poles', 'essential'));

    await checklists.addTask(gear.id, task('Microspikes', 'essential'));
    const result = await checklists.applyPlan(owner, await templates.toPlan(template.id));

    expect(result).toEqual({ added: 1, skipped: 3, sectionsAdded: 0 });
    const after = await checklists.load(owner);
    expect(after.tasks.map((t) => t.title)).toEqual(['My poles', 'Headlamp', 'Microspikes', 'Thermal layers']);
    expect(after.tasks.find((t) => t.id === firstTask?.id)?.isDone).toBe(true);
    db.close();
  });

  it('merges template sections into a trip’s standard sections', async () => {
    const { db, trips, checklists, templates, template } = await setupWithTemplate();
    const input = tripInput({ transportMode: 'train' });
    const trip = await trips.create(input, buildStarterChecklist(input));
    const before = await checklists.load(tripOwner(trip.id));

    const result = await checklists.applyPlan(tripOwner(trip.id), await templates.toPlan(template.id));
    expect(result).toEqual({ added: 3, skipped: 0, sectionsAdded: 1 });

    const after = await checklists.load(tripOwner(trip.id));
    expect(after.sections.map((s) => s.title)).toEqual([...before.sections.map((s) => s.title), 'Gear']);
    const packing = after.sections.find((s) => s.kind === 'packing');
    expect(after.tasks.filter((t) => t.sectionId === packing?.id).at(-1)?.title).toBe('Thermal layers');
    db.close();
  });
});

describe('template management', () => {
  it('duplicates a template as an independent deep copy', async () => {
    const { db, checklists, templates, template, owner } = await setupWithTemplate();
    const copy = await templates.duplicate(template.id);
    expect(copy).toMatchObject({ name: 'Trek kit (copy)', description: 'For high-altitude treks', sectionCount: 2, taskCount: 3 });

    const copyChecklist = await checklists.load(templateOwner(copy.id));
    await checklists.deleteTask(copyChecklist.tasks[0]?.id ?? '');
    expect((await checklists.load(owner)).tasks).toHaveLength(3);
    db.close();
  });

  it('saves a trip checklist as a template without completion', async () => {
    const { db, trips, checklists, templates } = await setupRepositories();
    const trip = await trips.create(tripInput(), buildStarterChecklist(tripInput()));
    const tripChecklist = await checklists.load(tripOwner(trip.id));
    await checklists.setTaskDone(tripChecklist.tasks[0]?.id ?? '', true);

    const saved = await templates.createFromTrip(trip.id, { name: 'Goa road trip', description: '' });
    expect(saved.taskCount).toBe(tripChecklist.tasks.length);
    expect(saved.sectionCount).toBe(tripChecklist.sections.length);
    const templateTasks = (await checklists.load(templateOwner(saved.id))).tasks;
    expect(templateTasks.every((t) => !t.isDone)).toBe(true);
    db.close();
  });

  it('lists, renames and deletes templates; deleting removes its sections and tasks', async () => {
    const { db, templates, template } = await setupWithTemplate();
    await templates.create({ name: 'Business basics', description: '' });
    await templates.update(template.id, { name: 'Alpine trek kit', description: 'Updated' });
    expect((await templates.list()).map((t) => t.name)).toEqual(['Alpine trek kit', 'Business basics']);

    expect(await templates.remove(template.id)).toBe(true);
    const leftovers = await db.getFirstAsync<{ n: number }>(
      'SELECT COUNT(*) AS n FROM checklist_sections WHERE template_id = ?',
      [template.id],
    );
    expect(leftovers?.n).toBe(0);
    await expect(templates.update(template.id, { name: 'x', description: '' })).rejects.toThrow();
    await expect(templates.create({ name: '  ', description: '' })).rejects.toThrow(/name/);
    db.close();
  });

  it('bumps the template edit time when its contents change', async () => {
    const { db, templates, checklists, template, gear } = await setupWithTemplate();
    const before = (await templates.getById(template.id))?.updatedAt ?? '';
    await checklists.addTask(gear.id, task('Map'));
    const after = (await templates.getById(template.id))?.updatedAt ?? '';
    expect(after > before).toBe(true);
    db.close();
  });
});
