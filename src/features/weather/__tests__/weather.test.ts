import { setupRepositories } from '../../../../test/fixtures';
import { cachedFetch, createRemoteCacheRepository } from '../../remote/remoteCacheRepository';
import { describeCode, forecastUrl, outlookFor, packingHints, parseForecast, weatherCacheKey, type DailyForecast } from '../weather';
import { getForecast } from '../weatherService';

const MUNNAR = { latitude: 10.0889, longitude: 77.0595 };
const days = (n: number, start = '2026-11-20') =>
  Array.from({ length: n }, (_, i) => {
    const d = new Date(`${start}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + i);
    return d.toISOString().slice(0, 10);
  });
const body = {
  latitude: 10.09,
  longitude: 77.06,
  timezone: 'Asia/Kolkata',
  current: { time: '2026-11-20T09:00', temperature_2m: 18.4, relative_humidity_2m: 82, weather_code: 61, wind_speed_10m: 9.5 },
  daily: {
    time: days(16),
    weather_code: [61, 3, ...Array(14).fill(1)],
    temperature_2m_max: [22, 24, ...Array(14).fill(25)],
    temperature_2m_min: [11, 13, ...Array(14).fill(14)],
    precipitation_probability_max: [80, 20, ...Array(14).fill(10)],
    wind_speed_10m_max: [15, 12, ...Array(14).fill(10)],
    uv_index_max: [7, 5, ...Array(14).fill(4)],
  },
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });

describe('Open-Meteo forecasts', () => {
  it('asks for current and 16-day values for the coordinates only (no key)', () => {
    const url = new URL(forecastUrl(MUNNAR.latitude, MUNNAR.longitude));
    expect(url.origin + url.pathname).toBe('https://api.open-meteo.com/v1/forecast');
    expect(url.searchParams.get('forecast_days')).toBe('16');
    expect([...url.searchParams.keys()].sort()).toEqual(['current', 'daily', 'forecast_days', 'latitude', 'longitude', 'timezone']);
  });

  it('parses values and leaves missing ones empty (never invented)', () => {
    const f = parseForecast({ ...body, daily: { ...body.daily, temperature_2m_max: [22, null] } });
    expect(f.current).toEqual({ temperatureC: 18.4, humidity: 82, windKmh: 9.5, code: 61, time: '2026-11-20T09:00' });
    expect(f.daily[0]).toEqual({ date: '2026-11-20', code: 61, maxC: 22, minC: 11, rainChance: 80, windMaxKmh: 15, uvMax: 7 });
    expect(f.daily[1]!.maxC).toBeNull();
    expect(parseForecast({}).daily).toEqual([]);
    expect(describeCode(61).label).toBe('Rain');
    expect(describeCode(null).label).toBe('Unknown');
  });

  it('marks days more than a week ahead uncertain, beyond 16 days unavailable, past days past', () => {
    const f = parseForecast(body);
    expect(outlookFor(f, '2026-11-21', '2026-11-20')).toMatchObject({ kind: 'forecast', certainty: 'reliable' });
    expect(outlookFor(f, '2026-11-30', '2026-11-20')).toMatchObject({ kind: 'forecast', certainty: 'uncertain' });
    expect(outlookFor(f, '2026-12-20', '2026-11-20')).toEqual({ kind: 'beyond_horizon', availableFrom: '2026-12-05' });
    expect(outlookFor(f, '2026-11-19', '2026-11-20')).toEqual({ kind: 'past' });
    expect(outlookFor(null, '2026-11-21', '2026-11-20')).toEqual({ kind: 'missing' });
  });

  it('suggests packing only from real forecast values', () => {
    const f = parseForecast(body);
    expect(packingHints(f.daily.slice(0, 2)).map((h) => h.key)).toEqual(['rain', 'cold', 'sun']);
    const hot: DailyForecast = { date: '2026-11-20', code: 0, maxC: 36, minC: 26, rainChance: 0, windMaxKmh: 50, uvMax: 11 };
    expect(packingHints([hot]).map((h) => h.key)).toEqual(['heat', 'sun', 'wind']);
    expect(packingHints([])).toEqual([]);
    expect(packingHints([{ date: 'x', code: null, maxC: null, minC: null, rainChance: null, windMaxKmh: null, uvMax: null }])).toEqual([]);
  });
});

describe('forecast cache (usage limits, offline)', () => {
  async function setup() {
    const r = await setupRepositories();
    return createRemoteCacheRepository(r.database);
  }

  it('fetches once, then reuses the saved forecast for 3 hours; nearby destinations share it', async () => {
    const cache = await setup();
    const fetchImpl = jest.fn(async () => json(body)) as unknown as typeof fetch;
    const now = new Date('2026-11-20T08:00:00Z');
    const first = await getForecast(MUNNAR, { cache, fetchImpl, now });
    expect(first.from).toBe('live');
    expect((await getForecast({ latitude: 10.0901, longitude: 77.0599 }, { cache, fetchImpl, now: new Date('2026-11-20T10:00:00Z') })).from).toBe('cache');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(weatherCacheKey(10.0889, 77.0595)).toBe(weatherCacheKey(10.0901, 77.0599));
    expect((await getForecast(MUNNAR, { cache, fetchImpl, now: new Date('2026-11-20T12:00:00Z') })).from).toBe('live');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('offline: shows the saved forecast marked stale; with nothing saved, says so', async () => {
    const cache = await setup();
    await getForecast(MUNNAR, { cache, fetchImpl: (async () => json(body)) as unknown as typeof fetch, now: new Date('2026-11-20T08:00:00Z') });
    const offline = (async () => {
      throw new TypeError('Network request failed');
    }) as unknown as typeof fetch;
    const stale = await getForecast(MUNNAR, { cache, fetchImpl: offline, now: new Date('2026-11-21T08:00:00Z') });
    expect(stale.from).toBe('stale_cache');
    expect(stale.fetchedAt).toBe('2026-11-20T08:00:00.000Z');
    await expect(getForecast({ latitude: 30, longitude: 30 }, { cache, fetchImpl: offline })).rejects.toMatchObject({ kind: 'offline' });
  });

  it('busy or unavailable service: a clear error, nothing made up', async () => {
    const cache = await setup();
    await expect(getForecast(MUNNAR, { cache, fetchImpl: (async () => json({}, 429)) as unknown as typeof fetch })).rejects.toMatchObject({ kind: 'busy' });
    await expect(getForecast(MUNNAR, { cache, fetchImpl: (async () => json({ daily: {} })) as unknown as typeof fetch })).rejects.toMatchObject({ kind: 'unavailable' });
  });

  it('cachedFetch: fresh cache wins, failures fall back to any cache', async () => {
    const cache = await setup();
    const now = new Date('2026-11-20T00:00:00Z');
    expect((await cachedFetch(cache, { key: 'k', kind: 'x', source: 's', maxAgeMs: 1000, now }, async () => 1)).from).toBe('live');
    expect((await cachedFetch(cache, { key: 'k', kind: 'x', source: 's', maxAgeMs: 1000, now }, async () => 2)).payload).toBe(1);
    const later = new Date(now.getTime() + 5000);
    await expect(cachedFetch(cache, { key: 'k', kind: 'x', source: 's', maxAgeMs: 1000, now: later }, async () => Promise.reject(new Error('down')))).resolves.toMatchObject({ payload: 1, from: 'stale_cache' });
    await expect(cachedFetch(cache, { key: 'other', kind: 'x', source: 's', maxAgeMs: 1000, now }, async () => Promise.reject(new Error('down')))).rejects.toThrow('down');
  });
});
