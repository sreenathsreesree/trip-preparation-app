import type { PackingProgress } from '../packing/model';
import { readinessPercent, type ReadinessStats } from './readiness';

/**
 * One preparation number for the trip dashboard: departure readiness of the
 * checklist (essential + recommended tasks) weighted 70 %, and how much of the
 * packing list is packed weighted 30 % — only when there is something to pack.
 * Each part is still shown on its own underneath, so nothing is hidden.
 */
export function combinedPreparation(stats: ReadinessStats, packing: Pick<PackingProgress, 'units' | 'packedUnits'>): { percent: number; checklist: number; packing: number | null } {
  const checklist = readinessPercent(stats);
  const packed = packing.units > 0 ? Math.round((packing.packedUnits / packing.units) * 100) : null;
  if (stats.total === 0 && packed === null) return { percent: 0, checklist, packing: null };
  if (packed === null) return { percent: checklist, checklist, packing: null };
  if (stats.total === 0) return { percent: packed, checklist, packing: packed };
  return { percent: Math.round(checklist * 0.7 + packed * 0.3), checklist, packing: packed };
}

export type JourneyState = 'not_started' | 'in_progress' | 'completed';

/**
 * Where the journey stands, for the Start / Continue / Completed button. It
 * only reads state: opening the journey never starts navigation by itself.
 */
export function journeyState(input: { phase: 'upcoming' | 'ongoing' | 'ended'; completed: boolean; routeStops: number; visitedStops: number }): JourneyState {
  if (input.completed || input.phase === 'ended' || (input.routeStops > 0 && input.visitedStops >= input.routeStops)) return 'completed';
  if (input.phase === 'ongoing' || input.visitedStops > 0) return 'in_progress';
  return 'not_started';
}
