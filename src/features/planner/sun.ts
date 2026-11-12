import type { GeoPoint } from './model';

/**
 * Sunrise and sunset computed on the device from coordinates and a date
 * (standard astronomical formulae, accurate to a few minutes; no network).
 * Ignores terrain and elevation, so mountain valleys see the sun later.
 */

const RAD = Math.PI / 180;
const DAY_MS = 86_400_000;
const J1970 = 2440588;
const J2000 = 2451545;
const J0 = 0.0009;
const OBLIQUITY = RAD * 23.4397;
/** Sun's upper edge at the horizon, with refraction. */
const HORIZON = -0.833 * RAD;

const toDays = (date: Date) => date.valueOf() / DAY_MS - 0.5 + J1970 - J2000;
const fromJulian = (j: number) => new Date((j + 0.5 - J1970) * DAY_MS);
const meanAnomaly = (d: number) => RAD * (357.5291 + 0.98560028 * d);
function eclipticLongitude(m: number) {
  const center = RAD * (1.9148 * Math.sin(m) + 0.02 * Math.sin(2 * m) + 0.0003 * Math.sin(3 * m));
  return m + center + RAD * 102.9372 + Math.PI;
}
const declination = (l: number) => Math.asin(Math.sin(OBLIQUITY) * Math.sin(l));
const approxTransit = (ht: number, lw: number, n: number) => J0 + (ht + lw) / (2 * Math.PI) + n;
const transitJ = (ds: number, m: number, l: number) => J2000 + ds + 0.0053 * Math.sin(m) - 0.0069 * Math.sin(2 * l);

export type SunTimes =
  | { kind: 'normal'; sunrise: Date; sunset: Date }
  | { kind: 'polar-day' }
  | { kind: 'polar-night' };

/** Sunrise and sunset around the given moment (use midday of the day you want). */
export function sunTimes(date: Date, point: GeoPoint): SunTimes {
  const lw = RAD * -point.longitude;
  const phi = RAD * point.latitude;
  const d = toDays(date);
  const n = Math.round(d - J0 - lw / (2 * Math.PI));
  const ds = approxTransit(0, lw, n);
  const m = meanAnomaly(ds);
  const l = eclipticLongitude(m);
  const dec = declination(l);
  const noon = transitJ(ds, m, l);
  const cosH = (Math.sin(HORIZON) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec));
  if (cosH > 1) return { kind: 'polar-night' };
  if (cosH < -1) return { kind: 'polar-day' };
  const set = transitJ(approxTransit(Math.acos(cosH), lw, n), m, l);
  return { kind: 'normal', sunrise: fromJulian(noon - (set - noon)), sunset: fromJulian(set) };
}

/** Day length in minutes, for normal days. */
export function dayLengthMinutes(times: SunTimes): number | null {
  return times.kind === 'normal' ? Math.round((times.sunset.getTime() - times.sunrise.getTime()) / 60_000) : null;
}
