import { emptyProfile } from '../companion';
import { formatCoordinates, parseLocation } from '../locationInput';
import type { PlanNode } from '../model';
import { destinationShareText } from '../share';
import { dayLengthMinutes, sunTimes } from '../sun';

const minutesUtc = (d: Date) => d.getUTCHours() * 60 + d.getUTCMinutes();

describe('sunrise and sunset', () => {
  it('matches published times for Munnar within a few minutes', () => {
    // Munnar, 1 Jan 2026: sunrise ≈ 06:40 IST (01:10 UTC), sunset ≈ 18:13 IST (12:43 UTC).
    const t = sunTimes(new Date('2026-01-01T06:30:00Z'), { latitude: 10.0889, longitude: 77.0595 });
    expect(t.kind).toBe('normal');
    if (t.kind !== 'normal') return;
    expect(Math.abs(minutesUtc(t.sunrise) - 70)).toBeLessThanOrEqual(6);
    expect(Math.abs(minutesUtc(t.sunset) - 763)).toBeLessThanOrEqual(6);
    expect(dayLengthMinutes(t)).toBeGreaterThan(680);
    expect(dayLengthMinutes(t)).toBeLessThan(705);
  });

  it('reports polar day and night instead of inventing times', () => {
    const tromso = { latitude: 69.65, longitude: 18.96 };
    expect(sunTimes(new Date('2026-12-21T11:00:00Z'), tromso).kind).toBe('polar-night');
    expect(sunTimes(new Date('2026-06-21T11:00:00Z'), tromso).kind).toBe('polar-day');
    expect(dayLengthMinutes({ kind: 'polar-day' })).toBeNull();
  });
});

describe('reading a pasted location', () => {
  const ok = (text: string) => {
    const r = parseLocation(text);
    return r.ok ? [r.location.latitude, r.location.longitude] : r.reason;
  };

  it('reads plain coordinates', () => {
    expect(ok('10.0889, 77.0595')).toEqual([10.0889, 77.0595]);
    expect(ok(' -33.8568 151.2153 ')).toEqual([-33.8568, 151.2153]);
    expect(ok('95, 10')).toMatch(/between −90 and 90/);
  });

  it('reads full Google Maps links, preferring the pinned place', () => {
    expect(ok('https://www.google.com/maps/place/Munnar/@10.08,77.05,13z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d10.0889!4d77.0595')).toEqual([10.0889, 77.0595]);
    expect(ok('https://www.google.com/maps/@10.1,77.2,15z')).toEqual([10.1, 77.2]);
    expect(ok('https://www.google.com/maps/search/?api=1&query=10.2%2C77.3')).toEqual([10.2, 77.3]);
    expect(ok('https://maps.google.com/?q=10.3,77.4')).toEqual([10.3, 77.4]);
  });

  it('explains links it cannot read instead of guessing', () => {
    expect(ok('https://maps.app.goo.gl/abc123')).toMatch(/Short share links/);
    expect(ok('https://www.google.com/maps/place/Munnar')).toMatch(/no coordinates/);
    expect(ok('Munnar')).toMatch(/Enter coordinates/);
    expect(ok('')).toMatch(/Paste/);
  });

  it('formats coordinates', () => {
    expect(formatCoordinates({ latitude: 10.0889, longitude: 77.0595 })).toBe('10.08890, 77.05950');
  });
});

describe('sharing a destination', () => {
  it('includes the user’s own facts and the map link, nothing private', () => {
    const node = { id: 'n', name: 'Echo Point', place: null } as unknown as PlanNode;
    const profile = { ...emptyProfile('n', 't'), about: 'Lake viewpoint', bestTime: 'morning' as const, visitMinutes: 90, tags: ['Must visit'] };
    const text = destinationShareText(node, profile, ['Munnar']);
    expect(text.split('\n').slice(0, 2)).toEqual(['Echo Point', 'Munnar']);
    expect(text).toContain('Best time: Morning');
    expect(text).toContain('Plan for: 1 h 30 min');
    expect(text).toContain('#Mustvisit');
    expect(text).toContain('https://www.google.com/maps/search/?api=1&query=');
  });
});
