import type { Database } from '@/db/types';
import type { IdFactory } from '@/lib/id';

import { providerCacheCutoff } from '../places/cachePolicy';
import {
  canMove,
  childrenOf,
  isPlaceProvider,
  isValidLocation,
  PLANNER_LIMITS,
  subtreeIds,
  validateNodeName,
  type NodeOrigin,
  type Place,
  type PlaceInput,
  type PlanNode,
  type RouteStop,
  type TripPlan,
} from './model';

export class PlannerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlannerError';
  }
}

interface PlaceRow {
  id: string;
  provider: string;
  provider_place_id: string | null;
  name: string;
  latitude: number | null;
  longitude: number | null;
  formatted_address: string;
  types: string;
  district: string | null;
  state: string | null;
  country: string | null;
  metadata: string;
  fetched_at: string | null;
  created_at: string;
  updated_at: string;
}

interface NodeRow {
  id: string;
  trip_id: string;
  parent_id: string | null;
  place_id: string | null;
  trip_destination_id: string | null;
  origin: string;
  name: string;
  notes: string;
  position: number;
  created_at: string;
  updated_at: string;
}

function parseJson<T>(text: string, fallback: T): T {
  try {
    const value: unknown = JSON.parse(text);
    return (value ?? fallback) as T;
  } catch {
    return fallback;
  }
}

export function mapPlace(row: PlaceRow): Place {
  const types = parseJson<unknown>(row.types, []);
  const metadata = parseJson<unknown>(row.metadata, {});
  const location = { latitude: Number(row.latitude), longitude: Number(row.longitude) };
  return {
    id: row.id,
    provider: isPlaceProvider(row.provider) ? row.provider : 'manual',
    providerPlaceId: row.provider_place_id,
    name: row.name,
    location: row.latitude !== null && row.longitude !== null && isValidLocation(location) ? location : null,
    formattedAddress: row.formatted_address,
    types: Array.isArray(types) ? types.filter((t): t is string => typeof t === 'string') : [],
    district: row.district,
    state: row.state,
    country: row.country,
    metadata: metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? (metadata as Record<string, unknown>) : {},
    fetchedAt: row.fetched_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapNode(row: NodeRow, place: Place | null): PlanNode {
  return {
    id: row.id,
    tripId: row.trip_id,
    parentId: row.parent_id,
    placeId: row.place_id,
    place,
    tripDestinationId: row.trip_destination_id,
    origin: (row.origin === 'trip' ? 'trip' : 'planner') as NodeOrigin,
    name: row.name,
    notes: row.notes,
    position: row.position,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/* ------------------------------------------------------------------ */
/* Helpers shared with the trip repository (run inside its transactions) */
/* ------------------------------------------------------------------ */

async function nextPosition(db: Database, tripId: string, parentId: string | null): Promise<number> {
  const row = await db.getFirstAsync<{ next: number }>(
    `SELECT COALESCE(MAX(position) + 1, 0) AS next FROM trip_plan_nodes WHERE trip_id = ? AND parent_id IS ?`,
    [tripId, parentId],
  );
  return row?.next ?? 0;
}

async function appendRouteStop(db: Database, createId: IdFactory, tripId: string, nodeId: string, timestamp: string) {
  const next = await db.getFirstAsync<{ next: number }>(
    'SELECT COALESCE(MAX(position) + 1, 0) AS next FROM trip_route_stops WHERE trip_id = ?',
    [tripId],
  );
  await db.runAsync(
    'INSERT OR IGNORE INTO trip_route_stops (id, trip_id, node_id, position, created_at) VALUES (?, ?, ?, ?, ?)',
    [createId(), tripId, nodeId, next?.next ?? 0, timestamp],
  );
}

async function renumberRoute(db: Database, tripId: string) {
  const stops = await db.getAllAsync<{ id: string }>(
    'SELECT id FROM trip_route_stops WHERE trip_id = ? ORDER BY position, created_at',
    [tripId],
  );
  for (let i = 0; i < stops.length; i += 1) {
    await db.runAsync('UPDATE trip_route_stops SET position = ? WHERE id = ?', [i, stops[i]?.id ?? '']);
  }
}

async function writeSiblingOrder(db: Database, ids: readonly string[], parentId: string | null, timestamp: string) {
  for (let i = 0; i < ids.length; i += 1) {
    await db.runAsync('UPDATE trip_plan_nodes SET parent_id = ?, position = ?, updated_at = ? WHERE id = ?', [
      parentId,
      i,
      timestamp,
      ids[i] ?? '',
    ]);
  }
}

async function refreshLegacyDestination(db: Database, tripId: string, timestamp: string) {
  await db.runAsync(
    `UPDATE trips SET destination = COALESCE(
       (SELECT name FROM trip_destinations WHERE trip_id = ? ORDER BY position, created_at LIMIT 1), destination),
       updated_at = ? WHERE id = ?`,
    [tripId, timestamp, tripId],
  );
}

/**
 * Keeps the planner in step after the trip's destinations were created or
 * edited in the trip form:
 * - each destination without a planner node gets a main-destination node and a route stop;
 * - renamed destinations rename their node;
 * - a node whose destination was removed is deleted if it holds nothing,
 *   otherwise it stays in the planner (nothing nested is ever lost).
 */
export async function syncPlanWithTripDestinations(db: Database, createId: IdFactory, tripId: string, timestamp: string) {
  const destinations = await db.getAllAsync<{ id: string; name: string }>(
    'SELECT id, name FROM trip_destinations WHERE trip_id = ? ORDER BY position, created_at',
    [tripId],
  );
  const linked = await db.getAllAsync<{ id: string; name: string; trip_destination_id: string }>(
    'SELECT id, name, trip_destination_id FROM trip_plan_nodes WHERE trip_id = ? AND trip_destination_id IS NOT NULL',
    [tripId],
  );
  const nodeByDestination = new Map(linked.map((n) => [n.trip_destination_id, n]));

  for (const destination of destinations) {
    const node = nodeByDestination.get(destination.id);
    if (node) {
      if (node.name !== destination.name) {
        await db.runAsync('UPDATE trip_plan_nodes SET name = ?, updated_at = ? WHERE id = ?', [
          destination.name,
          timestamp,
          node.id,
        ]);
      }
      continue;
    }
    const id = createId();
    await db.runAsync(
      `INSERT INTO trip_plan_nodes
         (id, trip_id, parent_id, place_id, trip_destination_id, origin, name, notes, position, created_at, updated_at)
       VALUES (?, ?, NULL, NULL, ?, 'trip', ?, '', ?, ?, ?)`,
      [id, tripId, destination.id, destination.name, await nextPosition(db, tripId, null), timestamp, timestamp],
    );
    await appendRouteStop(db, createId, tripId, id, timestamp);
  }

  // Destinations removed in the trip form: the FK cleared the link.
  const orphans = await db.getAllAsync<{ id: string; children: number }>(
    `SELECT n.id, (SELECT COUNT(*) FROM trip_plan_nodes c WHERE c.parent_id = n.id) AS children
     FROM trip_plan_nodes n
     WHERE n.trip_id = ? AND n.origin = 'trip' AND n.trip_destination_id IS NULL`,
    [tripId],
  );
  for (const orphan of orphans) {
    if (Number(orphan.children) === 0) {
      await db.runAsync('DELETE FROM trip_plan_nodes WHERE id = ?', [orphan.id]);
    } else {
      await db.runAsync(`UPDATE trip_plan_nodes SET origin = 'planner', updated_at = ? WHERE id = ?`, [
        timestamp,
        orphan.id,
      ]);
    }
  }
  await renumberRoute(db, tripId);
}

/**
 * Copies a trip's plan (tree, places, route) into a duplicated trip. Links to
 * trip destinations are mapped by destination position.
 */
export async function copyPlan(
  db: Database,
  createId: IdFactory,
  fromTripId: string,
  toTripId: string,
  timestamp: string,
) {
  const [fromDestinations, toDestinations] = await Promise.all(
    [fromTripId, toTripId].map((tripId) =>
      db.getAllAsync<{ id: string }>('SELECT id FROM trip_destinations WHERE trip_id = ? ORDER BY position, created_at', [
        tripId,
      ]),
    ),
  );
  const destinationMap = new Map(
    (fromDestinations ?? []).flatMap((d, i) => {
      const target = toDestinations?.[i];
      return target ? [[d.id, target.id] as const] : [];
    }),
  );
  const nodes = await db.getAllAsync<NodeRow>('SELECT * FROM trip_plan_nodes WHERE trip_id = ?', [fromTripId]);
  const idMap = new Map(nodes.map((n) => [n.id, createId()]));
  // Parents first so the self-reference is always satisfied.
  const ordered: NodeRow[] = [];
  const pending = [...nodes];
  while (pending.length > 0) {
    const index = pending.findIndex((n) => !n.parent_id || ordered.some((o) => o.id === n.parent_id));
    const [next] = pending.splice(index === -1 ? 0 : index, 1);
    if (next) ordered.push(next);
  }
  for (const node of ordered) {
    const destination = node.trip_destination_id ? (destinationMap.get(node.trip_destination_id) ?? null) : null;
    await db.runAsync(
      `INSERT INTO trip_plan_nodes
         (id, trip_id, parent_id, place_id, trip_destination_id, origin, name, notes, position, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        idMap.get(node.id) ?? createId(),
        toTripId,
        node.parent_id ? (idMap.get(node.parent_id) ?? null) : null,
        node.place_id,
        destination,
        destination ? 'trip' : 'planner',
        node.name,
        node.notes,
        node.position,
        timestamp,
        timestamp,
      ],
    );
  }
  const stops = await db.getAllAsync<{ node_id: string; position: number }>(
    'SELECT node_id, position FROM trip_route_stops WHERE trip_id = ? ORDER BY position',
    [fromTripId],
  );
  for (const stop of stops) {
    const nodeId = idMap.get(stop.node_id);
    if (!nodeId) continue;
    await db.runAsync(
      'INSERT INTO trip_route_stops (id, trip_id, node_id, position, created_at) VALUES (?, ?, ?, ?, ?)',
      [createId(), toTripId, nodeId, stop.position, timestamp],
    );
  }
  // Destinations without a node in the source (should not happen) still get one.
  await syncPlanWithTripDestinations(db, createId, toTripId, timestamp);
}

/* ------------------------------------------------------------------ */
/* Repository                                                          */
/* ------------------------------------------------------------------ */

export interface NewNodeInput {
  name?: string;
  parentId?: string | null;
  /** Insert at this index among the siblings (default: last). */
  index?: number;
  place?: PlaceInput | null;
  notes?: string;
  /** Also append the node to the route. */
  addToRoute?: boolean;
}

export type AddNodeResult = { status: 'added'; node: PlanNode } | { status: 'duplicate'; node: PlanNode };

export interface PlannerRepository {
  load(tripId: string): Promise<TripPlan>;
  /** Saved places across all trips (most recently used first), for reuse. */
  listPlaces(limit?: number): Promise<Place[]>;
  getPlace(id: string): Promise<Place | null>;
  /** Insert or refresh a provider place; one row per provider id. */
  upsertPlace(input: PlaceInput): Promise<Place>;
  /** Adds a place to the trip. A place already in the trip is never added twice. */
  addNode(tripId: string, input: NewNodeInput): Promise<AddNodeResult>;
  updateNode(id: string, patch: { name?: string; notes?: string }): Promise<PlanNode>;
  /** Moves a node (with everything inside it) under `parentId` (null = main destination) at `index`. */
  moveNode(id: string, target: { parentId: string | null; index?: number }): Promise<void>;
  /** Makes a nested place a main destination, right after the main destination it was in. */
  promote(id: string): Promise<void>;
  /** `keepChildren`: places inside move up a level; `withChildren`: they are removed too. */
  removeNode(id: string, mode: 'keepChildren' | 'withChildren'): Promise<void>;
  addRouteStop(tripId: string, nodeId: string, index?: number): Promise<void>;
  removeRouteStop(tripId: string, nodeId: string): Promise<void>;
  moveRouteStop(tripId: string, nodeId: string, toIndex: number): Promise<void>;
  /** Replaces the route with exactly these nodes, in order. */
  setRoute(tripId: string, nodeIds: readonly string[]): Promise<void>;
  markOpened(tripId: string): Promise<void>;
  /** The active trip whose planner was opened most recently, if any. */
  lastOpenedTripId(): Promise<string | null>;
  /** Drops provider content older than the cache limit (keeps Place IDs and user data). */
  expireProviderCache(): Promise<number>;
}

export function createPlannerRepository(
  db: Database,
  deps: { createId: IdFactory; now?: () => Date },
): PlannerRepository {
  const now = deps.now ?? (() => new Date());
  const stamp = () => now().toISOString();

  async function nodeRows(tripId: string) {
    return db.getAllAsync<NodeRow>('SELECT * FROM trip_plan_nodes WHERE trip_id = ?', [tripId]);
  }

  async function mustNode(id: string): Promise<NodeRow> {
    const row = await db.getFirstAsync<NodeRow>('SELECT * FROM trip_plan_nodes WHERE id = ?', [id]);
    if (!row) throw new PlannerError('That place is no longer in this plan.');
    return row;
  }

  async function getNode(id: string): Promise<PlanNode> {
    const row = await mustNode(id);
    const place = row.place_id ? await repo.getPlace(row.place_id) : null;
    return mapNode(row, place);
  }

  async function plainNodes(tripId: string): Promise<PlanNode[]> {
    return (await nodeRows(tripId)).map((row) => mapNode(row, null));
  }

  async function assertTrip(tripId: string) {
    const row = await db.getFirstAsync<{ id: string }>('SELECT id FROM trips WHERE id = ?', [tripId]);
    if (!row) throw new PlannerError('That trip no longer exists.');
  }

  /** Moves `id` into `parentId`'s children at `index`, renumbering both sibling lists. */
  async function place(nodes: PlanNode[], id: string, parentId: string | null, index: number | undefined, timestamp: string) {
    const node = nodes.find((n) => n.id === id);
    if (!node) throw new PlannerError('That place is no longer in this plan.');
    const oldSiblings = childrenOf(nodes, node.parentId).filter((n) => n.id !== id).map((n) => n.id);
    const newSiblings = parentId === node.parentId ? oldSiblings : childrenOf(nodes, parentId).map((n) => n.id).filter((x) => x !== id);
    const target = Math.max(0, Math.min(index ?? newSiblings.length, newSiblings.length));
    newSiblings.splice(target, 0, id);
    if (parentId !== node.parentId) await writeSiblingOrder(db, oldSiblings, node.parentId, timestamp);
    await writeSiblingOrder(db, newSiblings, parentId, timestamp);
  }

  const repo: PlannerRepository = {
    async load(tripId) {
      const [rows, placeRows, route] = await Promise.all([
        nodeRows(tripId),
        db.getAllAsync<PlaceRow>(
          `SELECT p.* FROM places p WHERE p.id IN (SELECT place_id FROM trip_plan_nodes WHERE trip_id = ? AND place_id IS NOT NULL)`,
          [tripId],
        ),
        db.getAllAsync<{ id: string; trip_id: string; node_id: string; position: number }>(
          'SELECT id, trip_id, node_id, position FROM trip_route_stops WHERE trip_id = ? ORDER BY position, created_at',
          [tripId],
        ),
      ]);
      const places = new Map(placeRows.map((row) => [row.id, mapPlace(row)]));
      return {
        nodes: rows.map((row) => mapNode(row, row.place_id ? (places.get(row.place_id) ?? null) : null)),
        route: route.map(
          (r): RouteStop => ({ id: r.id, tripId: r.trip_id, nodeId: r.node_id, position: r.position }),
        ),
      };
    },

    async listPlaces(limit = 50) {
      const rows = await db.getAllAsync<PlaceRow>(
        `SELECT p.* FROM places p
         LEFT JOIN trip_plan_nodes n ON n.place_id = p.id
         GROUP BY p.id
         ORDER BY MAX(COALESCE(n.updated_at, p.updated_at)) DESC
         LIMIT ?`,
        [limit],
      );
      return rows.map(mapPlace);
    },

    async getPlace(id) {
      const row = await db.getFirstAsync<PlaceRow>('SELECT * FROM places WHERE id = ?', [id]);
      return row ? mapPlace(row) : null;
    },

    async upsertPlace(input) {
      if (!isPlaceProvider(input.provider)) throw new PlannerError('Unknown place provider.');
      const name = input.name.trim();
      if (!name) throw new PlannerError('A place needs a name.');
      if (input.provider !== 'manual' && !input.providerPlaceId) throw new PlannerError('Missing provider place id.');
      const location = isValidLocation(input.location) ? input.location : null;
      const timestamp = stamp();
      const fetchedAt = input.provider === 'manual' ? null : timestamp;
      const values = [
        name,
        location?.latitude ?? null,
        location?.longitude ?? null,
        input.formattedAddress ?? '',
        JSON.stringify(input.types ?? []),
        input.district ?? null,
        input.state ?? null,
        input.country ?? null,
        JSON.stringify(input.metadata ?? {}),
        fetchedAt,
        timestamp,
      ];
      const existing = input.providerPlaceId
        ? await db.getFirstAsync<{ id: string }>('SELECT id FROM places WHERE provider = ? AND provider_place_id = ?', [
            input.provider,
            input.providerPlaceId,
          ])
        : null;
      let id = existing?.id;
      if (id) {
        await db.runAsync(
          `UPDATE places SET name = ?, latitude = ?, longitude = ?, formatted_address = ?, types = ?, district = ?,
             state = ?, country = ?, metadata = ?, fetched_at = ?, updated_at = ? WHERE id = ?`,
          [...values, id],
        );
      } else {
        id = deps.createId();
        await db.runAsync(
          `INSERT INTO places (id, provider, provider_place_id, name, latitude, longitude, formatted_address, types,
             district, state, country, metadata, fetched_at, updated_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [id, input.provider, input.providerPlaceId, ...values, timestamp],
        );
      }
      const place = await repo.getPlace(id);
      if (!place) throw new PlannerError('Could not save the place.');
      return place;
    },

    async addNode(tripId, input) {
      await assertTrip(tripId);
      const parentId = input.parentId ?? null;
      const notes = (input.notes ?? '').trim();
      if (notes.length > PLANNER_LIMITS.notesMax) throw new PlannerError('Notes are too long.');
      const timestamp = stamp();
      let result: AddNodeResult | null = null;

      await db.withTransactionAsync(async () => {
        const nodes = await plainNodes(tripId);
        if (nodes.length >= PLANNER_LIMITS.nodesPerTrip) throw new PlannerError('This plan has reached its size limit.');
        if (parentId) {
          const parent = nodes.find((n) => n.id === parentId);
          if (!parent) throw new PlannerError('The place to add into is no longer in this plan.');
          // A new leaf adds one level below the parent.
          if (ancestorDepth(nodes, parentId) + 1 >= PLANNER_LIMITS.maxDepth) {
            throw new PlannerError(`Places can be nested up to ${PLANNER_LIMITS.maxDepth} levels.`);
          }
        }
        let placeId: string | null = null;
        if (input.place) {
          placeId = (await repo.upsertPlace(input.place)).id;
          const existing = nodes.find((n) => n.placeId === placeId);
          if (existing) {
            result = { status: 'duplicate', node: existing };
            return;
          }
        }
        const name = (input.name ?? input.place?.name ?? '').trim();
        const nameError = validateNodeName(name);
        if (nameError) throw new PlannerError(nameError);

        const id = deps.createId();
        await db.runAsync(
          `INSERT INTO trip_plan_nodes
             (id, trip_id, parent_id, place_id, trip_destination_id, origin, name, notes, position, created_at, updated_at)
           VALUES (?, ?, ?, ?, NULL, 'planner', ?, ?, 0, ?, ?)`,
          [id, tripId, parentId, placeId, name, notes, timestamp, timestamp],
        );
        const withNew = await plainNodes(tripId);
        await place(withNew, id, parentId, input.index, timestamp);
        if (input.addToRoute) await appendRouteStop(db, deps.createId, tripId, id, timestamp);
        result = { status: 'added', node: mapNode(await mustNode(id), null) };
      });

      const done = result as AddNodeResult | null;
      if (!done) throw new PlannerError('Could not add the place.');
      return { status: done.status, node: await getNode(done.node.id) };
    },

    async updateNode(id, patch) {
      const row = await mustNode(id);
      const name = patch.name !== undefined ? patch.name.trim() : row.name;
      const nameError = validateNodeName(name);
      if (nameError) throw new PlannerError(nameError);
      const notes = patch.notes !== undefined ? patch.notes.trim() : row.notes;
      if (notes.length > PLANNER_LIMITS.notesMax) throw new PlannerError('Notes are too long.');
      const timestamp = stamp();
      await db.withTransactionAsync(async () => {
        await db.runAsync('UPDATE trip_plan_nodes SET name = ?, notes = ?, updated_at = ? WHERE id = ?', [
          name,
          notes,
          timestamp,
          id,
        ]);
        // A node that is one of the trip's destinations renames that destination too.
        if (row.trip_destination_id && name !== row.name) {
          await db.runAsync('UPDATE trip_destinations SET name = ?, updated_at = ? WHERE id = ?', [
            name,
            timestamp,
            row.trip_destination_id,
          ]);
          await refreshLegacyDestination(db, row.trip_id, timestamp);
        }
      });
      return getNode(id);
    },

    async moveNode(id, target) {
      const row = await mustNode(id);
      const timestamp = stamp();
      await db.withTransactionAsync(async () => {
        const nodes = await plainNodes(row.trip_id);
        if (target.parentId && !nodes.some((n) => n.id === target.parentId)) {
          throw new PlannerError('The place to move into is no longer in this plan.');
        }
        const check = canMove(nodes, id, target.parentId);
        if (!check.ok) throw new PlannerError(check.reason);
        await place(nodes, id, target.parentId, target.index, timestamp);
      });
    },

    async promote(id) {
      const row = await mustNode(id);
      if (!row.parent_id) return;
      const nodes = await plainNodes(row.trip_id);
      const ancestors = [row.parent_id];
      let current = nodes.find((n) => n.id === row.parent_id);
      while (current?.parentId) {
        ancestors.push(current.parentId);
        current = nodes.find((n) => n.id === current?.parentId);
      }
      const rootId = ancestors[ancestors.length - 1];
      const roots = childrenOf(nodes, null);
      const index = roots.findIndex((n) => n.id === rootId);
      await repo.moveNode(id, { parentId: null, index: index === -1 ? undefined : index + 1 });
    },

    async removeNode(id, mode) {
      const row = await mustNode(id);
      const timestamp = stamp();
      await db.withTransactionAsync(async () => {
        const nodes = await plainNodes(row.trip_id);
        const removed = mode === 'withChildren' ? subtreeIds(nodes, id) : [id];
        const destinationIds = nodes
          .filter((n) => removed.includes(n.id) && n.tripDestinationId)
          .map((n) => n.tripDestinationId as string);
        if (destinationIds.length > 0) {
          const total = await db.getFirstAsync<{ n: number }>(
            'SELECT COUNT(*) AS n FROM trip_destinations WHERE trip_id = ?',
            [row.trip_id],
          );
          if (Number(total?.n ?? 0) - destinationIds.length < 1) {
            throw new PlannerError('A trip needs at least one destination. Add or keep another main destination first.');
          }
        }
        if (mode === 'keepChildren') {
          // Places inside take the removed node's spot, in their order.
          const siblings = childrenOf(nodes, row.parent_id).map((n) => n.id);
          const at = siblings.indexOf(id);
          const children = childrenOf(nodes, id).map((n) => n.id);
          siblings.splice(at === -1 ? siblings.length : at, 1, ...children);
          await writeSiblingOrder(db, siblings, row.parent_id, timestamp);
        }
        // Children (when removed too) and route stops cascade.
        await db.runAsync('DELETE FROM trip_plan_nodes WHERE id = ?', [id]);
        for (const destinationId of destinationIds) {
          await db.runAsync('DELETE FROM trip_destinations WHERE id = ?', [destinationId]);
        }
        if (destinationIds.length > 0) {
          const rest = await db.getAllAsync<{ id: string }>(
            'SELECT id FROM trip_destinations WHERE trip_id = ? ORDER BY position, created_at',
            [row.trip_id],
          );
          for (let i = 0; i < rest.length; i += 1) {
            await db.runAsync('UPDATE trip_destinations SET position = ? WHERE id = ?', [i, rest[i]?.id ?? '']);
          }
          await refreshLegacyDestination(db, row.trip_id, timestamp);
        }
        const remaining = childrenOf(await plainNodes(row.trip_id), row.parent_id);
        await writeSiblingOrder(db, remaining.map((n) => n.id), row.parent_id, timestamp);
        await renumberRoute(db, row.trip_id);
      });
    },

    async addRouteStop(tripId, nodeId, index) {
      const node = await mustNode(nodeId);
      if (node.trip_id !== tripId) throw new PlannerError('That place belongs to another trip.');
      const timestamp = stamp();
      await db.withTransactionAsync(async () => {
        await appendRouteStop(db, deps.createId, tripId, nodeId, timestamp);
        if (index !== undefined) await moveStop(tripId, nodeId, index);
      });
    },

    async removeRouteStop(tripId, nodeId) {
      await db.withTransactionAsync(async () => {
        await db.runAsync('DELETE FROM trip_route_stops WHERE trip_id = ? AND node_id = ?', [tripId, nodeId]);
        await renumberRoute(db, tripId);
      });
    },

    async moveRouteStop(tripId, nodeId, toIndex) {
      await db.withTransactionAsync(() => moveStop(tripId, nodeId, toIndex));
    },

    async setRoute(tripId, nodeIds) {
      await assertTrip(tripId);
      const unique = [...new Set(nodeIds)];
      const owned = new Set((await nodeRows(tripId)).map((n) => n.id));
      if (unique.some((id) => !owned.has(id))) throw new PlannerError('Some stops are not in this plan.');
      const timestamp = stamp();
      await db.withTransactionAsync(async () => {
        await db.runAsync('DELETE FROM trip_route_stops WHERE trip_id = ?', [tripId]);
        for (let i = 0; i < unique.length; i += 1) {
          await db.runAsync(
            'INSERT INTO trip_route_stops (id, trip_id, node_id, position, created_at) VALUES (?, ?, ?, ?, ?)',
            [deps.createId(), tripId, unique[i] ?? '', i, timestamp],
          );
        }
      });
    },

    async markOpened(tripId) {
      await db.runAsync('UPDATE trips SET planner_opened_at = ? WHERE id = ?', [stamp(), tripId]);
    },

    async lastOpenedTripId() {
      const row = await db.getFirstAsync<{ id: string }>(
        `SELECT id FROM trips
         WHERE planner_opened_at IS NOT NULL AND archived_at IS NULL AND completed_at IS NULL
         ORDER BY planner_opened_at DESC LIMIT 1`,
        [],
      );
      return row?.id ?? null;
    },

    async expireProviderCache() {
      const result = await db.runAsync(
        `UPDATE places SET name = '', latitude = NULL, longitude = NULL, formatted_address = '', types = '[]',
           district = NULL, state = NULL, country = NULL, metadata = '{}', fetched_at = NULL, updated_at = ?
         WHERE provider <> 'manual' AND fetched_at IS NOT NULL AND fetched_at < ?`,
        [stamp(), providerCacheCutoff(now())],
      );
      return result.changes;
    },
  };

  async function moveStop(tripId: string, nodeId: string, toIndex: number) {
    const stops = await db.getAllAsync<{ id: string; node_id: string }>(
      'SELECT id, node_id FROM trip_route_stops WHERE trip_id = ? ORDER BY position, created_at',
      [tripId],
    );
    const from = stops.findIndex((s) => s.node_id === nodeId);
    if (from === -1) throw new PlannerError('That place is not a route stop.');
    const [stop] = stops.splice(from, 1);
    stops.splice(Math.max(0, Math.min(toIndex, stops.length)), 0, stop as { id: string; node_id: string });
    for (let i = 0; i < stops.length; i += 1) {
      await db.runAsync('UPDATE trip_route_stops SET position = ? WHERE id = ?', [i, stops[i]?.id ?? '']);
    }
  }

  return repo;
}

function ancestorDepth(nodes: readonly PlanNode[], id: string): number {
  let depth = 0;
  let current = nodes.find((n) => n.id === id);
  const seen = new Set<string>();
  while (current?.parentId && !seen.has(current.parentId)) {
    seen.add(current.parentId);
    depth += 1;
    current = nodes.find((n) => n.id === current?.parentId);
  }
  return depth;
}
