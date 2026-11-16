import type { GeoPoint } from '../planner/model';

/**
 * Plus Codes (Open Location Code, an open standard by Google; Apache-2.0 algorithm),
 * implemented here without any network call.
 *
 * - A full code ("7J4V3335+9GH") is an exact ~14 × 14 m area: it decodes directly.
 * - A short code ("3335+9GH", as Google Maps shares it next to a locality) needs a
 *   reference point near the place to recover the full code.
 */

const ALPHABET = '23456789CFGHJMPQRVWX';
const SEPARATOR = '+';
const SEPARATOR_POSITION = 8;
const PAIR_RESOLUTIONS = [20, 1, 0.05, 0.0025, 0.000125] as const;
const GRID_ROWS = 5;
const GRID_COLS = 4;

const CODE_CHARS = `[${ALPHABET}]`;
/** A Plus Code inside text: full ("7J4V3335+9GH") or short ("3335+9GH"). */
export const PLUS_CODE_RE = new RegExp(String.raw`(?:^|[\s,(])(${CODE_CHARS}{2,8}\+${CODE_CHARS}{0,3})(?=$|[\s,)])`, 'i');

export interface DecodedCode {
  center: GeoPoint;
  /** Height and width of the code's area, in degrees. */
  latSize: number;
  lngSize: number;
}

const clean = (code: string) => code.trim().toUpperCase();

export function isValidCode(raw: string): boolean {
  const code = clean(raw);
  const sep = code.indexOf(SEPARATOR);
  if (sep === -1 || sep !== code.lastIndexOf(SEPARATOR) || sep > SEPARATOR_POSITION || sep % 2 === 1) return false;
  const after = code.slice(sep + 1);
  if (after.length === 1) return false;
  return [...code.replace(SEPARATOR, '')].every((c) => ALPHABET.includes(c));
}

export function isFullCode(raw: string): boolean {
  const code = clean(raw);
  if (!isValidCode(code) || code.indexOf(SEPARATOR) !== SEPARATOR_POSITION) return false;
  // First latitude digit must stay within ±90°, first longitude digit within ±180°.
  return ALPHABET.indexOf(code[0] as string) * 20 < 180 && ALPHABET.indexOf(code[1] as string) * 20 < 360;
}

export function isShortCode(raw: string): boolean {
  const code = clean(raw);
  return isValidCode(code) && code.indexOf(SEPARATOR) < SEPARATOR_POSITION;
}

/** Centre and size of a full code's area; null for anything else. */
export function decode(raw: string): DecodedCode | null {
  const code = clean(raw);
  if (!isFullCode(code)) return null;
  const digits = code.replace(SEPARATOR, '').replace(/0+$/, '');
  let lat = -90;
  let lng = -180;
  let latSize = 0;
  let lngSize = 0;
  for (let i = 0; i < Math.min(10, digits.length); i += 2) {
    const res = PAIR_RESOLUTIONS[i / 2] as number;
    lat += ALPHABET.indexOf(digits[i] as string) * res;
    lng += ALPHABET.indexOf(digits[i + 1] as string) * res;
    latSize = res;
    lngSize = res;
  }
  for (let i = 10; i < digits.length; i++) {
    latSize /= GRID_ROWS;
    lngSize /= GRID_COLS;
    const index = ALPHABET.indexOf(digits[i] as string);
    lat += Math.floor(index / GRID_COLS) * latSize;
    lng += (index % GRID_COLS) * lngSize;
  }
  return { center: { latitude: lat + latSize / 2, longitude: lng + lngSize / 2 }, latSize, lngSize };
}

/** The 10-digit full code for a point (enough to rebuild short codes). */
export function encode(point: GeoPoint, length = 10): string {
  let lat = Math.min(90, Math.max(-90, point.latitude)) + 90;
  let lng = ((((point.longitude + 180) % 360) + 360) % 360);
  if (lat === 180) lat -= PAIR_RESOLUTIONS[4] / 2;
  let out = '';
  for (let i = 0; i < length / 2; i++) {
    const res = PAIR_RESOLUTIONS[i] as number;
    const latDigit = Math.min(19, Math.floor(lat / res + 1e-9));
    const lngDigit = Math.min(19, Math.floor(lng / res + 1e-9));
    lat -= latDigit * res;
    lng -= lngDigit * res;
    out += (ALPHABET[latDigit] as string) + (ALPHABET[lngDigit] as string);
    if (out.length === SEPARATOR_POSITION) out += SEPARATOR;
  }
  return out;
}

/** Recovers a full code from a short one and a reference point near it (within ~half the code's area). */
export function recoverNearest(shortCode: string, reference: GeoPoint): string | null {
  const code = clean(shortCode);
  if (isFullCode(code)) return code;
  if (!isShortCode(code)) return null;
  const padding = SEPARATOR_POSITION - code.indexOf(SEPARATOR);
  const resolution = 20 ** (2 - padding / 2);
  const half = resolution / 2;
  const candidate = encode(reference).slice(0, padding) + code;
  const decoded = decode(candidate);
  if (!decoded) return null;
  let { latitude, longitude } = decoded.center;
  if (reference.latitude + half < latitude && latitude - resolution >= -90) latitude -= resolution;
  else if (reference.latitude - half > latitude && latitude + resolution <= 90) latitude += resolution;
  if (reference.longitude + half < longitude) longitude -= resolution;
  else if (reference.longitude - half > longitude) longitude += resolution;
  // Shifting by one resolution step only changes the prefix digits; the shared digits stay as they were.
  return encode({ latitude, longitude }).slice(0, padding) + code;
}

/** Coordinates for a full code, or for a short code given a nearby reference point. */
export function plusCodeLocation(code: string, reference?: GeoPoint | null): GeoPoint | null {
  const full = isFullCode(code) ? code : reference ? recoverNearest(code, reference) : null;
  return full ? (decode(full)?.center ?? null) : null;
}
