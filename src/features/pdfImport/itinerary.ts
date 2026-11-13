import { normalizePlaceName } from '../places/discovery';

/**
 * Turns itinerary text (from a PDF, or pasted) into an editable draft. Pure and
 * rule-based, on the device: day headers ("Day 2 – Munnar"), dates, times and
 * keywords decide what each line is. Not everything mentioned is a
 * destination: the day's main place is the destination; the rest becomes
 * attractions, hotels, restaurants or transport under it, or a note. The user
 * reviews and corrects the draft before anything is added to the trip.
 */
export type DraftKind = 'destination' | 'attraction' | 'hotel' | 'restaurant' | 'transport' | 'note';

export interface DraftItem {
  key: string;
  day: number | null;
  date: string | null;
  kind: DraftKind;
  name: string;
  time: string | null;
  detail: string;
  include: boolean;
  /** Existing place in the trip this matches (exact name, or likely and to be confirmed). */
  match: { nodeId: string; name: string; certainty: 'exact' | 'likely' } | null;
  /** For a match: reuse the existing place (default) or add a new one. */
  reuse: boolean;
}

export interface ItineraryDraft {
  tripName: string | null;
  startDate: string | null;
  endDate: string | null;
  days: { number: number; date: string | null; destination: string | null; title: string }[];
  items: DraftItem[];
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const WORD_NUMBERS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const pad = (n: number) => String(n).padStart(2, '0');

/** Dates in a line, as YYYY-MM-DD ("21 Nov 2026", "Nov 21, 2026", "2026-11-21", "21/11/2026"). */
export function findDates(line: string, fallbackYear: number | null = null): string[] {
  const out: string[] = [];
  for (const m of line.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) out.push(`${m[1]}-${m[2]}-${m[3]}`);
  for (const m of line.matchAll(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?,?\s*(\d{4})?/gi)) {
    const y = m[3] ? Number(m[3]) : fallbackYear;
    if (y) out.push(`${y}-${pad(MONTHS[(m[2] as string).toLowerCase()] as number)}-${pad(Number(m[1]))}`);
  }
  for (const m of line.matchAll(/\b(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?!\d)(?:st|nd|rd|th)?,?\s*(\d{4})?/gi)) {
    const y = m[3] ? Number(m[3]) : fallbackYear;
    if (y) out.push(`${y}-${pad(MONTHS[(m[1] as string).toLowerCase()] as number)}-${pad(Number(m[2]))}`);
  }
  for (const m of line.matchAll(/\b(\d{1,2})[/.](\d{1,2})[/.](\d{4})\b/g)) out.push(`${m[3]}-${pad(Number(m[2]))}-${pad(Number(m[1]))}`);
  // In order of appearance, each once.
  const valid = out.filter((d) => !Number.isNaN(Date.parse(`${d}T00:00:00Z`)));
  const positions = new Map(valid.map((d) => [d, Math.min(...[line.indexOf(d.slice(8).replace(/^0/, '')), Number.MAX_SAFE_INTEGER].filter((x) => x >= 0))]));
  return [...new Set(valid)].sort((a, b) => (positions.get(a) ?? 0) - (positions.get(b) ?? 0));
}

const DAY_HEADER = /^\s*(?:day|d)\s*[-–:.]?\s*(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)\b\s*[-–—:.)]*\s*(.*)$/i;
const TIME = /\b(\d{1,2}[:.]\d{2}\s*(?:am|pm|hrs)?|\d{1,2}\s*(?:am|pm))\b/i;

const KIND_RULES: [DraftKind, RegExp][] = [
  ['hotel', /\b(hotel|resort|homestay|home stay|stay|check[- ]?in|check[- ]?out|lodge|villa|inn|accommodation|overnight|houseboat|cottage|guest ?house)\b/i],
  ['restaurant', /\b(restaurant|cafe|café|lunch|dinner|breakfast|dine|dining|eatery|bhavan|dhaba|bakery)\b/i],
  // Sights before transport: "Top Station viewpoint" is a viewpoint, "Railway Station" is transport.
  ['attraction', /\b(falls?|waterfalls?|dam|lake|point|view ?point|park|temple|church|mosque|fort|palace|museum|beach|garden|estate|plantation|hills?|peak|sanctuary|island|caves?|backwaters?|boating|trek|market|monument|valley|reserve|zoo|gallery)\b/i],
  ['transport', /\b(airport|railway|station|bus stand|bus station|terminal|ferry|jetty|pick ?up|drop|depart(?:ure)?|arriv(?:e|al)|flight|train|transfer)\b/i],
];

export function classify(text: string): DraftKind {
  for (const [kind, re] of KIND_RULES) if (re.test(text)) return kind;
  return 'note';
}

const LEAD = /^(?:visit(?:ing)?|explore|proceed to|drive to|go to|head to|check[- ]?in (?:at|to)|check[- ]?out (?:from|of)|stay at|overnight (?:stay )?(?:at|in|on)|lunch at|dinner at|breakfast at|pick ?up from|drop (?:at|to)|transfer to|arrive (?:at|in)|depart(?:ure)? from|morning:?|afternoon:?|evening:?|night:?|then)\s+/i;

/** A place name from a line: without times, leading verbs, bullets and trailing remarks. */
export function placeName(text: string): string {
  let t = text.replace(TIME, ' ').replace(/^[\s•\-*–·\d.)]+/, '').trim();
  for (let i = 0; i < 3; i++) t = t.replace(LEAD, '').trim();
  t = t.replace(/\s*\((?:[^)]*)\)\s*$/, '').replace(/\s+(?:en route|on the way|optional)$/i, '').replace(/[.:;]+$/, '').trim();
  // "Tea County Resort, Munnar" → keep the place, not its town.
  t = (t.split(/,\s+/)[0] ?? t).replace(/^the\s+/i, '');
  return t.slice(0, 80).trim();
}

/** "Kochi to Munnar" → Munnar (where the day ends); "Munnar" → Munnar; "Departure" → null. */
export function dayDestination(title: string): string | null {
  const t = title.replace(/\(.*?\)/g, '').replace(TIME, '').trim();
  if (!t || /^(departure|arrival|return|leisure|free day|at leisure|day out)$/i.test(t)) return null;
  const to = t.split(/\s+(?:to|→|->|–>|-)\s+/i);
  const last = (to[to.length - 1] ?? '').split(/[,&/]| and /i)[0]?.trim() ?? '';
  return last && !/^\d/.test(last) && last.length <= 60 ? last : null;
}

export function parseItinerary(text: string): ItineraryDraft {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const allDates = lines.flatMap((l) => findDates(l));
  const year = allDates[0] ? Number(allDates[0].slice(0, 4)) : null;
  const draft: ItineraryDraft = { tripName: null, startDate: null, endDate: null, days: [], items: [] };
  let n = 0;
  const key = () => `d${++n}`;
  let day: ItineraryDraft['days'][number] | null = null;
  let destinationName: string | null = null;

  for (const [index, line] of lines.entries()) {
    const header = DAY_HEADER.exec(line);
    if (header) {
      const number = /^\d+$/.test(header[1] as string) ? Number(header[1]) : (WORD_NUMBERS[(header[1] as string).toLowerCase()] ?? draft.days.length + 1);
      const title = (header[2] ?? '').trim();
      const date = findDates(title, year)[0] ?? null;
      const dest = dayDestination(title);
      day = { number, date, destination: dest, title };
      draft.days.push(day);
      if (dest) {
        destinationName = dest;
        if (!draft.items.some((i) => i.kind === 'destination' && normalizePlaceName(i.name) === normalizePlaceName(dest))) {
          draft.items.push({ key: key(), day: number, date, kind: 'destination', name: dest, time: null, detail: title, include: true, match: null, reuse: true });
        }
      }
      continue;
    }
    if (!day) {
      // Before the first day: trip name (first short line) and trip dates.
      const dates = findDates(line, year);
      if (dates.length >= 1 && !draft.startDate) {
        draft.startDate = dates[0] ?? null;
        draft.endDate = dates[dates.length - 1] ?? null;
      } else if (index < 3 && !draft.tripName && line.length <= 60 && !dates.length) draft.tripName = line;
      continue;
    }
    if (/^(time|plan|activity|schedule|details|description)( (time|plan|activity|schedule|details))*$/i.test(line)) continue;
    const time = TIME.exec(line)?.[0]?.trim() ?? null;
    const rest = line.replace(TIME, '').trim();
    if (!rest) continue;
    if (/^(note|notes|tip|remarks?)\s*[:-]/i.test(rest)) {
      draft.items.push({ key: key(), day: day.number, date: day.date, kind: 'note', name: rest.replace(/^(note|notes|tip|remarks?)\s*[:-]\s*/i, ''), time, detail: '', include: false, match: null, reuse: true });
      continue;
    }
    // "Mattupetty Dam and Echo Point" → two places.
    const parts = rest
      .replace(/^(?:evening|morning|afternoon|night)\s*:\s*/i, '')
      .split(/\s+(?:and|&)\s+|;\s*/i)
      .map((p) => p.trim())
      .filter(Boolean);
    const kindOfLine = classify(rest);
    for (const part of parts) {
      const kind = classify(part) === 'note' ? kindOfLine : classify(part);
      const name = kind === 'note' ? rest : placeName(part);
      if (!name || name.length < 3) continue;
      if (kind === 'note' && parts.length > 1 && part !== parts[0]) continue;
      const dup = draft.items.find((i) => i.kind !== 'note' && normalizePlaceName(i.name) === normalizePlaceName(name));
      if (dup) continue;
      draft.items.push({
        key: key(),
        day: day.number,
        date: day.date,
        kind,
        name,
        time,
        detail: line,
        include: kind === 'attraction' || kind === 'hotel' || kind === 'restaurant',
        match: null,
        reuse: true,
      });
    }
    void destinationName;
  }
  // Days without their own date: counted from a day that has one, else from the trip start.
  const anchor = draft.days.find((d) => d.date);
  const shift = (date: string, days: number) => {
    const d = new Date(`${date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  };
  for (const d of draft.days) {
    if (d.date) continue;
    if (anchor?.date) d.date = shift(anchor.date, d.number - anchor.number);
    else if (draft.startDate) d.date = shift(draft.startDate, d.number - 1);
  }
  const dateOf = new Map(draft.days.map((d) => [d.number, d.date]));
  draft.items = draft.items.map((i) => (i.day !== null && !i.date ? { ...i, date: dateOf.get(i.day) ?? null } : i));
  return draft;
}

/** Marks draft places that already exist in the trip: same name (exact) or one name containing the other (likely, to confirm). */
export function matchExisting(draft: ItineraryDraft, existing: readonly { id: string; name: string }[]): ItineraryDraft {
  const items = draft.items.map((item) => {
    if (item.kind === 'note') return item;
    const name = normalizePlaceName(item.name);
    const exact = existing.find((e) => normalizePlaceName(e.name) === name);
    if (exact) return { ...item, match: { nodeId: exact.id, name: exact.name, certainty: 'exact' as const }, reuse: true };
    const likely = existing.find((e) => {
      const other = normalizePlaceName(e.name);
      return other.length >= 4 && name.length >= 4 && (other.includes(name) || name.includes(other));
    });
    return likely ? { ...item, match: { nodeId: likely.id, name: likely.name, certainty: 'likely' as const }, reuse: false } : { ...item, match: null };
  });
  return { ...draft, items };
}
