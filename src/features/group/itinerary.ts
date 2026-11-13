import { normalizePlaceName } from '../places/discovery';
import type { DayPlanRepository, PlannedDay } from '../planner/dayPlanRepository';
import { routeNodes, type GeoPoint, type TripPlan } from '../planner/model';
import type { PlannerRepository } from '../planner/plannerRepository';
import type { GroupItem } from './groupRepository';

/** A destination of the shared itinerary: only what the group needs to travel together. */
export interface GroupPlace {
  name: string;
  parentId: string | null;
  position: number;
  /** Index in the shared route, or null when not a route stop. */
  routePosition: number | null;
  day: number | null;
  date: string | null;
  location: GeoPoint | null;
  visited: boolean;
}

export const groupPlaceId = (nodeId: string) => `place-${nodeId}`;

/**
 * The owner's (or an editor's) plan as Group Trip itinerary items. Sends only
 * name, nesting, order, route position, planned day and coordinates — never
 * notes, memories, photos, tags, ratings or anything else private.
 */
export function planToGroupPlaces(plan: TripPlan, days: readonly PlannedDay[]): { id: string; data: GroupPlace }[] {
  const route = routeNodes(plan).map((n) => n.id);
  const dayOf = new Map(days.map((d) => [d.nodeId, d]));
  return plan.nodes.map((n) => ({
    id: groupPlaceId(n.id),
    data: {
      name: n.name,
      parentId: n.parentId ? groupPlaceId(n.parentId) : null,
      position: n.position,
      routePosition: route.includes(n.id) ? route.indexOf(n.id) : null,
      day: dayOf.get(n.id)?.dayNumber ?? null,
      date: dayOf.get(n.id)?.date ?? null,
      location: n.place?.location ?? null,
      visited: false,
    },
  }));
}

export const asGroupPlace = (item: GroupItem): GroupPlace => {
  const d = item.data as Partial<GroupPlace>;
  return {
    name: typeof d.name === 'string' ? d.name : '',
    parentId: typeof d.parentId === 'string' ? d.parentId : null,
    position: typeof d.position === 'number' ? d.position : 0,
    routePosition: typeof d.routePosition === 'number' ? d.routePosition : null,
    day: typeof d.day === 'number' ? d.day : null,
    date: typeof d.date === 'string' ? d.date : null,
    location: d.location && typeof d.location.latitude === 'number' && typeof d.location.longitude === 'number' ? d.location : null,
    visited: d.visited === true,
  };
};

/** The shared route in order, ready for Google Maps links (name + coordinates). */
export function groupRoute(items: readonly GroupItem[]): { id: string; name: string; place: { location: GeoPoint | null } | null; visited: boolean }[] {
  return items
    .filter((i) => i.kind === 'place' && !i.deleted)
    .map((i) => ({ id: i.id, p: asGroupPlace(i) }))
    .filter((x) => x.p.routePosition !== null)
    .sort((a, b) => (a.p.routePosition as number) - (b.p.routePosition as number))
    .map((x) => ({ id: x.id, name: x.p.name, place: x.p.location ? { location: x.p.location } : null, visited: x.p.visited }));
}

/**
 * Adds the shared itinerary to this member's own plan (their My Trip), only
 * adding: places with the same name are reused, nesting kept, route stops
 * appended in the shared order, planned days set. Nothing is removed.
 */
export async function copyGroupItinerary(
  tripId: string,
  items: readonly GroupItem[],
  repos: { planner: PlannerRepository; dayPlan: DayPlanRepository },
): Promise<{ added: number; reused: number }> {
  const places = items.filter((i) => i.kind === 'place' && !i.deleted).map((i) => ({ id: i.id, p: asGroupPlace(i) }));
  const plan = await repos.planner.load(tripId);
  const byName = new Map(plan.nodes.map((n) => [normalizePlaceName(n.name), n.id]));
  const mapped = new Map<string, string>();
  let added = 0;
  let reused = 0;
  // Parents before children.
  const depth = (id: string, seen = 0): number => {
    const parent = places.find((x) => x.id === id)?.p.parentId;
    return parent && seen < 20 ? 1 + depth(parent, seen + 1) : 0;
  };
  const ordered = [...places].sort((a, b) => depth(a.id) - depth(b.id) || (a.p.routePosition ?? 1e9) - (b.p.routePosition ?? 1e9) || a.p.position - b.p.position);
  for (const { id, p } of ordered) {
    if (!p.name.trim()) continue;
    const existing = byName.get(normalizePlaceName(p.name));
    if (existing) {
      mapped.set(id, existing);
      reused += 1;
      continue;
    }
    const parentId = p.parentId ? (mapped.get(p.parentId) ?? null) : null;
    const result = await repos.planner.addNode(tripId, {
      name: p.name.trim(),
      parentId,
      addToRoute: p.routePosition !== null,
      place: p.location ? { provider: 'manual', providerPlaceId: null, name: p.name.trim(), location: p.location } : null,
    });
    mapped.set(id, result.node.id);
    byName.set(normalizePlaceName(p.name), result.node.id);
    if (p.day !== null || p.date) await repos.dayPlan.set(tripId, result.node.id, { dayNumber: p.day, date: p.date });
    added += 1;
  }
  return { added, reused };
}
