import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { setupRepositories, tripInput } from '../../../../test/fixtures';
import { openTestDatabase } from '../../../../test/nodeSqliteDatabase';
import { tripOwner } from '../../preparation/model';
import { buildStarterChecklist } from '../../preparation/starter';

const input = tripInput();

describe('tripRepository: create and read', () => {
  it('creates a trip with ordered destinations, travellers and its checklist', async () => {
    const { db, trips, checklists } = await setupRepositories();
    const plan = buildStarterChecklist(input);
    const created = await trips.create(input, plan);

    expect(created).toMatchObject({
      name: 'Goa Getaway',
      destinations: [
        { id: expect.any(String), name: 'North Goa' },
        { id: expect.any(String), name: 'South Goa' },
      ],
      travellers: [
        { name: 'Asha', kind: 'adult' },
        { name: 'Ravi', kind: 'adult' },
        { name: 'Mia', kind: 'child' },
      ],
      completedAt: null,
      archivedAt: null,
    });
    const taskCount = plan.sections.reduce((n, s) => n + s.tasks.length, 0);
    expect(created.readiness.total).toBe(taskCount);
    expect(created.readiness.essential.total).toBeGreaterThan(0);

    const checklist = await checklists.load(tripOwner(created.id));
    expect(checklist.sections.map((s) => s.kind)).toEqual(plan.sections.map((s) => s.kind));
    expect(await trips.getById(created.id)).toEqual(created);
    db.close();
  });

  it('keeps the legacy summary columns in step with destinations and travellers', async () => {
    const { db, trips } = await setupRepositories();
    const created = await trips.create(input, { sections: [] });
    const row = await db.getFirstAsync<{ destination: string; adults: number; children: number }>(
      'SELECT destination, adults, children FROM trips WHERE id = ?',
      [created.id],
    );
    expect(row).toEqual({ destination: 'North Goa', adults: 2, children: 1 });
    db.close();
  });

  it('allows a trip without destinations yet, but not without travellers', async () => {
    const { db, trips } = await setupRepositories();
    await expect(trips.create(tripInput({ travellers: [] }), { sections: [] })).rejects.toThrow(/traveller/);
    expect(await trips.count()).toBe(0);
    const undecided = await trips.create(tripInput({ destinations: undefined }), { sections: [] });
    expect(undecided.destinations).toEqual([]);
    const empty = await trips.create(tripInput({ destinations: [] }), { sections: [] });
    expect((await trips.getById(empty.id))?.destinations).toEqual([]);
    const row = await db.getFirstAsync<{ destination: string }>('SELECT destination FROM trips WHERE id = ?', [empty.id]);
    expect(row?.destination).toBe('');
    db.close();
  });

  it('rolls back everything if the checklist cannot be written', async () => {
    const { db, trips } = await setupRepositories();
    const badPlan = { sections: [{ title: '', kind: 'custom' as const, tasks: [] }] };
    await expect(trips.create(input, badPlan)).rejects.toThrow();
    expect(await trips.count()).toBe(0);
    const orphans = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM trip_destinations', []);
    expect(orphans?.n).toBe(0);
    db.close();
  });
});

describe('tripRepository: editing', () => {
  it('updates details and travellers (preserving ids) but never destinations, which the planner owns', async () => {
    const { db, trips } = await setupRepositories();
    const created = await trips.create(input, { sections: [] });
    const [asha, , mia] = created.travellers;

    const updated = await trips.update(created.id, {
      ...input,
      name: 'Goa & Gokarna',
      destinations: [{ name: 'Ignored' }],
      travellers: [
        { id: asha?.id, name: 'Asha K', kind: 'adult' },
        { id: mia?.id, name: 'Mia', kind: 'child' },
        { name: 'Dev', kind: 'child' },
      ],
    });

    expect(updated.name).toBe('Goa & Gokarna');
    expect(updated.destinations).toEqual(created.destinations);
    expect(updated.travellers.map((t) => t.name)).toEqual(['Asha K', 'Mia', 'Dev']);
    expect(updated.travellers[0]?.id).toBe(asha?.id); // edited in place
    expect(updated.travellers.some((t) => t.name === 'Ravi')).toBe(false); // removed
    expect(updated.createdAt).toBe(created.createdAt);
    db.close();
  });

  it('never changes the checklist or its completion when details are edited', async () => {
    const { db, trips, checklists } = await setupRepositories();
    const created = await trips.create(input, buildStarterChecklist(input));
    const before = await checklists.load(tripOwner(created.id));
    const first = before.tasks[0];
    if (!first) throw new Error('expected tasks');
    await checklists.setTaskDone(first.id, true);
    const ticked = await checklists.load(tripOwner(created.id));

    await trips.update(created.id, { ...input, transportMode: 'train', category: 'business', name: 'Changed' });

    expect(await checklists.load(tripOwner(created.id))).toEqual(ticked);
    db.close();
  });

  it('ignores child ids that belong to another trip instead of hijacking them', async () => {
    const { db, trips } = await setupRepositories();
    const a = await trips.create(input, { sections: [] });
    const b = await trips.create(tripInput({ name: 'Other trip' }), { sections: [] });
    const foreign = b.travellers[0];

    await trips.update(a.id, { ...input, travellers: [{ id: foreign?.id, name: 'Hijack attempt', kind: 'adult' }] });

    const reloadedB = await trips.getById(b.id);
    expect(reloadedB?.travellers[0]).toEqual(foreign);
    const reloadedA = await trips.getById(a.id);
    expect(reloadedA?.travellers.map((t) => t.name)).toEqual(['Hijack attempt']);
    expect(reloadedA?.travellers[0]?.id).not.toBe(foreign?.id);
    db.close();
  });

  it("editing one trip does not touch another trip's checklist", async () => {
    const { db, trips, checklists } = await setupRepositories();
    const a = await trips.create(input, buildStarterChecklist(input));
    const b = await trips.create(tripInput({ name: 'B' }), buildStarterChecklist(input));
    const bTasks = (await checklists.load(tripOwner(b.id))).tasks;
    await checklists.setTaskDone(bTasks[0]?.id ?? '', true);
    const bBefore = await checklists.load(tripOwner(b.id));

    const aChecklist = await checklists.load(tripOwner(a.id));
    await trips.update(a.id, { ...input, name: 'A renamed', destinations: [{ name: 'Elsewhere' }] });
    await checklists.setTaskDone(aChecklist.tasks[1]?.id ?? '', true);
    await checklists.deleteTask(aChecklist.tasks[2]?.id ?? '');
    await checklists.addTask(aChecklist.sections[0]?.id ?? '', {
      title: 'Only for A',
      description: '',
      notes: '',
      priority: 'optional',
    });
    await checklists.deleteSection(aChecklist.sections[1]?.id ?? '');

    expect(await checklists.load(tripOwner(b.id))).toEqual(bBefore);
    db.close();
  });
});

describe('tripRepository: duplicate, lifecycle and delete', () => {
  it('duplicates a trip with a fresh, unticked copy of its checklist', async () => {
    const { db, trips, checklists } = await setupRepositories();
    const original = await trips.create(input, buildStarterChecklist(input));
    const originalChecklist = await checklists.load(tripOwner(original.id));
    for (const task of originalChecklist.tasks.slice(0, 3)) await checklists.setTaskDone(task.id, true);
    await trips.setCompleted(original.id, true);

    const copy = await trips.duplicate(original.id);

    expect(copy.id).not.toBe(original.id);
    expect(copy.name).toBe('Goa Getaway (copy)');
    expect(copy.completedAt).toBeNull();
    expect(copy.destinations.map((d) => d.name)).toEqual(['North Goa', 'South Goa']);
    expect(copy.travellers.map((t) => t.name)).toEqual(['Asha', 'Ravi', 'Mia']);
    expect(copy.destinations[0]?.id).not.toBe(original.destinations[0]?.id);
    expect(copy.readiness.total).toBe(originalChecklist.tasks.length);
    expect(copy.readiness.done).toBe(0);

    const copyChecklist = await checklists.load(tripOwner(copy.id));
    expect(copyChecklist.tasks.map((t) => [t.title, t.priority])).toEqual(
      originalChecklist.tasks.map((t) => [t.title, t.priority]),
    );
    // Independent completion: ticking the copy leaves the original alone.
    await checklists.setTaskDone(copyChecklist.tasks[5]?.id ?? '', true);
    const originalAfter = await trips.getById(original.id);
    expect(originalAfter?.readiness.done).toBe(3);
    db.close();
  });

  it('marks trips completed and archived, and restores them', async () => {
    const { db, trips } = await setupRepositories();
    const trip = await trips.create(input, { sections: [] });

    const completed = await trips.setCompleted(trip.id, true);
    expect(completed.completedAt).toEqual(expect.any(String));
    const archived = await trips.setArchived(trip.id, true);
    expect(archived.archivedAt).toEqual(expect.any(String));
    expect(archived.completedAt).toBe(completed.completedAt);

    const restored = await trips.setArchived(trip.id, false);
    expect(restored.archivedAt).toBeNull();
    expect(restored.completedAt).toBe(completed.completedAt); // returns to Completed
    const reopened = await trips.setCompleted(trip.id, false);
    expect(reopened.completedAt).toBeNull();
    db.close();
  });

  it('reports what a delete will remove, then cascades it', async () => {
    const { db, trips, checklists } = await setupRepositories();
    const keep = await trips.create(tripInput({ name: 'Keep' }), buildStarterChecklist(input));
    const gone = await trips.create(input, buildStarterChecklist(input));
    const goneTasks = (await checklists.load(tripOwner(gone.id))).tasks.length;

    expect(await trips.deletionImpact(gone.id)).toEqual({
      destinations: 2,
      travellers: 3,
      sections: 6,
      tasks: goneTasks,
    });
    expect(await trips.remove(gone.id)).toBe(true);
    expect(await trips.remove(gone.id)).toBe(false);
    expect(await trips.deletionImpact(gone.id)).toEqual({ destinations: 0, travellers: 0, sections: 0, tasks: 0 });
    expect((await checklists.load(tripOwner(gone.id))).tasks).toEqual([]);
    expect((await checklists.load(tripOwner(keep.id))).tasks.length).toBeGreaterThan(0);
    db.close();
  });
});

describe('persistence', () => {
  it('keeps trips, edits, lifecycle and ticks after the database is closed and reopened', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'trip-prep-'));
    const file = join(dir, 'trip-prep.db');
    try {
      const first = await setupRepositories(openTestDatabase(file));
      const created = await first.trips.create(input, buildStarterChecklist(input));
      await first.trips.update(created.id, { ...input, name: 'Edited name', destinations: [{ name: 'Hampi' }] });
      const task = (await first.checklists.load(tripOwner(created.id))).tasks[0];
      await first.checklists.setTaskDone(task?.id ?? '', true);
      await first.trips.setArchived(created.id, true);
      const template = await first.templates.createFromTrip(created.id, { name: 'Beach kit', description: '' });
      const before = await first.trips.getById(created.id);
      const beforeChecklist = await first.checklists.load(tripOwner(created.id));
      first.db.close();

      // Cold start: new connection, migrations run again (no-op).
      const second = await setupRepositories(openTestDatabase(file));
      expect(await second.trips.getById(created.id)).toEqual(before);
      expect(await second.checklists.load(tripOwner(created.id))).toEqual(beforeChecklist);
      expect((await second.templates.getById(template.id))?.taskCount).toBe(beforeChecklist.tasks.length);
      second.db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
