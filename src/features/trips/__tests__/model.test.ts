import { describeTravellers, describeTripTiming, getTripPhase, progressRatio } from '../model';

const trip = { startDate: '2026-11-20', endDate: '2026-11-24' };

describe('trip timing', () => {
  it('classifies phases', () => {
    expect(getTripPhase(trip, '2026-11-10')).toBe('upcoming');
    expect(getTripPhase(trip, '2026-11-20')).toBe('ongoing');
    expect(getTripPhase(trip, '2026-11-24')).toBe('ongoing');
    expect(getTripPhase(trip, '2026-11-25')).toBe('completed');
  });

  it('describes timing for people', () => {
    expect(describeTripTiming(trip, '2026-11-10')).toBe('In 10 days');
    expect(describeTripTiming(trip, '2026-11-19')).toBe('Tomorrow');
    expect(describeTripTiming(trip, '2026-11-21')).toBe('Day 2 of 5');
    expect(describeTripTiming(trip, '2026-12-01')).toBe('Completed');
  });
});

describe('describeTravellers', () => {
  it('pluralises', () => {
    expect(describeTravellers({ adults: 1, children: 0 })).toBe('1 adult');
    expect(describeTravellers({ adults: 2, children: 1 })).toBe('2 adults, 1 child');
    expect(describeTravellers({ adults: 2, children: 3 })).toBe('2 adults, 3 children');
  });
});

describe('progressRatio', () => {
  it('handles empty checklists', () => {
    expect(progressRatio({ total: 0, done: 0 })).toBe(0);
    expect(progressRatio({ total: 4, done: 1 })).toBe(0.25);
  });
});
