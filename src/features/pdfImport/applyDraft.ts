import { normalizePlaceName } from '../places/discovery';
import type { CompanionRepository } from '../planner/companionRepository';
import type { DayPlanRepository } from '../planner/dayPlanRepository';
import type { PlannerRepository } from '../planner/plannerRepository';
import type { ItineraryDraft } from './itinerary';

export interface ImportSummary {
  destinations: number;
  places: number;
  reused: number;
  notes: number;
  skipped: number;
}

/**
 * Adds a confirmed draft to the trip, only adding: each day's main
 * destination (reused when it matches one the user kept), the day's places
 * under it, the day each one is planned for, and notes on the day's
 * destination. Existing places, routes and notes are never changed or removed.
 */
export async function applyDraft(
  tripId: string,
  draft: ItineraryDraft,
  repos: { planner: PlannerRepository; companion: CompanionRepository; dayPlan: DayPlanRepository },
): Promise<ImportSummary> {
  const summary: ImportSummary = { destinations: 0, places: 0, reused: 0, notes: 0, skipped: 0 };
  // Names already in the plan (and those added by this import) are reused, never added twice.
  const existing = (await repos.planner.load(tripId)).nodes;
  const created = new Map<string, string>(existing.map((n) => [normalizePlaceName(n.name), n.id]));
  const dayNode = new Map<number, string>();

  const place = async (name: string, parentId: string | null, isDestination: boolean, match: { nodeId: string } | null, reuse: boolean) => {
    if (match && reuse) {
      summary.reused += 1;
      return match.nodeId;
    }
    const key = normalizePlaceName(name);
    const again = created.get(key);
    if (again) {
      if (existing.some((n) => n.id === again)) summary.reused += 1;
      return again;
    }
    const result = await repos.planner.addNode(tripId, { name, parentId, addToRoute: isDestination });
    created.set(key, result.node.id);
    if (result.status === 'duplicate') summary.reused += 1;
    else if (isDestination) summary.destinations += 1;
    else summary.places += 1;
    return result.node.id;
  };

  const included = draft.items.filter((i) => i.include && i.name.trim());
  summary.skipped = draft.items.length - included.length;
  for (const item of included.filter((i) => i.kind === 'destination')) {
    const id = await place(item.name.trim(), null, true, item.match, item.reuse);
    if (item.day !== null && !dayNode.has(item.day)) dayNode.set(item.day, id);
    await repos.dayPlan.set(tripId, id, { date: item.date, dayNumber: item.day });
  }
  // Days without their own destination belong to the previous day's.
  let last: string | null = null;
  for (const d of [...draft.days].sort((a, b) => a.number - b.number)) {
    const id = dayNode.get(d.number);
    if (id) last = id;
    else if (last) dayNode.set(d.number, last);
  }
  for (const item of included.filter((i) => i.kind !== 'destination')) {
    const parent = item.day !== null ? (dayNode.get(item.day) ?? null) : null;
    if (item.kind === 'note') {
      if (!parent) {
        summary.skipped += 1;
        continue;
      }
      await repos.companion.addNote(parent, { kind: 'other', body: item.name.trim().slice(0, 2000) });
      summary.notes += 1;
      continue;
    }
    const id = await place(item.name.trim(), parent, false, item.match, item.reuse);
    await repos.dayPlan.set(tripId, id, { date: item.date, dayNumber: item.day });
  }
  return summary;
}
