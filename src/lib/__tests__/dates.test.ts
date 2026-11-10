import {
  addDays,
  diffInDays,
  formatDate,
  formatDateLong,
  formatDateRange,
  getMonthGrid,
  inclusiveDayCount,
  isValidISODate,
  nextDateRange,
  shiftMonth,
  toISODate,
} from '../dates';

describe('isValidISODate', () => {
  it('accepts real calendar dates', () => {
    expect(isValidISODate('2026-11-10')).toBe(true);
    expect(isValidISODate('2028-02-29')).toBe(true);
  });

  it('rejects malformed or impossible dates', () => {
    expect(isValidISODate('2026-02-30')).toBe(false);
    expect(isValidISODate('2027-02-29')).toBe(false);
    expect(isValidISODate('2026-1-5')).toBe(false);
    expect(isValidISODate('')).toBe(false);
    expect(isValidISODate(null)).toBe(false);
  });
});

describe('day arithmetic', () => {
  it('adds days across month and year boundaries', () => {
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('counts days between dates', () => {
    expect(diffInDays('2026-11-10', '2026-11-25')).toBe(15);
    expect(diffInDays('2026-11-25', '2026-11-10')).toBe(-15);
    expect(inclusiveDayCount('2026-11-10', '2026-11-10')).toBe(1);
    expect(inclusiveDayCount('2026-11-10', '2026-11-12')).toBe(3);
  });

  it('converts a local Date to its calendar day', () => {
    expect(toISODate(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
  });

  it('shifts months with year rollover', () => {
    expect(shiftMonth(2026, 12, 1)).toEqual({ year: 2027, month: 1 });
    expect(shiftMonth(2026, 1, -1)).toEqual({ year: 2025, month: 12 });
  });
});

describe('formatting', () => {
  it('formats single dates', () => {
    expect(formatDate('2026-11-05')).toBe('5 Nov');
    expect(formatDate('2026-11-05', { withYear: true })).toBe('5 Nov 2026');
    expect(formatDateLong('2026-11-10')).toBe('Tuesday 10 November 2026');
  });

  it('formats ranges compactly', () => {
    expect(formatDateRange('2026-11-12', '2026-11-15')).toBe('12 – 15 Nov 2026');
    expect(formatDateRange('2026-11-28', '2026-12-02')).toBe('28 Nov – 2 Dec 2026');
    expect(formatDateRange('2026-12-30', '2027-01-03')).toBe('30 Dec 2026 – 3 Jan 2027');
    expect(formatDateRange('2026-11-12', '2026-11-12')).toBe('12 Nov 2026');
  });
});

describe('getMonthGrid', () => {
  it('pads a Monday-first grid (November 2026 starts on a Sunday)', () => {
    const weeks = getMonthGrid(2026, 11, 'monday');
    expect(weeks[0]).toEqual([null, null, null, null, null, null, '2026-11-01']);
    expect(weeks.every((week) => week.length === 7)).toBe(true);
    expect(weeks.flat().filter(Boolean)).toHaveLength(30);
  });

  it('supports Sunday-first weeks', () => {
    const weeks = getMonthGrid(2026, 11, 'sunday');
    expect(weeks[0]?.[0]).toBe('2026-11-01');
  });
});

describe('nextDateRange', () => {
  it('sets start, then end', () => {
    const first = nextDateRange({ startDate: null, endDate: null }, '2026-11-12');
    expect(first).toEqual({ startDate: '2026-11-12', endDate: null });
    expect(nextDateRange(first, '2026-11-15')).toEqual({
      startDate: '2026-11-12',
      endDate: '2026-11-15',
    });
  });

  it('allows a same-day trip', () => {
    expect(nextDateRange({ startDate: '2026-11-12', endDate: null }, '2026-11-12')).toEqual({
      startDate: '2026-11-12',
      endDate: '2026-11-12',
    });
  });

  it('restarts when tapping before the start or after a complete range', () => {
    expect(nextDateRange({ startDate: '2026-11-12', endDate: null }, '2026-11-10')).toEqual({
      startDate: '2026-11-10',
      endDate: null,
    });
    expect(
      nextDateRange({ startDate: '2026-11-12', endDate: '2026-11-15' }, '2026-11-20'),
    ).toEqual({ startDate: '2026-11-20', endDate: null });
  });
});
