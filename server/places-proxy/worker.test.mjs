// Tests for the places proxy (no network: Google is replaced by a fake fetch).
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import worker, { followShortLink } from './worker.mjs';

const ENV = { GOOGLE_PLACES_KEY: 'test-key-not-real' };
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Replaces fetch; records every call. */
function fakeGoogle(handler) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const call = { url: String(url), method: init.method ?? 'GET', headers: init.headers ?? {}, body: init.body ? JSON.parse(init.body) : null };
    calls.push(call);
    return handler(call);
  };
  return calls;
}
const ok = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
const post = (path, body, env = ENV) => worker.fetch(new Request(`https://proxy.example${path}`, { method: 'POST', body: JSON.stringify(body) }), env);

const ATTUKAD = {
  id: 'ChIJattukad',
  displayName: { text: 'Attukad Waterfalls' },
  formattedAddress: 'Attukad Waterfall Rd, Pallivasal, Kerala 685612, India',
  location: { latitude: 10.0534, longitude: 77.0588 },
  types: ['tourist_attraction', 'natural_feature'],
  rating: 4.3,
  userRatingCount: 5120,
  addressComponents: [
    { longText: 'Pallivasal', types: ['locality', 'political'] },
    { longText: 'Idukki', types: ['administrative_area_level_2', 'political'] },
    { longText: 'Kerala', types: ['administrative_area_level_1', 'political'] },
    { longText: 'India', types: ['country', 'political'] },
  ],
  plusCode: { globalCode: '7J2V3335+9GH' },
  googleMapsUri: 'https://maps.google.com/?cid=1',
};

describe('places proxy', () => {
  it('says it is not configured without a key (never calls Google)', async () => {
    const calls = fakeGoogle(() => ok({}));
    const res = await post('/autocomplete', { input: 'Munnar' }, {});
    assert.equal(res.status, 503);
    assert.deepEqual(await res.json(), { error: 'not_configured' });
    assert.equal(calls.length, 0);
  });

  it('autocomplete sends the input, session token and bias, and returns name + locality lines', async () => {
    const calls = fakeGoogle(() =>
      ok({ suggestions: [{ placePrediction: { placeId: 'ChIJmunnar', structuredFormat: { mainText: { text: 'Munnar' }, secondaryText: { text: 'Idukki, Kerala, India' } }, types: ['locality'] } }] }),
    );
    const res = await post('/autocomplete', { input: 'munn', sessionToken: 'session-1', bias: { latitude: 10, longitude: 77 } });
    const body = await res.json();
    assert.deepEqual(body.suggestions, [{ providerPlaceId: 'ChIJmunnar', primaryText: 'Munnar', secondaryText: 'Idukki, Kerala, India', types: ['locality'], distanceMeters: null }]);
    assert.equal(calls[0].url, 'https://places.googleapis.com/v1/places:autocomplete');
    assert.equal(calls[0].body.sessionToken, 'session-1');
    assert.equal(calls[0].body.input, 'munn');
    assert.ok(calls[0].body.locationBias.circle);
    assert.equal(calls[0].headers['X-Goog-Api-Key'], 'test-key-not-real');
    // Too short: no request at all.
    assert.deepEqual(await (await post('/autocomplete', { input: 'm' })).json(), { suggestions: [] });
    assert.equal(calls.length, 1);
  });

  it('details returns district, state, locality and Plus Code, with the session token', async () => {
    const calls = fakeGoogle(() => ok(ATTUKAD));
    const body = await (await post('/details', { placeId: 'ChIJattukad', sessionToken: 'session-1' })).json();
    assert.equal(calls[0].url, 'https://places.googleapis.com/v1/places/ChIJattukad?sessionToken=session-1');
    assert.match(calls[0].headers['X-Goog-FieldMask'], /addressComponents/);
    assert.equal(body.place.name, 'Attukad Waterfalls');
    assert.deepEqual(body.place.location, { latitude: 10.0534, longitude: 77.0588 });
    assert.equal(body.place.district, 'Idukki');
    assert.equal(body.place.state, 'Kerala');
    assert.equal(body.place.country, 'India');
    assert.equal(body.place.metadata.locality, 'Pallivasal');
    assert.equal(body.place.metadata.plusCode, '7J2V3335+9GH');
  });

  it('rejects malformed place ids', async () => {
    fakeGoogle(() => ok({}));
    assert.equal((await post('/details', { placeId: '../secrets' })).status, 400);
  });

  it('nearby passes types, radius (capped at 50 km) and ranking', async () => {
    const calls = fakeGoogle(() => ok({ places: [ATTUKAD] }));
    const body = await (await post('/nearby', { location: { latitude: 10, longitude: 77 }, radiusMeters: 999999, includedTypes: ['park'], rankPreference: 'DISTANCE' })).json();
    assert.equal(calls[0].body.locationRestriction.circle.radius, 50000);
    assert.deepEqual(calls[0].body.includedTypes, ['park']);
    assert.equal(calls[0].body.rankPreference, 'DISTANCE');
    assert.equal(body.places.length, 1);
    await post('/nearby', { location: { latitude: 10, longitude: 77 }, radiusMeters: 5000, rankPreference: 'NONSENSE' });
    assert.equal(calls[1].body.rankPreference, undefined);
  });

  it('text search pages with a token and returns the next one', async () => {
    const calls = fakeGoogle((c) => ok({ places: [ATTUKAD], ...(c.body.pageToken ? {} : { nextPageToken: 'next-1' }) }));
    const first = await (await post('/text', { query: 'waterfall', bias: { latitude: 10, longitude: 77 }, radiusMeters: 25000 })).json();
    assert.equal(first.nextPageToken, 'next-1');
    assert.equal(calls[0].body.locationBias.circle.radius, 25000);
    assert.match(calls[0].headers['X-Goog-FieldMask'], /nextPageToken/);
    const second = await (await post('/text', { query: 'waterfall', pageToken: 'next-1' })).json();
    assert.equal(calls[1].body.pageToken, 'next-1');
    assert.equal(second.nextPageToken, null);
  });

  it('maps Google errors to kinds the app understands', async () => {
    fakeGoogle(() => new Response('{}', { status: 429 }));
    assert.deepEqual(await (await post('/text', { query: 'x' })).json(), { error: 'quota' });
    fakeGoogle(() => new Response('{}', { status: 403 }));
    assert.deepEqual(await (await post('/text', { query: 'x' })).json(), { error: 'denied' });
  });
});

describe('short link resolution', () => {
  const redirect = (location) => new Response(null, { status: 302, headers: { Location: location } });

  it('follows maps.app.goo.gl to the final Google Maps URL', async () => {
    const calls = fakeGoogle((c) =>
      c.url.startsWith('https://maps.app.goo.gl/') ? redirect('https://www.google.com/maps/place/Attukad+Waterfalls/@10.05,77.05,17z/data=!3d10.0534!4d77.0588') : ok({}),
    );
    const body = await (await post('/resolve-link', { url: 'https://maps.app.goo.gl/8zeE1LFGqptD1vu9A' })).json();
    assert.equal(body.url, 'https://www.google.com/maps/place/Attukad+Waterfalls/@10.05,77.05,17z/data=!3d10.0534!4d77.0588');
    assert.equal(calls.length, 1);
  });

  it('refuses links that are not Google Maps short links (no open proxy)', async () => {
    const calls = fakeGoogle(() => ok({}));
    assert.equal((await post('/resolve-link', { url: 'https://example.com/x' })).status, 400);
    assert.equal((await post('/resolve-link', { url: 'http://maps.app.goo.gl/abc' })).status, 400);
    assert.equal(calls.length, 0);
  });

  it('stops when a redirect leaves Google', async () => {
    const fetchImpl = async () => new Response(null, { status: 302, headers: { Location: 'https://evil.example/maps' } });
    assert.equal(await followShortLink('https://maps.app.goo.gl/abc', fetchImpl), null);
  });

  it('reads the Maps link from an interstitial page', async () => {
    const fetchImpl = async () => new Response('<a href="https://www.google.com/maps/place/Top+Station/@10.12,77.24,15z">open</a>', { status: 200 });
    assert.equal(await followShortLink('https://maps.app.goo.gl/abc', fetchImpl), 'https://www.google.com/maps/place/Top+Station/@10.12,77.24,15z');
  });

  it('reports not found when the link cannot be resolved', async () => {
    fakeGoogle(() => new Response('gone', { status: 404 }));
    assert.deepEqual(await (await post('/resolve-link', { url: 'https://maps.app.goo.gl/missing' })).json(), { error: 'not_found' });
  });
});
