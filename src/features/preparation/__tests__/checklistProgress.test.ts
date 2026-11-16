import { setupRepositories, tripInput } from '../../../../test/fixtures';
import { tripDays } from '../../trips/model';
import { emptyTaskDraft, groupTasksBySection } from '../model';
import { checklistProgress, completionPercent, computeStats } from '../readiness';

describe('one readiness figure for the dashboard and the Checklist tab', () => {
  it('is done/total over every task, with open essentials counted', () => {
    const tasks = [
      { priority: 'essential' as const, isDone: true },
      { priority: 'essential' as const, isDone: false },
      { priority: 'recommended' as const, isDone: true },
      { priority: 'optional' as const, isDone: false },
    ];
    expect(checklistProgress(tasks)).toEqual({ percent: 50, done: 2, total: 4, essentialsOpen: 1 });
    expect(checklistProgress([])).toEqual({ percent: 0, done: 0, total: 0, essentialsOpen: 0 });
    expect(checklistProgress(tasks).percent).toBe(completionPercent(computeStats(tasks)));
  });

  it('the collapsed (trip) figure equals the sum of the expanded (section) figures, and reading changes nothing', async () => {
    const repos = await setupRepositories();
    const trip = await repos.trips.create(tripInput({ name: 'Munnar' }), { sections: [] });
    const owner = { type: 'trip' as const, id: trip.id };
    const packing = await repos.checklists.addSection(owner, 'Packing', 'packing');
    const docs = await repos.checklists.addSection(owner, 'Documents', 'documents');
    const a = await repos.checklists.addTask(packing.id, { ...emptyTaskDraft('essential'), title: 'Rain jacket' });
    await repos.checklists.addTask(packing.id, { ...emptyTaskDraft('optional'), title: 'Kindle' });
    const c = await repos.checklists.addTask(docs.id, { ...emptyTaskDraft('essential'), title: 'ID card' });
    await repos.checklists.setTaskDone(a.id, true);
    await repos.checklists.setTaskDone(c.id, true);

    const before = await repos.checklists.load(owner);
    const trip_ = checklistProgress(before.tasks);
    const sections = [...groupTasksBySection(before.tasks).values()].map((t) => checklistProgress(t));
    expect([sections.reduce((n, s) => n + s.done, 0), sections.reduce((n, s) => n + s.total, 0)]).toEqual([trip_.done, trip_.total]);
    expect(trip_).toEqual({ percent: 66, done: 2, total: 3, essentialsOpen: 0 });

    const after = await repos.checklists.load(owner);
    expect(after.tasks.map((t) => [t.id, t.isDone, t.priority])).toEqual(before.tasks.map((t) => [t.id, t.isDone, t.priority]));
  });
});

describe('trip length in the header', () => {
  it('counts both the first and the last day', () => {
    expect(tripDays({ startDate: '2026-12-20', endDate: '2026-12-24' })).toBe(5);
    expect(tripDays({ startDate: '2026-12-20', endDate: '2026-12-20' })).toBe(1);
    expect(tripDays({ startDate: '2026-12-24', endDate: '2026-12-20' })).toBe(1);
  });
});
