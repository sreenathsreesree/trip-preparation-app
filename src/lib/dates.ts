/**
 * Calendar-date helpers.
 *
 * Trip dates are calendar days, not instants, so they are stored as ISO
 * `YYYY-MM-DD` strings and compared without time zones. Day arithmetic uses
 * UTC internally to stay correct across daylight-saving changes.
 */

export type ISODate = string;

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

const MONTHS_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

const MONTHS_LONG = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

const WEEKDAYS_LONG = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

interface DateParts {
  year: number;
  /** 1-based month. */
  month: number;
  day: number;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function parts(iso: ISODate): DateParts {
  const match = ISO_DATE_PATTERN.exec(iso);
  if (!match) {
    throw new RangeError(`Invalid ISO date: "${iso}"`);
  }
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

function toUtcMs(iso: ISODate): number {
  const { year, month, day } = parts(iso);
  return Date.UTC(year, month - 1, day);
}

function fromUtcMs(ms: number): ISODate {
  const date = new Date(ms);
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

export function isValidISODate(value: unknown): value is ISODate {
  if (typeof value !== 'string' || !ISO_DATE_PATTERN.test(value)) {
    return false;
  }
  const { year, month, day } = parts(value);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

/** Local calendar date for a JS Date (defaults to now). */
export function toISODate(date: Date = new Date()): ISODate {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function todayISO(): ISODate {
  return toISODate(new Date());
}

export function addDays(iso: ISODate, days: number): ISODate {
  return fromUtcMs(toUtcMs(iso) + days * MS_PER_DAY);
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function diffInDays(from: ISODate, to: ISODate): number {
  return Math.round((toUtcMs(to) - toUtcMs(from)) / MS_PER_DAY);
}

/** Inclusive number of calendar days a trip spans. */
export function inclusiveDayCount(start: ISODate, end: ISODate): number {
  return diffInDays(start, end) + 1;
}

export function compareISODates(a: ISODate, b: ISODate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function formatDate(iso: ISODate, options: { withYear?: boolean } = {}): string {
  const { year, month, day } = parts(iso);
  const base = `${day} ${MONTHS_SHORT[month - 1]}`;
  return options.withYear ? `${base} ${year}` : base;
}

export function formatDateLong(iso: ISODate): string {
  const { year, month, day } = parts(iso);
  const weekday = WEEKDAYS_LONG[new Date(toUtcMs(iso)).getUTCDay()];
  return `${weekday} ${day} ${MONTHS_LONG[month - 1]} ${year}`;
}

/** "12 – 15 Nov 2026", "28 Nov – 2 Dec 2026", "30 Dec 2026 – 3 Jan 2027". */
export function formatDateRange(start: ISODate, end: ISODate): string {
  const a = parts(start);
  const b = parts(end);
  if (start === end) {
    return formatDate(start, { withYear: true });
  }
  if (a.year !== b.year) {
    return `${formatDate(start, { withYear: true })} – ${formatDate(end, { withYear: true })}`;
  }
  if (a.month !== b.month) {
    return `${formatDate(start)} – ${formatDate(end, { withYear: true })}`;
  }
  return `${a.day} – ${formatDate(end, { withYear: true })}`;
}

export function formatMonthYear(year: number, month: number): string {
  return `${MONTHS_LONG[month - 1]} ${year}`;
}

export function getMonthOf(iso: ISODate): { year: number; month: number } {
  const { year, month } = parts(iso);
  return { year, month };
}

export function shiftMonth(
  year: number,
  month: number,
  delta: number,
): { year: number; month: number } {
  const index = year * 12 + (month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

export type WeekStart = 'monday' | 'sunday';

export const WEEKDAY_INITIALS: Record<WeekStart, readonly string[]> = {
  monday: ['M', 'T', 'W', 'T', 'F', 'S', 'S'],
  sunday: ['S', 'M', 'T', 'W', 'T', 'F', 'S'],
};

/**
 * Calendar grid for a month: an array of weeks, each with 7 cells holding an
 * ISO date or `null` for leading/trailing padding.
 */
export function getMonthGrid(
  year: number,
  month: number,
  weekStart: WeekStart = 'monday',
): (ISODate | null)[][] {
  const first = `${year}-${pad(month)}-01`;
  const firstWeekday = new Date(toUtcMs(first)).getUTCDay(); // 0 = Sunday
  const leading = weekStart === 'monday' ? (firstWeekday + 6) % 7 : firstWeekday;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();

  const cells: (ISODate | null)[] = Array.from({ length: leading }, () => null);
  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push(`${year}-${pad(month)}-${pad(day)}`);
  }
  while (cells.length % 7 !== 0) {
    cells.push(null);
  }

  const weeks: (ISODate | null)[][] = [];
  for (let index = 0; index < cells.length; index += 7) {
    weeks.push(cells.slice(index, index + 7));
  }
  return weeks;
}

export interface DateRange {
  startDate: ISODate | null;
  endDate: ISODate | null;
}

/**
 * Range selection rule for calendar taps: the first tap sets the start, the
 * second sets the end. Tapping before the current start, or after a complete
 * range, restarts the selection from the tapped day.
 */
export function nextDateRange(current: DateRange, tapped: ISODate): DateRange {
  const { startDate, endDate } = current;
  if (!startDate || endDate || tapped < startDate) {
    return { startDate: tapped, endDate: null };
  }
  return { startDate, endDate: tapped };
}
