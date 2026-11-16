// Places proxy tests: the budgeted request flow end to end. No network: Google is a fake
// fetch, and the Durable Object runs in memory with the real ledger code.
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { PlacesBudget } from './budget.mjs';
import { ENV as BUDGET_ENV, memoryStorage } from './test-helpers.mjs';
import worker, { DETAILS_FIELDS, followShortLink } from './worker.mjs';

const KEY = 'test-google-key-not-real-123';
const ADMIN = 'admin-token-for-tests-only-0123456789';
const TOKEN = '1a2b3c4d-1111-4222-a333-444455556666';

/** An in-memory Durable Object namespace backed by the real PlacesBudget class. */
function fakeNamespace({ failing = false } = {}) {
  const storage = memoryStorage({ failing });
  const object = new PlacesBudget({ storage });
  return {
    storage,
    idFromName: (name) => name,
    get: () => ({ fetch: (url, init) => object.fetch(new Request(url, init)) }),
  };
}

function makeEnv(overrides = {}) {
  return { ...BUDGET_ENV, GOOGLE_PLACES_KEY: KEY, ADMIN_TOKEN: ADMIN, GOOGLE_PLACES_ENABLED: 'true', GOOGLE_ENDPOINTS: 'autocomplete,details', PLACES_BUDGET: fakeNamespace(), ...overrides };
}

const realFetch = globalThis.fetch;
const realLog = console.log;
let logs = [];
beforeEach(() => {
  logs = [];
  console.log = (line) => logs.push(String(line));
});
afterEach(() => {
  globalThis.fetch = realFetch;
  console.log = realLog;
});

/** Replaces fetch (Google); records every call. */
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
const post = (env, path, body) => worker.fetch(new Request(`https://proxy.example${path}`, { method: 'POST', body: JSON.stringify(body) }), env);
const admin = (env, token = ADMIN) => worker.fetch(new Request('https://proxy.example/admin/usage', { headers: token ? { Authorization: `Bearer ${token}` } : {} }), env);

const ATTUKAD = {
  id: 'ChIJattukad',
  formattedAddress: 'Attukad Waterfall Rd, Pallivasal, Kerala 685612, India',
  location: { latitude: 10.0534, longitude: 77.0588 },
  types: ['tourist_attraction'],
  addressComponents: [
    { longText: 'Pallivasal', types: ['locality'] },
    { longText: 'Idukki', types: ['administrative_area_level_2'] },
    { longText: 'Kerala', types: ['administrative_area_level_1'] },
    { longText: 'India', types: ['country'] },
  ],
  plusCode: { globalCode: '7J2V3335+9GH' },
};
const SUGGESTIONS = { suggestions: [{ placePrediction: { placeId: 'ChIJattukad', structuredFormat: { mainText: { text: 'Attukad Waterfalls' }, secondaryText: { text: 'Pallivasal, Kerala' } }, types: ['tourist_attraction'] } }] };

describe('budgeted Google requests', () => {
  it('autocomplete: sends the session token and accounts one Autocomplete request', async () => {
    const env = makeEnv();
    const calls = fakeGoogle(() => ok(SUGGESTIONS));
    const res = await post(env, '/autocomplete', { input: 'attuk', sessionToken: TOKEN, bias: { latitude: 10, longitude: 77 } });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).suggestions[0].primaryText, 'Attukad Waterfalls');
    assert.equal(calls[0].url, 'https://places.googleapis.com/v1/places:autocomplete');
    assert.equal(calls[0].body.sessionToken, TOKEN);
    const usage = await (await admin(env)).json();
    assert.deepEqual(usage.skus, { autocomplete_request: { requests: 1, inr: 0.330601 } });
    assert.deepEqual(usage.upstream, { ok: 1, failed: 0 });
  });

  it('autocomplete without a session token is refused before anything is spent', async () => {
    const env = makeEnv();
    const calls = fakeGoogle(() => ok(SUGGESTIONS));
    assert.equal((await post(env, '/autocomplete', { input: 'attuk' })).status, 400);
    assert.equal(calls.length, 0);
  });

  it('place details with the tapped name uses an Essentials-only mask and is accounted as Essentials', async () => {
    const env = makeEnv();
    const calls = fakeGoogle(() => ok(ATTUKAD));
    const body = await (await post(env, '/details', { placeId: 'ChIJattukad', sessionToken: TOKEN, nameHint: 'Attukad Waterfalls' })).json();
    assert.equal(calls[0].url, `https://places.googleapis.com/v1/places/ChIJattukad?sessionToken=${TOKEN}`);
    assert.equal(calls[0].headers['X-Goog-FieldMask'], DETAILS_FIELDS.join(','));
    assert.ok(!/displayName|rating|photos|editorialSummary|googleMapsUri|currentOpeningHours/.test(calls[0].headers['X-Goog-FieldMask']));
    assert.equal(body.place.name, 'Attukad Waterfalls');
    assert.deepEqual(body.place.location, { latitude: 10.0534, longitude: 77.0588 });
    assert.equal(body.place.metadata.plusCode, '7J2V3335+9GH');
    assert.equal((await (await admin(env)).json()).skus.place_details_essentials.requests, 1);
  });

  it('a shared-link Place ID lookup without a name asks for displayName and is accounted as Pro', async () => {
    const env = makeEnv();
    const calls = fakeGoogle(() => ok({ ...ATTUKAD, displayName: { text: 'Attukad Waterfalls' } }));
    const body = await (await post(env, '/details', { placeId: 'ChIJattukad' })).json();
    assert.match(calls[0].headers['X-Goog-FieldMask'], /displayName/);
    assert.equal(body.place.name, 'Attukad Waterfalls');
    assert.equal((await (await admin(env)).json()).skus.place_details_pro.requests, 1);
  });

  it('blocks at the ₹70 allowance with GOOGLE_BUDGET_EXHAUSTED, without calling Google', async () => {
    const env = makeEnv({ BUDGET_ALLOWANCE_INR: '1', BUDGET_RESERVE_INR: '30' });
    const calls = fakeGoogle(() => ok(SUGGESTIONS));
    for (let i = 0; i < 3; i++) assert.equal((await post(env, '/autocomplete', { input: 'attuk', sessionToken: TOKEN })).status, 200); // ₹0.99
    const res = await post(env, '/autocomplete', { input: 'attuk', sessionToken: TOKEN });
    assert.equal(res.status, 503);
    assert.deepEqual(await res.json(), { error: 'budget_exhausted', code: 'GOOGLE_BUDGET_EXHAUSTED' });
    assert.equal(calls.length, 3);
    const usage = await (await admin(env)).json();
    assert.equal(usage.blocked.GOOGLE_BUDGET_EXHAUSTED, 1);
    assert.ok(usage.estimatedInr <= 1);
  });

  it('daily limit reached: refused as budget_exhausted / GOOGLE_DAILY_LIMIT', async () => {
    const env = makeEnv({ DAILY_LIMITS: '{"autocomplete_request": 1, "details": 1}' });
    fakeGoogle(() => ok(SUGGESTIONS));
    assert.equal((await post(env, '/autocomplete', { input: 'attuk', sessionToken: TOKEN })).status, 200);
    assert.deepEqual(await (await post(env, '/autocomplete', { input: 'attuk', sessionToken: TOKEN })).json(), { error: 'budget_exhausted', code: 'GOOGLE_DAILY_LIMIT' });
  });

  it('concurrent requests through the proxy cannot exceed the allowance', async () => {
    const env = makeEnv({ BUDGET_ALLOWANCE_INR: '2', BUDGET_RESERVE_INR: '30', BUDGET_TOTAL_INR: '100' });
    const calls = fakeGoogle(() => ok(SUGGESTIONS));
    const results = await Promise.all(Array.from({ length: 20 }, () => post(env, '/autocomplete', { input: 'attuk', sessionToken: TOKEN })));
    const allowed = results.filter((r) => r.status === 200).length;
    assert.equal(allowed, 6); // 6 × ₹0.3306 = ₹1.98 ≤ ₹2
    assert.equal(calls.length, 6);
  });

  it('fails closed: switched off, unverified pricing, missing ledger, storage failure, unknown SKU', async () => {
    const calls = fakeGoogle(() => ok(SUGGESTIONS));
    const req = { input: 'attuk', sessionToken: TOKEN };
    assert.deepEqual(await (await post(makeEnv({ GOOGLE_PLACES_ENABLED: 'false' }), '/autocomplete', req)).json(), { error: 'disabled', code: 'GOOGLE_DISABLED' });
    assert.deepEqual(await (await post(makeEnv({ GOOGLE_PLACES_KEY: '' }), '/autocomplete', req)).json(), { error: 'not_configured', code: 'GOOGLE_NOT_CONFIGURED' });
    const unverified = JSON.stringify({ ...JSON.parse(BUDGET_ENV.PLACES_PRICING), verifiedOn: null });
    assert.deepEqual(await (await post(makeEnv({ PLACES_PRICING: unverified }), '/autocomplete', req)).json(), { error: 'disabled', code: 'GOOGLE_BUDGET_CONFIG_INVALID' });
    assert.deepEqual(await (await post(makeEnv({ PLACES_BUDGET: undefined }), '/autocomplete', req)).json(), { error: 'disabled', code: 'GOOGLE_BUDGET_UNAVAILABLE' });
    assert.deepEqual(await (await post(makeEnv({ PLACES_BUDGET: fakeNamespace({ failing: true }) }), '/autocomplete', req)).json(), { error: 'disabled', code: 'GOOGLE_BUDGET_UNAVAILABLE' });
    assert.deepEqual(await (await post(makeEnv({ GOOGLE_ENDPOINTS: 'details' }), '/autocomplete', req)).json(), { error: 'disabled', code: 'GOOGLE_ENDPOINT_DISABLED' });
    assert.equal(calls.length, 0, 'Google was never called');
  });

  it('Nearby Search, Text Search and Photos are disabled for Google', async () => {
    const env = makeEnv({ GOOGLE_ENDPOINTS: 'autocomplete,details,nearby,text' });
    const calls = fakeGoogle(() => ok({ places: [ATTUKAD] }));
    for (const path of ['/nearby', '/text']) {
      const res = await post(env, path, { location: { latitude: 10, longitude: 77 }, radiusMeters: 5000, query: 'waterfall' });
      assert.deepEqual([res.status, await res.json()], [503, { error: 'disabled', code: 'GOOGLE_ENDPOINT_DISABLED' }]);
    }
    const photo = await worker.fetch(new Request('https://proxy.example/photo?name=places/x/photos/y&maxWidthPx=400'), env);
    assert.equal(photo.status, 503);
    assert.equal(calls.length, 0);
  });

  it('a failed Google request is recorded and its reservation is not refunded', async () => {
    const env = makeEnv();
    fakeGoogle(() => new Response('{}', { status: 500 }));
    assert.equal((await post(env, '/autocomplete', { input: 'attuk', sessionToken: TOKEN })).status, 502);
    const usage = await (await admin(env)).json();
    assert.deepEqual(usage.upstream, { ok: 0, failed: 1 });
    assert.equal(usage.skus.autocomplete_request.requests, 1);
  });

  it('maps Google quota / refusal to kinds the app understands', async () => {
    fakeGoogle(() => new Response('{}', { status: 429 }));
    assert.deepEqual(await (await post(makeEnv(), '/autocomplete', { input: 'x1', sessionToken: TOKEN })).json(), { error: 'quota' });
    fakeGoogle(() => new Response('{}', { status: 403 }));
    assert.deepEqual(await (await post(makeEnv(), '/autocomplete', { input: 'x1', sessionToken: TOKEN })).json(), { error: 'denied' });
  });
});

describe('administration and secrets', () => {
  it('the usage endpoint needs the admin token', async () => {
    const env = makeEnv();
    assert.equal((await admin(env, null)).status, 401);
    assert.equal((await admin(env, 'wrong-token')).status, 401);
    assert.equal((await admin(makeEnv({ ADMIN_TOKEN: undefined }), ADMIN)).status, 401);
    const res = await admin(env);
    assert.equal(res.status, 200);
    const body = await res.json();
    for (const field of ['month', 'estimatedInr', 'remainingAllowanceInr', 'reserveInr', 'todayUsage', 'skus', 'blocked', 'googleEnabled', 'lastAccountingUpdate', 'history']) assert.ok(field in body, field);
    assert.equal(body.allowanceInr, 70);
    assert.equal(body.reserveInr, 30);
  });

  it('never exposes the API key, the admin token or search text (responses and logs)', async () => {
    const env = makeEnv();
    fakeGoogle(() => ok(SUGGESTIONS));
    const answers = [
      await (await post(env, '/autocomplete', { input: 'my secret hotel', sessionToken: TOKEN })).text(),
      await (await admin(env)).text(),
      await (await post(makeEnv({ PLACES_PRICING: '{bad' }), '/autocomplete', { input: 'my secret hotel', sessionToken: TOKEN })).text(),
    ];
    const everything = [...answers, ...logs].join('\n');
    assert.ok(!everything.includes(KEY));
    assert.ok(!everything.includes(ADMIN));
    assert.ok(!logs.join('\n').includes('my secret hotel'));
    assert.ok(logs.some((l) => JSON.parse(l).event === 'google_request'));
  });
});

describe('short link resolution (free: no Google API, no budget)', () => {
  const redirect = (location) => new Response(null, { status: 302, headers: { Location: location } });

  it('follows maps.app.goo.gl to the final Google Maps URL even with Google switched off', async () => {
    const calls = fakeGoogle((c) =>
      c.url.startsWith('https://maps.app.goo.gl/') ? redirect('https://www.google.com/maps/place/Attukad+Waterfalls/@10.05,77.05,17z/data=!3d10.0534!4d77.0588') : ok({}),
    );
    const env = makeEnv({ GOOGLE_PLACES_ENABLED: 'false', GOOGLE_PLACES_KEY: '' });
    const body = await (await post(env, '/resolve-link', { url: 'https://maps.app.goo.gl/8zeE1LFGqptD1vu9A' })).json();
    assert.equal(body.url, 'https://www.google.com/maps/place/Attukad+Waterfalls/@10.05,77.05,17z/data=!3d10.0534!4d77.0588');
    assert.equal(calls.length, 1);
    assert.ok(!calls[0].url.includes('googleapis'));
  });

  it('refuses links that are not Google Maps short links (no open proxy)', async () => {
    const calls = fakeGoogle(() => ok({}));
    assert.equal((await post(makeEnv(), '/resolve-link', { url: 'https://example.com/x' })).status, 400);
    assert.equal((await post(makeEnv(), '/resolve-link', { url: 'http://maps.app.goo.gl/abc' })).status, 400);
    assert.equal(calls.length, 0);
  });

  it('stops when a redirect leaves Google, and reads interstitial pages', async () => {
    assert.equal(await followShortLink('https://maps.app.goo.gl/abc', async () => new Response(null, { status: 302, headers: { Location: 'https://evil.example/maps' } })), null);
    assert.equal(
      await followShortLink('https://maps.app.goo.gl/abc', async () => new Response('<a href="https://www.google.com/maps/place/Top+Station/@10.12,77.24,15z">open</a>', { status: 200 })),
      'https://www.google.com/maps/place/Top+Station/@10.12,77.24,15z',
    );
  });
});
