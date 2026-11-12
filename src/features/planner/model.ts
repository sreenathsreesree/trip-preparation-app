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

/** Anything stored as a tree with sibling order (plan nodes, navigation items). */
export interface TreeItem {
  id: string;
  parentId: string | null;
  position: number;
  createdAt: string;
}

export interface TreeNode<T extends TreeItem> {
  node: T;
  depth: number;
  children: TreeNode<T>[];
}

export type PlanTreeNode = TreeNode<PlanNode>;

const bySiblingOrder = (a: TreeItem, b: TreeItem) =>
  a.position - b.position || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);

export function childrenOf<T extends TreeItem>(nodes: readonly T[], parentId: string | null): T[] {
  return nodes.filter((n) => n.parentId === parentId).sort(bySiblingOrder);
}

/** Nested tree of a trip's nodes. Nodes whose parent is missing are treated as roots. */
export function buildTree<T extends TreeItem>(nodes: readonly T[]): TreeNode<T>[] {
  const ids = new Set(nodes.map((n) => n.id));
  const byParent = new Map<string | null, T[]>();
  for (const node of nodes) {
    const key = node.parentId && ids.has(node.parentId) ? node.parentId : null;
    byParent.set(key, [...(byParent.get(key) ?? []), node]);
  }
  const visited = new Set<string>();
  const build = (parentId: string | null, depth: number): TreeNode<T>[] =>
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
export function ancestorIds(nodes: readonly TreeItem[], id: string): string[] {
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
export function subtreeIds(nodes: readonly TreeItem[], id: string): string[] {
  const result = [id];
  for (let i = 0; i < result.length; i += 1) {
    for (const node of nodes) {
      if (node.parentId === result[i] && !result.includes(node.id)) result.push(node.id);
    }
  }
  return result;
}

/** 0 for a main destination, 1 for a place inside it, and so on. */
export const depthOf = (nodes: readonly TreeItem[], id: string) => ancestorIds(nodes, id).length;

/** Levels in the subtree below a node (0 when it has no children). */
export function subtreeHeight(nodes: readonly TreeItem[], id: string): number {
  const children = nodes.filter((n) => n.parentId === id);
  return children.length === 0 ? 0 : 1 + Math.max(...children.map((c) => subtreeHeight(nodes, c.id)));
}

export type MoveCheck = { ok: true } | { ok: false; reason: string };

/** Whether `id` (with its subtree) may be placed under `parentId` (null = main destination). */
export function canMove(nodes: readonly TreeItem[], id: string, parentId: string | null): MoveCheck {
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
export function visibleRows<T extends TreeItem>(tree: readonly TreeNode<T>[], expanded: ReadonlySet<string>): TreeNode<T>[] {
  const rows: TreeNode<T>[] = [];
  const walk = (items: readonly TreeNode<T>[]) => {
    for (const item of items) {
      rows.push(item);
      if (expanded.has(item.node.id)) walk(item.children);
    }
  };
  walk(tree);
  return rows;
}

export interface RowInfo {
  /** Index among siblings and number of siblings (for move up/down). */
  index: number;
  siblings: number;
  /** Places nested anywhere below. */
  descendants: number;
}

/** Per-node sibling position and descendant count, computed in one pass over the tree. */
export function rowInfo<T extends TreeItem>(tree: readonly TreeNode<T>[]): Map<string, RowInfo> {
  const info = new Map<string, RowInfo>();
  const walk = (items: readonly TreeNode<T>[]): number => {
    let total = 0;
    items.forEach((item, index) => {
      const descendants = walk(item.children);
      info.set(item.node.id, { index, siblings: items.length, descendants });
      total += 1 + descendants;
    });
    return total;
  };
  walk(tree);
  return info;
}

/** Number of nodes in a subtree, excluding its root. */
export const countDescendants = <T extends TreeItem>(item: TreeNode<T>): number =>
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

export interface RemovalImpact {
  /** Places removed (the node, plus everything inside it with `withChildren`). */
  removedNodes: number;
  /** Places inside that move up a level with `keepChildren`. */
  movedUp: number;
  /** Removed places that are route stops — they leave the route. */
  routeStops: string[];
  /** Whether a main destination of the trip is removed. */
  removesMainDestination: boolean;
}

/** What removing a node would do, so the UI can explain it before confirming. */
export function removalImpact(plan: TripPlan, id: string, mode: 'keepChildren' | 'withChildren'): RemovalImpact {
  const removed = mode === 'withChildren' ? subtreeIds(plan.nodes, id) : [id];
  const stops = new Set(plan.route.map((s) => s.nodeId));
  const node = plan.nodes.find((n) => n.id === id);
  return {
    removedNodes: removed.length,
    movedUp: mode === 'keepChildren' ? plan.nodes.filter((n) => n.parentId === id).length : 0,
    routeStops: plan.nodes.filter((n) => removed.includes(n.id) && stops.has(n.id)).map((n) => n.name),
    removesMainDestination: !!node && node.parentId === null,
  };
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
