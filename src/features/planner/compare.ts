import { formatDistance } from '../places/discovery';
import { distanceMeters } from './arrival';
import { BEST_TIME_LABELS, emptyProfile, formatMinutes, visitLength, type NodeProfile } from './companion';
import { ancestorIds, type PlanNode, type TripPlan } from './model';

/**
 * Saved-for-later, tag filters and side-by-side comparison. Only the user's own
 * information is compared; anything they haven't filled in says so.
 */

export const COMPARE_MAX = 3;

export type PlaceFilter = { kind: 'all' } | { kind: 'saved' } | { kind: 'tag'; tag: string };

export function profileFor(profiles: readonly NodeProfile[], node: PlanNode): NodeProfile {
  return profiles.find((p) => p.nodeId === node.id) ?? emptyProfile(node.id, node.tripId);
}

/** Every tag used in the trip, most used first, then alphabetical. */
export function tagsInUse(profiles: readonly NodeProfile[]): string[] {
  const counts = new Map<string, number>();
  for (const p of profiles) for (const t of p.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t]) => t);
}

/** Places in plan order (depth first) that match the filter. */
export function filterPlaces(plan: TripPlan, profiles: readonly NodeProfile[], filter: PlaceFilter): PlanNode[] {
  const ordered: PlanNode[] = [];
  const walk = (parentId: string | null) => {
    for (const node of plan.nodes.filter((n) => n.parentId === parentId).sort((a, b) => a.position - b.position)) {
      ordered.push(node);
      walk(node.id);
    }
  };
  walk(null);
  return ordered.filter((node) => {
    const profile = profileFor(profiles, node);
    if (filter.kind === 'saved') return profile.saved;
    if (filter.kind === 'tag') return profile.tags.includes(filter.tag);
    return true;
  });
}

export function trailOf(plan: TripPlan, nodeId: string): string {
  return ancestorIds(plan.nodes, nodeId)
    .reverse()
    .map((id) => plan.nodes.find((n) => n.id === id)?.name)
    .filter(Boolean)
    .join(' › ');
}

export interface CompareRow {
  key: string;
  label: string;
  values: string[];
}

const NOT_SET = '—';

/** Rows of a side-by-side comparison of the given places. */
export function compareRows(
  plan: TripPlan,
  profiles: readonly NodeProfile[],
  taskCounts: Readonly<Record<string, { done: number; total: number }>>,
  nodes: readonly PlanNode[],
): CompareRow[] {
  const ps = nodes.map((n) => profileFor(profiles, n));
  const first = nodes[0]?.place?.location ?? null;
  const row = (key: string, label: string, value: (node: PlanNode, profile: NodeProfile, index: number) => string): CompareRow => ({
    key,
    label,
    values: nodes.map((n, i) => value(n, ps[i] as NodeProfile, i)),
  });
  return [
    row('route', 'Route', (n) => {
      const i = plan.route.findIndex((s) => s.nodeId === n.id);
      return i >= 0 ? `Stop ${i + 1}` : 'Not on route';
    }),
    row('status', 'Status', (_n, p) => (p.visitStatus === 'visited' ? 'Visited' : 'Upcoming')),
    row('distance', `From ${nodes[0]?.name ?? 'first'}`, (n, _p, i) => {
      if (i === 0) return NOT_SET;
      const here = n.place?.location;
      return first && here ? `${formatDistance(distanceMeters(first, here))} (straight line)` : 'No location';
    }),
    row('time', 'Time needed', (_n, p) => (p.visitMinutes ? `${formatMinutes(p.visitMinutes)}${visitLength(p.visitMinutes) ? ` · ${visitLength(p.visitMinutes)?.label}` : ''}` : NOT_SET)),
    row('best', 'Best time', (_n, p) => (p.bestTime ? BEST_TIME_LABELS[p.bestTime] : NOT_SET)),
    row('season', 'Best season', (_n, p) => p.bestSeason || NOT_SET),
    row('fee', 'Entry fee', (_n, p) => p.entryFee || NOT_SET),
    row('prep', 'Preparation', (n) => {
      const c = taskCounts[n.id];
      return c && c.total > 0 ? `${c.done} of ${c.total} done` : NOT_SET;
    }),
    row('tags', 'Tags', (_n, p) => (p.tags.length ? p.tags.join(', ') : NOT_SET)),
  ];
}
