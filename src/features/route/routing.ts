import type { GeoPoint } from '../planner/model';
import { cachedFetch, type RemoteCacheRepository } from '../remote/remoteCacheRepository';

/**
 * Road distances and driving times from OSRM (Open Source Routing Machine) on
 * OpenStreetMap data. The public server (router.project-osrm.org) is free and
 * keyless; its usage policy asks for light use (≤ 1 request per second),
 * attribution, and no heavy production load — so results are cached for 30
 * days and requests are spaced. `EXPO_PUBLIC_ROUTING_URL` can point to a
 * self-hosted OSRM later. Google Directions (billing) is not used.
 *
 * Never a guess: a leg without a road route (missing location, no road, service
 * down) is "unavailable"; straight-line distance is never shown as road distance.
 */
export const DEFAULT_OSRM_URL = 'https://router.project-osrm.org';
export const ROUTING_SOURCE = 'OSRM (OpenStreetMap)';
export const ROUTING_ATTRIBUTION = 'Routes by OSRM · map data © OpenStreetMap contributors';
export const ROUTE_CACHE_MS = 30 * 24 * 60 * 60 * 1000;
/** Points per request (the public server allows more; smaller requests are kinder). */
export const MAX_POINTS_PER_REQUEST = 25;
const MIN_GAP_MS = 1100;

export function osrmBase(raw: string | undefined): string {
  const v = raw?.trim() ?? '';
  return /^https:\/\/[^\s]+$/i.test(v) ? v.replace(/\/$/, '') : DEFAULT_OSRM_URL;
}

export interface RouteLeg {
  fromId: string;
  toId: string;
  /** Road distance in metres and driving time in seconds, or null when unavailable. */
  meters: number | null;
  seconds: number | null;
  reason?: 'missing_location' | 'no_route' | 'offline';
}

export interface RouteResult {
  legs: RouteLeg[];
  totalMeters: number;
  totalSeconds: number;
  /** Legs with real values / all legs. */
  covered: number;
  from: 'live' | 'cache' | 'stale_cache' | 'mixed' | 'none';
  fetchedAt: string | null;
}

export interface RouteStop {
  id: string;
  name: string;
  location: GeoPoint | null;
}

const coord = (p: GeoPoint) => `${p.longitude.toFixed(5)},${p.latitude.toFixed(5)}`;

export const routeUrl = (base: string, points: readonly GeoPoint[]) => `${base}/route/v1/driving/${points.map(coord).join(';')}?overview=false&steps=false&alternatives=false`;

/** Legs from an OSRM /route response; null when there is no route. */
export function parseRoute(body: unknown, count: number): { meters: number; seconds: number }[] | null {
  const b = body as { code?: string; routes?: { legs?: { distance?: number; duration?: number }[] }[] };
  if (b?.code !== 'Ok') return null;
  const legs = b.routes?.[0]?.legs ?? [];
  if (legs.length !== count - 1) return null;
  if (legs.some((l) => typeof l.distance !== 'number' || typeof l.duration !== 'number')) return null;
  return legs.map((l) => ({ meters: l.distance as number, seconds: l.duration as number }));
}

/** Runs of consecutive stops that all have a location (each run is routed; gaps stay unavailable). */
export function locatedRuns(stops: readonly RouteStop[]): RouteStop[][] {
  const runs: RouteStop[][] = [];
  let run: RouteStop[] = [];
  for (const s of stops) {
    if (s.location) run.push(s);
    else {
      if (run.length > 1) runs.push(run);
      run = [];
    }
  }
  if (run.length > 1) runs.push(run);
  return runs;
}

/** Splits a run into overlapping chunks (the last stop of one is the first of the next). */
export function chunks<T>(items: readonly T[], size = MAX_POINTS_PER_REQUEST): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length - 1; i += size - 1) out.push(items.slice(i, i + size));
  return out;
}

export interface RoutingDeps {
  cache: RemoteCacheRepository;
  fetchImpl?: typeof fetch;
  base?: string;
  now?: Date;
}

let last = 0;
let chain: Promise<unknown> = Promise.resolve();
function spaced<T>(task: () => Promise<T>): Promise<T> {
  const run = chain.then(async () => {
    const wait = last + MIN_GAP_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    last = Date.now();
    return task();
  });
  chain = run.catch(() => undefined);
  return run;
}

/** Road legs between consecutive stops, cache first. */
export async function routeLegs(stops: readonly RouteStop[], deps: RoutingDeps): Promise<RouteResult> {
  const base = deps.base ?? DEFAULT_OSRM_URL;
  const fetchImpl = deps.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const now = deps.now ?? new Date();
  const values = new Map<string, { meters: number; seconds: number } | 'no_route' | 'offline'>();
  const sources = new Set<string>();
  let fetchedAt = null as string | null;
  for (const run of locatedRuns(stops)) {
    for (const chunk of chunks(run)) {
      const points = chunk.map((s) => s.location as GeoPoint);
      const key = `route:${points.map(coord).join(';')}`;
      try {
        const r = await cachedFetch(deps.cache, { key, kind: 'route', source: ROUTING_SOURCE, maxAgeMs: ROUTE_CACHE_MS, now }, () =>
          spaced(async () => {
            const res = await fetchImpl(routeUrl(base, points), { headers: { Accept: 'application/json' } });
            if (!res.ok && res.status !== 400) throw new Error(`Routing failed (${res.status}).`);
            return parseRoute(await res.json(), points.length);
          }),
        );
        sources.add(r.from);
        fetchedAt = !fetchedAt || r.fetchedAt < fetchedAt ? r.fetchedAt : fetchedAt;
        chunk.slice(1).forEach((s, i) => values.set(`${chunk[i]!.id}>${s.id}`, r.payload ? (r.payload[i] as { meters: number; seconds: number }) : 'no_route'));
      } catch {
        chunk.slice(1).forEach((s, i) => values.set(`${chunk[i]!.id}>${s.id}`, 'offline'));
      }
    }
  }
  const legs: RouteLeg[] = stops.slice(1).map((to, i) => {
    const from = stops[i] as RouteStop;
    if (!from.location || !to.location) return { fromId: from.id, toId: to.id, meters: null, seconds: null, reason: 'missing_location' };
    const v = values.get(`${from.id}>${to.id}`);
    if (!v || typeof v === 'string') return { fromId: from.id, toId: to.id, meters: null, seconds: null, reason: (v as 'no_route' | 'offline' | undefined) ?? 'offline' };
    return { fromId: from.id, toId: to.id, meters: v.meters, seconds: v.seconds };
  });
  const ok = legs.filter((l) => l.meters !== null);
  return {
    legs,
    totalMeters: ok.reduce((a, l) => a + (l.meters as number), 0),
    totalSeconds: ok.reduce((a, l) => a + (l.seconds as number), 0),
    covered: ok.length,
    from: sources.size === 0 ? 'none' : sources.size === 1 ? ([...sources][0] as RouteResult['from']) : 'mixed',
    fetchedAt,
  };
}

export const tripUrl = (base: string, points: readonly GeoPoint[]) => `${base}/trip/v1/driving/${points.map(coord).join(';')}?source=first&destination=last&roundtrip=false&overview=false`;

/**
 * A suggested shorter order (OSRM trip service): first and last stops stay
 * where they are. Only a suggestion — the caller shows it and applies it only
 * when the user agrees. Null when it cannot be computed.
 */
export async function suggestOrder(stops: readonly RouteStop[], deps: Omit<RoutingDeps, 'cache'>): Promise<string[] | null> {
  if (stops.length < 4 || stops.length > 25 || stops.some((s) => !s.location)) return null;
  const base = deps.base ?? DEFAULT_OSRM_URL;
  const fetchImpl = deps.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const body = await spaced(async () => (await fetchImpl(tripUrl(base, stops.map((s) => s.location as GeoPoint)))).json());
  const b = body as { code?: string; waypoints?: { waypoint_index: number }[] };
  if (b?.code !== 'Ok' || !Array.isArray(b.waypoints) || b.waypoints.length !== stops.length) return null;
  const order = new Array<string>(stops.length);
  b.waypoints.forEach((w, i) => {
    order[w.waypoint_index] = (stops[i] as RouteStop).id;
  });
  return order.every(Boolean) ? order : null;
}

export function formatDuration(seconds: number): string {
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h} h ${String(m % 60).padStart(2, '0')} min`;
}

export function formatKm(meters: number): string {
  return meters < 1000 ? `${Math.round(meters / 10) * 10} m` : `${(meters / 1000).toFixed(meters < 100_000 ? 1 : 0)} km`;
}
