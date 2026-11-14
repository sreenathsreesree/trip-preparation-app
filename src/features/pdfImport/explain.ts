import type { ItineraryDraft } from './itinerary';

/**
 * A plain explanation of what was read and what wasn't, shown with the draft
 * (null when everything looks fine).
 */
export function explainResult(result: { pages: string[]; unreadableFonts: number }, draft: ItineraryDraft): string | null {
  const places = draft.items.filter((i) => i.kind !== 'note').length;
  const notes = draft.items.length - places;
  const emptyPages = result.pages.filter((p) => p.replace(/\s/g, '').length < 20).length;
  const parts: string[] = [];
  if (result.unreadableFonts > 0) parts.push(`Some text uses ${result.unreadableFonts === 1 ? 'a font' : 'fonts'} without a text map, so it couldn’t be read.`);
  if (emptyPages > 0 && emptyPages < result.pages.length) parts.push(`${emptyPages} of ${result.pages.length} pages have no readable text (likely images or scans).`);
  if (places === 0) parts.push(draft.days.length ? `${draft.days.length} days were found but no place names in them.` : 'No day headings, dates or place names were recognised.');
  if (notes > 0) parts.push(`${notes} ${notes === 1 ? 'line was' : 'lines were'} kept as unticked notes — tick any that are places, or change their type.`);
  return parts.length ? parts.join(' ') : null;
}
