import {
  copyName,
  describeTravellers,
  describeTripTiming,
  formatRoute,
  getTripLifecycle,
  getTripPhase,
  isCurrentTrip,
} from '../model';

const trip = { startDate: '2026-11-20', endDate: '2026-11-24', completedAt: null, archivedAt: null };

describe('trip timing', () => {
  it('classifies phases by date', () => {
    expect(getTripPhase(trip, '2026-11-10')).toBe('upcoming');
    expect(getTripPhase(trip, '2026-11-20')).toBe('ongoing');
    expect(getTripPhase(trip, '2026-11-24')).toBe('ongoing');
    expect(getTripPhase(trip, '2026-11-25')).toBe('ended');
  });

  it('describes timing for people', () => {
    expect(describeTripTiming(trip, '2026-11-10')).toBe('In 10 days');
    expect(describeTripTiming(trip, '2026-11-19')).toBe('Tomorrow');
    expect(describeTripTiming(trip, '2026-11-21')).toBe('Day 2 of 5');
    expect(describeTripTiming(trip, '2026-12-01')).toBe('Ended');
  });
});

describe('trip lifecycle', () => {
  it('is driven by explicit user actions, archive winning over completion', () => {
    expect(getTripLifecycle(trip)).toBe('active');
    expect(getTripLifecycle({ ...trip, completedAt: 'x' })).toBe('completed');
    expect(getTripLifecycle({ ...trip, completedAt: 'x', archivedAt: 'y' })).toBe('archived');
  });

  it('treats only active, not-yet-ended trips as current', () => {
    expect(isCurrentTrip(trip, '2026-11-10')).toBe(true);
    expect(isCurrentTrip(trip, '2026-11-25')).toBe(false);
    expect(isCurrentTrip({ ...trip, completedAt: 'x' }, '2026-11-10')).toBe(false);
    expect(isCurrentTrip({ ...trip, archivedAt: 'x' }, '2026-11-10')).toBe(false);
  });
});

describe('formatting helpers', () => {
  it('describes travellers', () => {
    expect(describeTravellers([{ kind: 'adult' }])).toBe('1 adult');
    expect(describeTravellers([{ kind: 'adult' }, { kind: 'adult' }, { kind: 'child' }])).toBe(
      '2 adults, 1 child',
    );
    expect(describeTravellers([{ kind: 'child' }, { kind: 'child' }])).toBe('2 children');
    expect(describeTravellers([])).toBe('No travellers');
  });

  it('formats a route in order', () => {
    expect(formatRoute([{ name: 'Manali' }, { name: 'Kaza' }, { name: 'Leh' }])).toBe('Manali → Kaza → Leh');
  });

  it('names copies within the length limit', () => {
    expect(copyName('Goa', 60)).toBe('Goa (copy)');
    const long = 'x'.repeat(60);
    expect(copyName(long, 60)).toHaveLength(60);
    expect(copyName(long, 60).endsWith(' (copy)')).toBe(true);
  });
});
