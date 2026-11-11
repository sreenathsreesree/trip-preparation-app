/**
 * Destination planner domain.
 *
 * Two separate structures per trip:
 * - the **plan tree** (`PlanNode`): how the user organises places — main
 *   destinations with places inside them, nested as deep as needed;
 * - the **route** (`RouteStop`): an explicitly chosen, ordered subset of
 *   nodes to travel through. Nesting never implies a route.
 */

export type PlaceProviderId = 'google' | 'manual';

export interface GeoPoint {
  latitude: number;
  longitude: number;
}

/** A place from a search provider (or entered by hand), shared across trips. */
export interface Place {
  id: string;
  provider: PlaceProviderId;
  /** The provider's stable id (e.g. Google Place ID); null for manual places. */
  providerPlaceId: string | null;
  name: string;
  location: GeoPoint | null;
  formattedAddress: string;
  types: string[];
  district: string | null;
  state: string | null;
  country: string | null;
  /** Provider extras kept within the provider's caching policy. */
  metadata: Record<string, unknown>;
  /** When provider content was last fetched; null if never (manual). */
  fetchedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PlaceInput {
  provider: PlaceProviderId;
  providerPlaceId: string | null;
  name: string;
  location?: GeoPoint | null;
  formattedAddress?: string;
  types?: readonly string[];
  district?: string | null;
  state?: string | null;
  country?: string | null;
  metadata?: Record<string, unknown>;
}

/** `trip`: mirrors one of the trip's destinations; `planner`: added in the planner. */
export type NodeOrigin = 'trip' | 'planner';

export interface PlanNode {
  id: string;
  tripId: string;
  parentId: string | null;
  placeId: string | null;
  place: Place | null;
  /** Set while this node is one of the trip's destinations (shown on trip cards). */
  tripDestinationId: string | null;
  origin: NodeOrigin;
  /** The user's label for this place; always available offline. */
  name: string;
  notes: string;
  position: number;
  createdAt: string;
  updatedAt: string;
}

export interface RouteStop {
  id: string;
  tripId: string;
  nodeId: string;
  position: number;
}

export interface TripPlan {
  nodes: PlanNode[];
  route: RouteStop[];
}

export const PLANNER_LIMITS = {
  /** Deep enough for region › town › area › attraction › spot and more; keeps rows readable. */
  maxDepth: 12,
  nameMax: 120,
  notesMax: 2000,
  nodesPerTrip: 1000,
} as const;

export const isPlaceProvider = (v: unknown): v is PlaceProviderId => v === 'google' || v === 'manual';

/* ------------------------------------------------------------------ */
/* Tree helpers (pure)                                                 */
/* ------------------------------------------------------------------ */

export interface PlanTreeNode {
  node: PlanNode;
  depth: number;
  children: PlanTreeNode[];
}

const bySiblingOrder = (a: PlanNode, b: PlanNode) =>
  a.position - b.position || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);

export function childrenOf(nodes: readonly PlanNode[], parentId: string | null): PlanNode[] {
  return nodes.filter((n) => n.parentId === parentId).sort(bySiblingOrder);
}

/** Nested tree of a trip's nodes. Nodes whose parent is missing are treated as roots. */
export function buildTree(nodes: readonly PlanNode[]): PlanTreeNode[] {
  const ids = new Set(nodes.map((n) => n.id));
  const byParent = new Map<string | null, PlanNode[]>();
  for (const node of nodes) {
    const key = node.parentId && ids.has(node.parentId) ? node.parentId : null;
    byParent.set(key, [...(byParent.get(key) ?? []), node]);
  }
  const visited = new Set<string>();
  const build = (parentId: string | null, depth: number): PlanTreeNode[] =>
    (byParent.get(parentId) ?? [])
      .sort(bySiblingOrder)
      .filter((node) => !visited.has(node.id))
      .map((node) => {
        visited.add(node.id);
        return { node, depth, children: build(node.id, depth + 1) };
      });
  return build(null, 0);
}

/** Ids from the node up to its root (nearest first), excluding the node itself. */
export function ancestorIds(nodes: readonly PlanNode[], id: string): string[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const result: string[] = [];
  let current = byId.get(id)?.parentId ?? null;
  while (current && !result.includes(current)) {
    result.push(current);
    current = byId.get(current)?.parentId ?? null;
  }
  return result;
}

/** The node and everything nested below it. */
export function subtreeIds(nodes: readonly PlanNode[], id: string): string[] {
  const result = [id];
  for (let i = 0; i < result.length; i += 1) {
    for (const node of nodes) {
      if (node.parentId === result[i] && !result.includes(node.id)) result.push(node.id);
    }
  }
  return result;
}

/** 0 for a main destination, 1 for a place inside it, and so on. */
export const depthOf = (nodes: readonly PlanNode[], id: string) => ancestorIds(nodes, id).length;

/** Levels in the subtree below a node (0 when it has no children). */
export function subtreeHeight(nodes: readonly PlanNode[], id: string): number {
  const children = nodes.filter((n) => n.parentId === id);
  return children.length === 0 ? 0 : 1 + Math.max(...children.map((c) => subtreeHeight(nodes, c.id)));
}

export type MoveCheck = { ok: true } | { ok: false; reason: string };

/** Whether `id` (with its subtree) may be placed under `parentId` (null = main destination). */
export function canMove(nodes: readonly PlanNode[], id: string, parentId: string | null): MoveCheck {
  if (parentId === null) return { ok: true };
  if (parentId === id) return { ok: false, reason: 'A place cannot be inside itself.' };
  if (subtreeIds(nodes, id).includes(parentId)) {
    return { ok: false, reason: 'A place cannot move inside one of its own places.' };
  }
  const depth = depthOf(nodes, parentId) + 1 + subtreeHeight(nodes, id);
  if (depth >= PLANNER_LIMITS.maxDepth) {
    return { ok: false, reason: `Places can be nested up to ${PLANNER_LIMITS.maxDepth} levels.` };
  }
  return { ok: true };
}

/** Rows to render for a tree where only `expanded` nodes show their children. */
export function visibleRows(tree: readonly PlanTreeNode[], expanded: ReadonlySet<string>): PlanTreeNode[] {
  const rows: PlanTreeNode[] = [];
  const walk = (items: readonly PlanTreeNode[]) => {
    for (const item of items) {
      rows.push(item);
      if (expanded.has(item.node.id)) walk(item.children);
    }
  };
  walk(tree);
  return rows;
}

/** Number of nodes in a subtree, excluding its root. */
export const countDescendants = (item: PlanTreeNode): number =>
  item.children.reduce((sum, child) => sum + 1 + countDescendants(child), 0);

/** Route stops in order, joined to their nodes (stops whose node is gone are skipped). */
export function routeNodes(plan: TripPlan): PlanNode[] {
  const byId = new Map(plan.nodes.map((n) => [n.id, n]));
  return [...plan.route]
    .sort((a, b) => a.position - b.position)
    .flatMap((stop) => {
      const node = byId.get(stop.nodeId);
      return node ? [node] : [];
    });
}

/** Coordinates to draw for a node, if its place has any. */
export const nodeLocation = (node: PlanNode): GeoPoint | null => node.place?.location ?? null;

/** Moves one item of a list to a new index (clamped); returns a new array. */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const result = [...list];
  if (from < 0 || from >= result.length) return result;
  const [item] = result.splice(from, 1);
  const target = Math.max(0, Math.min(to, result.length));
  result.splice(target, 0, item as T);
  return result;
}

export function validateNodeName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return 'Give the place a name.';
  if (trimmed.length > PLANNER_LIMITS.nameMax) return `Keep names under ${PLANNER_LIMITS.nameMax} characters.`;
  return null;
}

export function isValidLocation(point: GeoPoint | null | undefined): point is GeoPoint {
  return (
    !!point &&
    Number.isFinite(point.latitude) &&
    Number.isFinite(point.longitude) &&
    Math.abs(point.latitude) <= 90 &&
    Math.abs(point.longitude) <= 180
  );
}
