import { combinedPreparation, journeyState } from '../progress';
import { computeStats } from '../readiness';

const stats = (done: number, total: number) => computeStats(Array.from({ length: total }, (_, i) => ({ priority: 'essential' as const, isDone: i < done })));

describe('combined preparation progress', () => {
  it('weights the checklist 70 % and packing 30 % when both exist', () => {
    expect(combinedPreparation(stats(5, 10), { units: 10, packedUnits: 10 })).toEqual({ percent: 65, checklist: 50, packing: 100 });
  });
  it('uses whichever part exists, and 0 with nothing to do', () => {
    expect(combinedPreparation(stats(1, 4), { units: 0, packedUnits: 0 }).percent).toBe(25);
    expect(combinedPreparation(stats(0, 0), { units: 4, packedUnits: 1 }).percent).toBe(25);
    expect(combinedPreparation(stats(0, 0), { units: 0, packedUnits: 0 }).percent).toBe(0);
  });
});

describe('journey state', () => {
  it('is not started before departure with nothing visited', () => {
    expect(journeyState({ phase: 'upcoming', completed: false, routeStops: 3, visitedStops: 0 })).toBe('not_started');
  });
  it('continues once the trip is under way or a stop is visited', () => {
    expect(journeyState({ phase: 'ongoing', completed: false, routeStops: 3, visitedStops: 0 })).toBe('in_progress');
    expect(journeyState({ phase: 'upcoming', completed: false, routeStops: 3, visitedStops: 1 })).toBe('in_progress');
  });
  it('is completed when the trip is done or every stop is visited', () => {
    expect(journeyState({ phase: 'ongoing', completed: false, routeStops: 2, visitedStops: 2 })).toBe('completed');
    expect(journeyState({ phase: 'ended', completed: false, routeStops: 0, visitedStops: 0 })).toBe('completed');
    expect(journeyState({ phase: 'upcoming', completed: true, routeStops: 0, visitedStops: 0 })).toBe('completed');
  });
});
