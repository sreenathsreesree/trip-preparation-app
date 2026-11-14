import { contextLocation } from '../places/discovery';
import { ancestorIds, type PlanNode } from '../planner/model';
import type { CoverQuery } from './wikimedia';

/** The search for a destination's automatic cover: its name, the places it sits in, its region, and coordinates. */
export function nodeCoverQuery(nodes: readonly PlanNode[], node: PlanNode): CoverQuery {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const trail = ancestorIds(nodes, node.id)
    .map((id) => byId.get(id)?.name)
    .filter((n): n is string => !!n);
  const located = contextLocation(nodes, node.id);
  const wikipedia = typeof node.place?.metadata?.wikipedia === 'string' ? node.place.metadata.wikipedia : null;
  return {
    name: node.name,
    context: [...trail, node.place?.district, node.place?.state, node.place?.country].filter(Boolean).join(', '),
    location: located?.location ?? null,
    wikipedia,
  };
}
