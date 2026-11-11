import type { Database } from '../src/db/types';
import { PLANNER_LIMITS } from '../src/features/planner/model';

interface NodeRow {
  id: string;
  trip_id: string;
  parent_id: string | null;
  place_id: string | null;
  trip_destination_id: string | null;
  name: string;
  position: number;
}

/**
 * Structural invariants of a trip's plan, checked straight from SQL. Returns
 * a list of violations (empty when healthy) so failures say exactly what broke.
 */
export async function planViolations(db: Database, tripId: string): Promise<string[]> {
  const issues: string[] = [];
  const nodes = await db.getAllAsync<NodeRow>('SELECT * FROM trip_plan_nodes WHERE trip_id = ?', [tripId]);
  const byId = new Map(nodes.map((n) => [n.id, n]));

  // Parents exist in the same trip; no cycles; depth within the limit.
  for (const node of nodes) {
    if (node.parent_id && !byId.has(node.parent_id)) issues.push(`node ${node.name}: parent outside the trip`);
    let depth = 0;
    let current = node.parent_id ? byId.get(node.parent_id) : undefined;
    while (current) {
      depth += 1;
      if (depth > nodes.length) {
        issues.push(`node ${node.name}: cycle`);
        break;
      }
      current = current.parent_id ? byId.get(current.parent_id) : undefined;
    }
    if (depth >= PLANNER_LIMITS.maxDepth) issues.push(`node ${node.name}: depth ${depth} over the limit`);
  }

  // Sibling positions are exactly 0..n-1.
  const groups = new Map<string, number[]>();
  for (const node of nodes) {
    const key = node.parent_id ?? '(root)';
    groups.set(key, [...(groups.get(key) ?? []), node.position]);
  }
  for (const [parent, positions] of groups) {
    const sorted = [...positions].sort((a, b) => a - b);
    if (sorted.some((p, i) => p !== i)) issues.push(`siblings of ${parent}: positions ${sorted.join(',')}`);
  }

  // A place at most once per trip.
  const places = nodes.flatMap((n) => (n.place_id ? [n.place_id] : []));
  if (new Set(places).size !== places.length) issues.push('a place appears twice');

  // Route: contiguous positions, unique stops, all in this trip.
  const route = await db.getAllAsync<{ node_id: string; position: number; node_trip: string | null }>(
    `SELECT s.node_id, s.position, n.trip_id AS node_trip FROM trip_route_stops s
     LEFT JOIN trip_plan_nodes n ON n.id = s.node_id WHERE s.trip_id = ? ORDER BY s.position`,
    [tripId],
  );
  if (route.some((s, i) => s.position !== i)) issues.push(`route positions ${route.map((s) => s.position).join(',')}`);
  if (new Set(route.map((s) => s.node_id)).size !== route.length) issues.push('route stop repeated');
  if (route.some((s) => s.node_trip !== tripId)) issues.push('route stop from another trip or missing node');

  // One destination system: trip destinations are exactly the main destinations, in order.
  const roots = nodes.filter((n) => !n.parent_id).sort((a, b) => a.position - b.position);
  const destinations = await db.getAllAsync<{ id: string; name: string; position: number }>(
    'SELECT id, name, position FROM trip_destinations WHERE trip_id = ? ORDER BY position',
    [tripId],
  );
  const rootNames = roots.map((r) => r.name);
  const destinationNames = destinations.map((d) => d.name);
  if (JSON.stringify(rootNames) !== JSON.stringify(destinationNames)) {
    issues.push(`destinations [${destinationNames.join(', ')}] ≠ main destinations [${rootNames.join(', ')}]`);
  }
  if (destinations.some((d, i) => d.position !== i)) issues.push('destination positions not contiguous');
  roots.forEach((root, i) => {
    if (root.trip_destination_id !== destinations[i]?.id) issues.push(`main destination ${root.name} not linked to its row`);
  });
  if (nodes.some((n) => n.parent_id && n.trip_destination_id)) issues.push('a nested place is linked to a destination');
  const legacy = await db.getFirstAsync<{ destination: string }>('SELECT destination FROM trips WHERE id = ?', [tripId]);
  if (legacy && legacy.destination !== (rootNames[0] ?? '')) issues.push(`legacy destination "${legacy.destination}"`);
  return issues;
}

/** Rows anywhere in the database that point at something that no longer exists. */
export async function orphanCounts(db: Database) {
  const count = async (sql: string) => Number((await db.getFirstAsync<{ n: number }>(sql, []))?.n ?? 0);
  return {
    nodes: await count('SELECT COUNT(*) AS n FROM trip_plan_nodes n WHERE NOT EXISTS (SELECT 1 FROM trips t WHERE t.id = n.trip_id)'),
    nestedOrphans: await count(
      'SELECT COUNT(*) AS n FROM trip_plan_nodes n WHERE n.parent_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM trip_plan_nodes p WHERE p.id = n.parent_id)',
    ),
    routeStops: await count(
      'SELECT COUNT(*) AS n FROM trip_route_stops s WHERE NOT EXISTS (SELECT 1 FROM trip_plan_nodes n WHERE n.id = s.node_id AND n.trip_id = s.trip_id)',
    ),
    destinations: await count('SELECT COUNT(*) AS n FROM trip_destinations d WHERE NOT EXISTS (SELECT 1 FROM trips t WHERE t.id = d.trip_id)'),
  };
}
