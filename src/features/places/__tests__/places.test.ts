import { daysUntilRefresh, isProviderContentExpired, providerCacheCutoff } from '../cachePolicy';
import { isPlacesError, PlacesError, unconfiguredProvider } from '../provider';

describe('provider cache policy', () => {
  const now = new Date('2026-11-30T00:00:00Z');

  it('expires provider content after 30 days', () => {
    expect(isProviderContentExpired('2026-11-01T00:00:01Z', now)).toBe(false);
    expect(isProviderContentExpired('2026-10-31T00:00:00Z', now)).toBe(true);
    expect(isProviderContentExpired(null, now)).toBe(false); // manual places never expire
    expect(isProviderContentExpired('garbage', now)).toBe(true);
    expect(providerCacheCutoff(now)).toBe('2026-10-31T00:00:00.000Z');
  });

  it('counts days until a refresh is needed', () => {
    expect(daysUntilRefresh('2026-11-29T00:00:00Z', now)).toBe(29);
    expect(daysUntilRefresh('2026-10-01T00:00:00Z', now)).toBe(0);
    expect(daysUntilRefresh(null, now)).toBeNull();
  });
});

describe('places provider abstraction', () => {
  it('fails honestly when no provider is configured (never sample data)', async () => {
    expect(unconfiguredProvider.configured).toBe(false);
    const calls = [
      unconfiguredProvider.autocomplete({ input: 'Munnar', sessionToken: 's' }),
      unconfiguredProvider.details('id', {}),
      unconfiguredProvider.nearby({ location: { latitude: 10, longitude: 77 }, radiusMeters: 5000 }),
      unconfiguredProvider.textSearch({ query: 'waterfalls' }),
    ];
    for (const call of calls) {
      const error: unknown = await call.catch((e: unknown) => e);
      expect(isPlacesError(error) && error.kind).toBe('not_configured');
    }
    expect(new PlacesError('quota').message).toMatch(/limit/);
  });
});
