import { placeLink } from '../places/mapsLinks';
import { BEST_TIME_LABELS, formatMinutes, type NodeProfile } from './companion';
import type { PlanNode } from './model';

/**
 * Plain-text summary of a destination for the system share sheet. Only the
 * user's own information and the map link; nothing private like memories.
 */
export function destinationShareText(node: PlanNode, profile: NodeProfile, trail: readonly string[]): string {
  const lines = [node.name];
  if (trail.length > 0) lines.push(trail.join(' › '));
  if (node.place?.formattedAddress) lines.push(node.place.formattedAddress);
  if (profile.about) lines.push('', profile.about);
  const facts = [
    profile.bestSeason ? `Best season: ${profile.bestSeason}` : null,
    profile.bestTime ? `Best time: ${BEST_TIME_LABELS[profile.bestTime]}` : null,
    profile.visitMinutes ? `Plan for: ${formatMinutes(profile.visitMinutes)}` : null,
    profile.entryFee ? `Entry: ${profile.entryFee}` : null,
  ].filter((v): v is string => v !== null);
  if (facts.length > 0) lines.push('', ...facts);
  if (profile.tags.length > 0) lines.push('', profile.tags.map((t) => `#${t.replace(/\s+/g, '')}`).join(' '));
  lines.push('', placeLink(node).url);
  return lines.join('\n');
}
