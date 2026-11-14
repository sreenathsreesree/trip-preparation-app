import type { GalleryPhoto } from '../journal/gallery';

export interface PhotoGroup {
  key: string;
  title: string;
  subtitle: string;
  photos: GalleryPhoto[];
}

const DAY = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const dayLabel = (date: string) => {
  const d = new Date(`${date}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? date : DAY.format(d);
};

/**
 * A trip's photos grouped by destination (in the plan's order, journal photos
 * last), each group in date order with its date range as the subtitle.
 */
export function groupByPlace(photos: readonly GalleryPhoto[], destinationOrder: readonly string[]): PhotoGroup[] {
  const groups = new Map<string, PhotoGroup>();
  for (const p of [...photos].sort((a, b) => a.date.localeCompare(b.date))) {
    const key = p.nodeId ? `n:${p.nodeId}` : 'journal';
    let g = groups.get(key);
    if (!g) {
      g = { key, title: p.nodeId ? (p.place ?? 'Destination') : 'Journal', subtitle: '', photos: [] };
      groups.set(key, g);
    }
    g.photos.push(p);
  }
  const rank = (g: PhotoGroup) => {
    if (g.key === 'journal') return Number.MAX_SAFE_INTEGER;
    const i = destinationOrder.indexOf(g.key.slice(2));
    return i < 0 ? Number.MAX_SAFE_INTEGER - 1 : i;
  };
  const out = [...groups.values()].sort((a, b) => rank(a) - rank(b) || a.title.localeCompare(b.title));
  for (const g of out) {
    const first = g.photos[0]?.date ?? '';
    const last = g.photos[g.photos.length - 1]?.date ?? '';
    const n = g.photos.length;
    g.subtitle = `${n} ${n === 1 ? 'photo' : 'photos'}${first ? ` · ${first === last ? dayLabel(first) : `${dayLabel(first)} – ${dayLabel(last)}`}` : ''}`;
  }
  return out;
}

/** Photos grouped by day, oldest first. */
export function groupByDay(photos: readonly GalleryPhoto[]): PhotoGroup[] {
  const groups = new Map<string, PhotoGroup>();
  for (const p of [...photos].sort((a, b) => a.date.localeCompare(b.date))) {
    let g = groups.get(p.date);
    if (!g) {
      g = { key: `d:${p.date}`, title: dayLabel(p.date), subtitle: '', photos: [] };
      groups.set(p.date, g);
    }
    g.photos.push(p);
  }
  const out = [...groups.values()];
  for (const g of out) {
    const places = [...new Set(g.photos.map((p) => p.place).filter((x): x is string => !!x))];
    g.subtitle = `${g.photos.length} ${g.photos.length === 1 ? 'photo' : 'photos'}${places.length ? ` · ${places.slice(0, 3).join(', ')}` : ''}`;
  }
  return out;
}
