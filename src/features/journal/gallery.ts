/**
 * The photo gallery: every journal and Memories photo of the account's trips,
 * newest trip first, each trip's photos in the order they were taken (by the
 * entry or visit date). Pure helpers; the query is in galleryRepository.ts.
 */
export interface GalleryPhoto {
  /** Stable key: one photo can appear in only one place. */
  key: string;
  uri: string;
  tripId: string;
  tripName: string;
  tripStart: string;
  /** YYYY-MM-DD (entry date, visit date, or when it was added). */
  date: string;
  source: 'journal' | 'memory';
  caption: string;
  /** Destination name for Memories photos. */
  place: string | null;
  /** The destination the Memories photo belongs to (null for journal photos). */
  nodeId?: string | null;
}

export interface GallerySection {
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

/** Groups by trip, optionally split further by day. The flat order of the sections is the swipe order of the viewer. */
export function groupGallery(photos: readonly GalleryPhoto[], options: { byDate?: boolean } = {}): GallerySection[] {
  // Stable sort: photos of the same day keep the order they were added in.
  const sorted = [...photos].sort((a, b) => b.tripStart.localeCompare(a.tripStart) || a.tripId.localeCompare(b.tripId) || a.date.localeCompare(b.date));
  const sections: GallerySection[] = [];
  for (const photo of sorted) {
    const key = options.byDate ? `${photo.tripId}|${photo.date}` : photo.tripId;
    let section = sections[sections.length - 1];
    if (!section || section.key !== key) {
      section = { key, title: photo.tripName, subtitle: options.byDate ? dayLabel(photo.date) : '', photos: [] };
      sections.push(section);
    }
    section.photos.push(photo);
  }
  for (const s of sections) if (!options.byDate) s.subtitle = `${s.photos.length} ${s.photos.length === 1 ? 'photo' : 'photos'}`;
  return sections;
}

/** Columns for the thumbnail grid: 2 on narrow phones, 3 on most phones, more on tablets. */
export function galleryColumns(width: number): number {
  if (width < 360) return 2;
  if (width < 700) return 3;
  return Math.min(6, Math.floor(width / 200));
}

/** Grid rows (for a virtualised list): a header row per section, then rows of `columns` photos. */
export type GalleryRow =
  | { kind: 'header'; key: string; title: string; subtitle: string }
  | { kind: 'photos'; key: string; photos: { photo: GalleryPhoto; index: number }[] };

export function galleryRows(sections: readonly GallerySection[], columns: number): GalleryRow[] {
  const rows: GalleryRow[] = [];
  let index = 0;
  for (const section of sections) {
    rows.push({ kind: 'header', key: `h:${section.key}`, title: section.title, subtitle: section.subtitle });
    for (let i = 0; i < section.photos.length; i += columns) {
      const chunk = section.photos.slice(i, i + columns).map((photo) => ({ photo, index: index++ }));
      rows.push({ kind: 'photos', key: `r:${section.key}:${i}`, photos: chunk });
    }
  }
  return rows;
}
