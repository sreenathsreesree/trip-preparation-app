import { parseCoordinates, parseMapsUrl } from '../places/sharedLocation';
import { isValidLocation, type GeoPoint } from './model';

/**
 * Reads a location the user typed or pasted: plain coordinates
 * ("10.0889, 77.0595") or a full Google Maps link that contains coordinates.
 * Short share links (maps.app.goo.gl) can't be read offline, so they are
 * reported rather than guessed.
 */
export type ParsedLocation = { ok: true; location: GeoPoint } | { ok: false; reason: string };

const NUM = String.raw`(-?\d{1,3}(?:\.\d+)?)`;
const PATTERNS: RegExp[] = [
  // !3d<lat>!4d<lng> — the pinned place in a full Maps link (most precise).
  new RegExp(String.raw`!3d${NUM}!4d${NUM}`),
  // ?q= / query= / destination= / ll= / center= with "lat,lng".
  new RegExp(String.raw`[?&](?:q|query|destination|daddr|ll|center|sll)=${NUM}(?:,|%2C)\s*${NUM}`, 'i'),
  // /@lat,lng,zoom — the map view.
  new RegExp(String.raw`@${NUM},${NUM}`),
];

function point(lat: string | undefined, lng: string | undefined): GeoPoint | null {
  const location = { latitude: Number(lat), longitude: Number(lng) };
  return isValidLocation(location) ? location : null;
}

export function parseLocation(input: string): ParsedLocation {
  const text = input.trim();
  if (!text) return { ok: false, reason: 'Paste a Google Maps link or enter coordinates.' };

  const plain = new RegExp(String.raw`^${NUM}\s*[,\s]\s*${NUM}$`).exec(text);
  if (plain) {
    const location = point(plain[1], plain[2]);
    return location
      ? { ok: true, location }
      : { ok: false, reason: 'Latitude must be between −90 and 90, and longitude between −180 and 180.' };
  }
  const coords = parseCoordinates(text);
  if (coords) return { ok: true, location: coords };

  if (/^https?:\/\//i.test(text)) {
    if (/(?:maps\.app\.goo\.gl|goo\.gl\/maps)/i.test(text)) {
      return {
        ok: false,
        reason: 'Short share links are opened when you search with them above (online). Or long-press the pin in Google Maps and copy the coordinates.',
      };
    }
    for (const pattern of PATTERNS) {
      const match = pattern.exec(text);
      const location = match ? point(match[1], match[2]) : null;
      if (location) return { ok: true, location };
    }
    const fromUrl = parseMapsUrl(text).location;
    if (fromUrl) return { ok: true, location: fromUrl };
    return { ok: false, reason: 'That link has no coordinates in it. Long-press the pin in Google Maps and copy the coordinates instead.' };
  }
  return { ok: false, reason: 'Enter coordinates like “10.0889, 77.0595” or paste a Google Maps link.' };
}

export function formatCoordinates(location: GeoPoint): string {
  return `${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)}`;
}
