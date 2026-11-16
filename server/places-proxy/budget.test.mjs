// Budget controller tests (no network, no Cloudflare: storage is faked).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { classifyDetailsMask, classifyRequest, costInr, Ledger, loadConfig, localDate, SKUS } from './budget.mjs';

import { ENV, memoryStorage, PRICING } from './test-helpers.mjs';

const config = () => loadConfig(ENV).config;
const reserveArgs = (sku, cfg = config()) => ({ sku, costInr: costInr(sku, cfg), allowanceInr: cfg.allowanceInr, dailyLimit: cfg.dailyLimits[sku === 'autocomplete_request' ? 'autocomplete_request' : 'details'], timeZone: cfg.timeZone });

describe('pricing and SKU classification', () => {
  it('classifies Place Details by the highest-tier field in the mask', () => {
    assert.equal(classifyDetailsMask('id,photos'), 'place_details_ids_only');
    assert.equal(classifyDetailsMask('id,formattedAddress,location,types,addressComponents,plusCode,shortFormattedAddress'), 'place_details_essentials');
    assert.equal(classifyDetailsMask('id,location,displayName'), 'place_details_pro');
    assert.equal(classifyDetailsMask('id,location,rating'), 'place_details_enterprise');
    assert.equal(classifyDetailsMask('id,editorialSummary'), 'place_details_enterprise_atmosphere');
    assert.equal(classifyDetailsMask('places.location'), null, 'list-search masks are not details masks');
  });

  it('refuses unknown fields and endpoints (fail closed)', () => {
    assert.equal(classifyDetailsMask('id,someNewField'), null);
    assert.equal(classifyDetailsMask(''), null);
    assert.equal(classifyRequest('nearby', 'places.id'), null);
    assert.equal(classifyRequest('text', 'places.id'), null);
    assert.equal(classifyRequest('photo', ''), null);
    assert.equal(classifyRequest('autocomplete', 'suggestions.placePrediction.placeId'), 'autocomplete_request');
  });

  it('estimates INR with the exchange-rate buffer and tax, every request counted (no free usage)', () => {
    const cfg = config();
    // 2.83 USD / 1000 × 90 × 1.10 × 1.18
    assert.equal(costInr('autocomplete_request', cfg), 0.330601);
    assert.equal(costInr('place_details_essentials', cfg), 0.5841);
    assert.equal(costInr('place_details_ids_only', cfg), 0);
    const noBuffer = loadConfig({ ...ENV, PLACES_PRICING: JSON.stringify({ ...PRICING, fxBufferPct: 0, taxPct: 0 }) }).config;
    assert.ok(costInr('autocomplete_request', cfg) > costInr('autocomplete_request', noBuffer) * 1.29);
  });

  it('refuses missing, unverified or inconsistent configuration', () => {
    assert.equal(loadConfig(ENV).ok, true);
    assert.match(loadConfig({ ...ENV, PLACES_PRICING: undefined }).reason, /pricing/);
    assert.match(loadConfig({ ...ENV, PLACES_PRICING: '{oops' }).reason, /JSON/);
    assert.match(loadConfig({ ...ENV, PLACES_PRICING: JSON.stringify({ ...PRICING, verifiedOn: null }) }).reason, /not verified/);
    for (const sku of SKUS) {
      const usd = { ...PRICING.usdPer1000 };
      delete usd[sku];
      assert.match(loadConfig({ ...ENV, PLACES_PRICING: JSON.stringify({ ...PRICING, usdPer1000: usd }) }).reason, new RegExp(sku));
    }
    assert.match(loadConfig({ ...ENV, BUDGET_ALLOWANCE_INR: '80' }).reason, /reserve/, 'the ₹30 reserve can never be made spendable');
    assert.match(loadConfig({ ...ENV, DAILY_LIMITS: '{}' }).reason, /daily limit/);
    assert.match(loadConfig({ ...ENV, BILLING_TIMEZONE: 'Mars/Base' }).reason, /time zone/);
  });
});

describe('ledger', () => {
  it('accounts monthly usage per SKU and in total', async () => {
    const ledger = new Ledger(memoryStorage(), () => new Date('2026-11-16T10:00:00Z'));
    for (let i = 0; i < 4; i++) assert.equal((await ledger.reserve(reserveArgs('autocomplete_request'))).ok, true);
    await ledger.reserve(reserveArgs('place_details_essentials'));
    const s = await ledger.status({ ...config(), allowanceInr: 70, reserveInr: 30, totalInr: 100 });
    assert.equal(s.month, '2026-11');
    assert.deepEqual(s.skus.autocomplete_request, { requests: 4, inr: 1.322404 });
    assert.equal(s.skus.place_details_essentials.requests, 1);
    assert.equal(s.estimatedInr, 1.906504);
    assert.equal(s.remainingAllowanceInr, 68.09);
    assert.equal(s.todayUsage.requests, 5);
    assert.ok(s.lastAccountingUpdate);
  });

  it('blocks at the ₹70 allowance and never spends the ₹30 reserve', async () => {
    const ledger = new Ledger(memoryStorage(), () => new Date('2026-11-16T10:00:00Z'));
    const big = { sku: 'place_details_pro', costInr: 20, allowanceInr: 70, dailyLimit: 1000, timeZone: 'America/Los_Angeles' };
    assert.equal((await ledger.reserve(big)).ok, true);
    assert.equal((await ledger.reserve(big)).ok, true);
    assert.equal((await ledger.reserve(big)).ok, true); // ₹60
    const refused = await ledger.reserve(big); // would be ₹80 > ₹70
    assert.deepEqual([refused.ok, refused.code], [false, 'GOOGLE_BUDGET_EXHAUSTED']);
    assert.equal((await ledger.reserve({ ...big, costInr: 10 })).ok, true); // exactly ₹70 is allowed
    assert.equal((await ledger.reserve({ ...big, costInr: 0.01 })).code, 'GOOGLE_BUDGET_EXHAUSTED');
    const s = await ledger.status({ ...config(), allowanceInr: 70, reserveInr: 30, totalInr: 100 });
    assert.equal(s.estimatedInr, 70);
    assert.ok(s.estimatedInr <= 100 - 30, 'usage stays out of the reserve');
    assert.equal(s.blocked.GOOGLE_BUDGET_EXHAUSTED, 2);
  });

  it('enforces the proxy’s own daily limits (Autocomplete and Details separately)', async () => {
    const ledger = new Ledger(memoryStorage(), () => new Date('2026-11-16T10:00:00Z'));
    const args = { ...reserveArgs('autocomplete_request'), dailyLimit: 3 };
    for (let i = 0; i < 3; i++) assert.equal((await ledger.reserve(args)).ok, true);
    assert.equal((await ledger.reserve(args)).code, 'GOOGLE_DAILY_LIMIT');
    assert.equal((await ledger.reserve({ ...reserveArgs('place_details_essentials'), dailyLimit: 3 })).ok, true, 'details have their own daily limit');
  });

  it('a new day in the billing time zone resets the daily limit, not the month', async () => {
    let now = new Date('2026-11-16T07:59:00Z'); // 15 Nov, 23:59 Pacific
    const ledger = new Ledger(memoryStorage(), () => now);
    const args = { ...reserveArgs('autocomplete_request'), dailyLimit: 1 };
    assert.equal((await ledger.reserve(args)).ok, true);
    assert.equal((await ledger.reserve(args)).code, 'GOOGLE_DAILY_LIMIT');
    now = new Date('2026-11-16T08:01:00Z'); // 16 Nov, 00:01 Pacific
    assert.equal((await ledger.reserve(args)).ok, true);
    const s = await ledger.status({ ...config(), allowanceInr: 70, reserveInr: 30, totalInr: 100 });
    assert.equal(s.skus.autocomplete_request.requests, 2);
  });

  it('concurrent requests cannot overspend: check and reserve are atomic', async () => {
    const ledger = new Ledger(memoryStorage({ delay: 2 }), () => new Date('2026-11-16T10:00:00Z'));
    const args = { sku: 'place_details_pro', costInr: 10, allowanceInr: 70, dailyLimit: 1000, timeZone: 'America/Los_Angeles' };
    const results = await Promise.all(Array.from({ length: 25 }, () => ledger.reserve(args)));
    assert.equal(results.filter((r) => r.ok).length, 7);
    assert.equal(results.filter((r) => r.code === 'GOOGLE_BUDGET_EXHAUSTED').length, 18);
    const s = await ledger.status({ ...config(), allowanceInr: 70, reserveInr: 30, totalInr: 100 });
    assert.equal(s.estimatedInr, 70);
  });

  it('month rollover (billing time zone) starts a new month and keeps the old one in history', async () => {
    let now = new Date('2026-12-01T07:30:00Z'); // still 30 Nov in Pacific time
    const ledger = new Ledger(memoryStorage(), () => now);
    const args = { sku: 'place_details_pro', costInr: 35, allowanceInr: 70, dailyLimit: 1000, timeZone: 'America/Los_Angeles' };
    await ledger.reserve(args);
    await ledger.reserve(args);
    assert.equal((await ledger.reserve(args)).code, 'GOOGLE_BUDGET_EXHAUSTED');
    now = new Date('2026-12-01T08:30:00Z'); // 1 Dec, 00:30 Pacific
    const fresh = await ledger.reserve(args);
    assert.deepEqual([fresh.ok, fresh.month], [true, '2026-12']);
    const s = await ledger.status({ ...config(), allowanceInr: 70, reserveInr: 30, totalInr: 100 });
    assert.equal(s.month, '2026-12');
    assert.deepEqual(
      s.history.map((h) => [h.month, h.estimatedInr, h.requests, h.blocked]),
      [
        ['2026-11', 70, 2, 1],
        ['2026-12', 35, 1, 0],
      ],
    );
    assert.equal(localDate(new Date('2026-12-01T07:30:00Z'), 'America/Los_Angeles'), '2026-11-30');
  });

  it('failed upstream requests are recorded and never refunded', async () => {
    const ledger = new Ledger(memoryStorage(), () => new Date('2026-11-16T10:00:00Z'));
    const r = await ledger.reserve(reserveArgs('place_details_essentials'));
    await ledger.record({ month: r.month, ok: false });
    const s = await ledger.status({ ...config(), allowanceInr: 70, reserveInr: 30, totalInr: 100 });
    assert.deepEqual(s.upstream, { ok: 0, failed: 1 });
    assert.equal(s.estimatedInr, 0.5841);
  });

  it('storage failure rejects the reservation (caller refuses the Google call)', async () => {
    const ledger = new Ledger(memoryStorage({ failing: true }), () => new Date());
    await assert.rejects(ledger.reserve(reserveArgs('autocomplete_request')));
    // The queue keeps working after a failure.
    const ok = new Ledger(memoryStorage(), () => new Date());
    await assert.rejects(ledger.reserve(reserveArgs('autocomplete_request')));
    assert.equal((await ok.reserve(reserveArgs('autocomplete_request'))).ok, true);
  });

  it('invalid reservation input is refused', async () => {
    const ledger = new Ledger(memoryStorage(), () => new Date());
    assert.equal((await ledger.reserve({ sku: 'x', costInr: Number.NaN, allowanceInr: 70, dailyLimit: 1, timeZone: 'UTC' })).code, 'GOOGLE_BUDGET_CONFIG_INVALID');
  });
});
