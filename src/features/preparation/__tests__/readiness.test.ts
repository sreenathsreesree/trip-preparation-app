import { mergePlans, planMerge, standardSectionsPlan, type ChecklistPlan, type Priority } from '../model';
import {
  completionPercent,
  computeStats,
  describeDeparture,
  getDepartureStatus,
  percent,
  readinessPercent,
  statsFromRow,
} from '../readiness';

const tasks = (...items: [Priority, boolean][]) => items.map(([priority, isDone]) => ({ priority, isDone }));

describe('percent', () => {
  it('never rounds up to 100% before everything is done', () => {
    expect(percent(199, 200)).toBe(99);
    expect(percent(200, 200)).toBe(100);
  });

  it('shows at least 1% once anything is done', () => {
    expect(percent(1, 300)).toBe(1);
    expect(percent(0, 300)).toBe(0);
  });

  it('handles empty lists', () => {
    expect(percent(0, 0)).toBe(0);
  });

  it('floors ordinary values', () => {
    expect(percent(2, 3)).toBe(66);
    expect(percent(1, 3)).toBe(33);
  });
});

describe('readiness', () => {
  it('excludes optional tasks from readiness but not from completion', () => {
    const stats = computeStats(
      tasks(['essential', true], ['recommended', true], ['optional', false], ['optional', false]),
    );
    expect(readinessPercent(stats)).toBe(100);
    expect(completionPercent(stats)).toBe(50);
    expect(getDepartureStatus(stats)).toBe('complete');
    expect(describeDeparture(stats).detail).toContain('2 optional left');
  });

  it('is blocked while any essential task is open, even if everything else is done', () => {
    const stats = computeStats(
      tasks(['essential', false], ['recommended', true], ['recommended', true], ['optional', true]),
    );
    expect(getDepartureStatus(stats)).toBe('blocked');
    expect(readinessPercent(stats)).toBe(66);
    expect(describeDeparture(stats)).toEqual({
      title: 'Not ready to depart',
      detail: '1 essential task still open.',
    });
  });

  it('is ready to depart once essentials are done, with recommended tasks left', () => {
    const stats = computeStats(tasks(['essential', true], ['recommended', false]));
    expect(getDepartureStatus(stats)).toBe('ready');
    expect(readinessPercent(stats)).toBe(50);
  });

  it('distinguishes an empty checklist and an optional-only checklist', () => {
    expect(getDepartureStatus(computeStats([]))).toBe('empty');
    expect(readinessPercent(computeStats([]))).toBe(0);
    const optionalOnly = computeStats(tasks(['optional', false]));
    expect(getDepartureStatus(optionalOnly)).toBe('complete');
    expect(readinessPercent(optionalOnly)).toBe(100);
    expect(completionPercent(optionalOnly)).toBe(0);
  });

  it('builds the same stats from SQL aggregates', () => {
    const list = tasks(['essential', true], ['essential', false], ['recommended', true], ['optional', false]);
    expect(
      statsFromRow({
        total_tasks: 4,
        done_tasks: 2,
        essential_total: 2,
        essential_done: 1,
        optional_total: 1,
        optional_done: 0,
      }),
    ).toEqual(computeStats(list));
  });
});

describe('planMerge', () => {
  const template: ChecklistPlan = {
    sections: [
      {
        title: 'Packing',
        kind: 'packing',
        tasks: [
          { title: 'Camera', priority: 'optional', sourceTaskId: 'tpl-1' },
          { title: '  phone   CHARGER ', priority: 'essential', sourceTaskId: 'tpl-2' },
        ],
      },
      { title: 'Photography', kind: 'custom', tasks: [{ title: 'Spare batteries', priority: 'recommended' }] },
    ],
  };

  it('appends to matching sections, skips duplicates and creates missing sections', () => {
    const result = planMerge(
      [{ key: 's1', title: 'Packing', kind: 'packing', taskTitles: ['Phone charger'], sourceTaskIds: [] }],
      template,
    );
    expect(result.added).toBe(2);
    expect(result.skipped).toBe(1);
    expect(result.additions).toEqual([{ sectionKey: 's1', tasks: [expect.objectContaining({ title: 'Camera' })] }]);
    expect(result.newSections).toEqual([
      { title: 'Photography', kind: 'custom', tasks: [expect.objectContaining({ title: 'Spare batteries' })] },
    ]);
  });

  it('matches custom sections by title and skips tasks already copied from the same template task', () => {
    const result = planMerge(
      [
        { key: 's1', title: 'Packing', kind: 'packing', taskTitles: ['Renamed camera'], sourceTaskIds: ['tpl-1'] },
        { key: 's2', title: 'photography', kind: 'custom', taskTitles: [], sourceTaskIds: [] },
      ],
      template,
    );
    expect(result.newSections).toEqual([]);
    expect(result.skipped).toBe(1); // tpl-1 already present (even though renamed)
    expect(result.additions.map((a) => a.sectionKey).sort()).toEqual(['s1', 's2']);
  });

  it('mergePlans keeps standard sections and folds template tasks into them', () => {
    const plan = mergePlans(standardSectionsPlan('train'), template);
    expect(plan.sections.map((s) => s.kind)).toEqual(['packing', 'documents', 'tasks', 'shopping', 'home', 'custom']);
    expect(plan.sections[0]?.tasks.map((t) => t.title)).toEqual(['Camera', 'phone CHARGER']);
  });
});
