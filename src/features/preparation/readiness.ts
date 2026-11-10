import type { ChecklistTask, Priority } from './model';

export interface Tally {
  total: number;
  done: number;
}

/**
 * Checklist counts for a trip or section.
 *
 * Two different questions are answered from these numbers:
 * - **Task completion**: how much of the whole list is ticked (optional included).
 * - **Departure readiness**: whether you can leave — essential tasks gate it,
 *   recommended tasks count towards the percentage, optional tasks never block.
 */
export interface ReadinessStats extends Tally {
  essential: Tally;
  recommended: Tally;
  optional: Tally;
}

export const EMPTY_STATS: ReadinessStats = {
  total: 0,
  done: 0,
  essential: { total: 0, done: 0 },
  recommended: { total: 0, done: 0 },
  optional: { total: 0, done: 0 },
};

export function computeStats(
  tasks: readonly Pick<ChecklistTask, 'priority' | 'isDone'>[],
): ReadinessStats {
  const stats: ReadinessStats = {
    total: 0,
    done: 0,
    essential: { total: 0, done: 0 },
    recommended: { total: 0, done: 0 },
    optional: { total: 0, done: 0 },
  };
  for (const task of tasks) {
    const bucket: Tally = stats[task.priority as Priority] ?? stats.recommended;
    stats.total += 1;
    bucket.total += 1;
    if (task.isDone) {
      stats.done += 1;
      bucket.done += 1;
    }
  }
  return stats;
}

/**
 * Whole-number percentage that never overstates progress: 100% only when
 * everything is done, and any progress shows at least 1%.
 */
export function percent(done: number, total: number): number {
  if (total <= 0 || done <= 0) return 0;
  if (done >= total) return 100;
  return Math.min(99, Math.max(1, Math.floor((done * 100) / total)));
}

/** Essential + recommended: the tasks that count towards readiness. */
export function requiredTally(stats: ReadinessStats): Tally {
  return {
    total: stats.essential.total + stats.recommended.total,
    done: stats.essential.done + stats.recommended.done,
  };
}

/** Departure readiness percentage; optional tasks are excluded. */
export function readinessPercent(stats: ReadinessStats): number {
  const required = requiredTally(stats);
  if (required.total === 0) return stats.total > 0 ? 100 : 0;
  return percent(required.done, required.total);
}

/** Share of every task ticked, optional included. */
export function completionPercent(stats: Tally): number {
  return percent(stats.done, stats.total);
}

export type DepartureStatus = 'empty' | 'blocked' | 'ready' | 'complete';

/**
 * - `empty`: nothing on the checklist yet.
 * - `blocked`: at least one essential task is open — not ready to depart.
 * - `ready`: every essential is done; recommended tasks remain.
 * - `complete`: every essential and recommended task is done (optional may remain).
 */
export function getDepartureStatus(stats: ReadinessStats): DepartureStatus {
  if (stats.total === 0) return 'empty';
  if (stats.essential.done < stats.essential.total) return 'blocked';
  if (stats.recommended.done < stats.recommended.total) return 'ready';
  return 'complete';
}

export function openCount(tally: Tally): number {
  return Math.max(0, tally.total - tally.done);
}

export function describeDeparture(stats: ReadinessStats): { title: string; detail: string } {
  const status = getDepartureStatus(stats);
  const essentialsLeft = openCount(stats.essential);
  const recommendedLeft = openCount(stats.recommended);
  const optionalLeft = openCount(stats.optional);
  switch (status) {
    case 'empty':
      return { title: 'No checklist yet', detail: 'Add tasks to start tracking readiness.' };
    case 'blocked':
      return {
        title: 'Not ready to depart',
        detail: `${essentialsLeft} essential ${essentialsLeft === 1 ? 'task' : 'tasks'} still open.`,
      };
    case 'ready':
      return {
        title: 'Ready to depart',
        detail: `All essentials done · ${recommendedLeft} recommended left.`,
      };
    case 'complete':
      return {
        title: 'Fully prepared',
        detail:
          optionalLeft > 0
            ? `Everything required is done · ${optionalLeft} optional left.`
            : 'Every task is done.',
      };
  }
}

/** Builds stats from aggregate SQL columns. */
export function statsFromRow(row: {
  total_tasks: number | null;
  done_tasks: number | null;
  essential_total: number | null;
  essential_done: number | null;
  optional_total: number | null;
  optional_done: number | null;
}): ReadinessStats {
  const n = (value: number | null) => Number(value) || 0;
  const total = n(row.total_tasks);
  const done = n(row.done_tasks);
  const essential = { total: n(row.essential_total), done: n(row.essential_done) };
  const optional = { total: n(row.optional_total), done: n(row.optional_done) };
  return {
    total,
    done,
    essential,
    optional,
    // Anything that is not essential or optional counts as recommended.
    recommended: {
      total: total - essential.total - optional.total,
      done: done - essential.done - optional.done,
    },
  };
}
