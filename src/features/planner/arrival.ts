import type { GeoPoint } from './model';

/**
 * Arrival prompts (pure state machine; no GPS here).
 *
 * The user explicitly asked to be asked before anything is completed: a place
 * is never marked visited automatically. When the device has stayed within
 * `radiusMeters` of an upcoming place for `dwellMinutes`, the tracker returns
 * a prompt ("You've reached X. Mark as visited?"). Declining snoozes that
 * place until the device has left the area (or for `snoozeMinutes`).
 *
 * Parent and child places are tracked independently. Location is best effort:
 * fixes can be inaccurate or infrequent, so the accuracy radius is used in the
 * device's favour only up to a cap, and leaving needs a margin (hysteresis).
 */

export interface ArrivalSettings {
  enabled: boolean;
  radiusMeters: number;
  dwellMinutes: number;
}

export const DEFAULT_ARRIVAL: ArrivalSettings = { enabled: false, radiusMeters: 150, dwellMinutes: 4 };
export const ARRIVAL_LIMITS = { radiusMin: 50, radiusMax: 1000, dwellMin: 1, dwellMax: 30 } as const;

export interface ArrivalTarget {
  nodeId: string;
  name: string;
  location: GeoPoint;
}

export interface PositionFix extends GeoPoint {
  /** Horizontal accuracy in metres (null when unknown). */
  accuracy: number | null;
  /** Milliseconds since epoch. */
  timestamp: number;
}

interface TargetState {
  /** When the device was first seen inside the radius (this visit). */
  enteredAt: number | null;
  /** Declined or already prompted: no new prompt until it leaves or the snooze ends. */
  snoozedUntil: number | null;
  prompted: boolean;
}

export interface ArrivalState {
  targets: Record<string, TargetState>;
}

export const emptyArrivalState = (): ArrivalState => ({ targets: {} });

const EARTH_RADIUS_M = 6_371_000;
const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance in metres (haversine). */
export function distanceMeters(a: GeoPoint, b: GeoPoint): number {
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Accuracy helps the device count as "inside" only up to this much. */
const MAX_ACCURACY_CREDIT = 50;
/** Leaving needs to be this much farther than arriving, so jitter at the edge does not reset the timer. */
const LEAVE_FACTOR = 1.5;
/** A fix this inaccurate is ignored (e.g. coarse network location). */
const IGNORE_ACCURACY = 500;
export const SNOOZE_MINUTES = 30;

export interface ArrivalPrompt {
  nodeId: string;
  name: string;
  distanceMeters: number;
}

/**
 * Applies one position fix. Returns the next state and at most one prompt
 * (the nearest place that has satisfied the dwell time).
 */
export function updateArrival(
  state: ArrivalState,
  fix: PositionFix,
  targets: readonly ArrivalTarget[],
  settings: Pick<ArrivalSettings, 'radiusMeters' | 'dwellMinutes'>,
): { state: ArrivalState; prompt: ArrivalPrompt | null } {
  if (fix.accuracy !== null && fix.accuracy > IGNORE_ACCURACY) return { state, prompt: null };
  const credit = Math.min(fix.accuracy ?? 0, MAX_ACCURACY_CREDIT);
  const next: ArrivalState = { targets: {} };
  const ready: ArrivalPrompt[] = [];
  for (const target of targets) {
    const previous = state.targets[target.nodeId] ?? { enteredAt: null, snoozedUntil: null, prompted: false };
    const distance = distanceMeters(fix, target.location);
    const inside = distance - credit <= settings.radiusMeters;
    const left = distance > settings.radiusMeters * LEAVE_FACTOR;
    let current: TargetState = { ...previous };
    if (left) {
      // Gone: a later return is a new visit.
      current = { enteredAt: null, snoozedUntil: null, prompted: false };
    } else if (inside && current.enteredAt === null) {
      current.enteredAt = fix.timestamp;
    }
    if (current.snoozedUntil !== null && fix.timestamp >= current.snoozedUntil) {
      current.snoozedUntil = null;
      current.prompted = false;
      current.enteredAt = inside ? fix.timestamp : null;
    }
    const dwelled = current.enteredAt !== null && fix.timestamp - current.enteredAt >= settings.dwellMinutes * 60_000;
    if (inside && dwelled && !current.prompted && current.snoozedUntil === null) {
      ready.push({ nodeId: target.nodeId, name: target.name, distanceMeters: Math.round(distance) });
    }
    next.targets[target.nodeId] = current;
  }
  ready.sort((a, b) => a.distanceMeters - b.distanceMeters);
  const prompt = ready[0] ?? null;
  if (prompt) {
    const entry = next.targets[prompt.nodeId];
    if (entry) entry.prompted = true;
  }
  return { state: next, prompt };
}

/** "Not yet": no prompt for this place until the device leaves, or for a while. */
export function snooze(state: ArrivalState, nodeId: string, now: number, minutes = SNOOZE_MINUTES): ArrivalState {
  const entry = state.targets[nodeId] ?? { enteredAt: null, snoozedUntil: null, prompted: true };
  return { targets: { ...state.targets, [nodeId]: { ...entry, prompted: true, snoozedUntil: now + minutes * 60_000 } } };
}

export function cleanArrivalSettings(value: unknown): ArrivalSettings {
  const raw = (typeof value === 'object' && value !== null ? value : {}) as Partial<ArrivalSettings>;
  const clamp = (n: unknown, min: number, max: number, fallback: number) =>
    typeof n === 'number' && Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
  return {
    enabled: raw.enabled === true,
    radiusMeters: clamp(raw.radiusMeters, ARRIVAL_LIMITS.radiusMin, ARRIVAL_LIMITS.radiusMax, DEFAULT_ARRIVAL.radiusMeters),
    dwellMinutes: clamp(raw.dwellMinutes, ARRIVAL_LIMITS.dwellMin, ARRIVAL_LIMITS.dwellMax, DEFAULT_ARRIVAL.dwellMinutes),
  };
}
