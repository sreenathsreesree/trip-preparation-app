// Trip Prep places proxy — Google Places cost controller (server side only).
//
// Every paid Google request is classified into a billing SKU from its endpoint
// and field mask, priced from server configuration (never from the app), and
// reserved against the monthly INR allowance in a single, serialised ledger
// BEFORE Google is called. Anything that cannot be classified, priced or
// recorded is refused (fail closed). Reservations are never refunded.
//
// This is an internal estimate and spending control. It is not Google's bill:
// Google's invoice, taxes and exchange rate decide the real amount.

/* ------------------------------------------------------------------ */
/* SKUs and field-mask classification                                  */
/* ------------------------------------------------------------------ */

export const SKUS = [
  'autocomplete_request',
  'place_details_ids_only',
  'place_details_essentials',
  'place_details_pro',
  'place_details_enterprise',
  'place_details_enterprise_atmosphere',
];

// Place Details (New) fields by billing tier. A request is billed at the highest
// tier of any field in its mask. A field not listed here is unknown → refused.
const DETAILS_TIERS = [
  ['place_details_ids_only', ['id', 'name', 'attributions', 'photos']],
  ['place_details_essentials', ['addressComponents', 'adrFormatAddress', 'formattedAddress', 'location', 'plusCode', 'postalAddress', 'shortFormattedAddress', 'types', 'viewport']],
  [
    'place_details_pro',
    ['accessibilityOptions', 'businessStatus', 'containingPlaces', 'displayName', 'googleMapsLinks', 'googleMapsUri', 'iconBackgroundColor', 'iconMaskBaseUri', 'primaryType', 'primaryTypeDisplayName', 'pureServiceAreaBusiness', 'subDestinations', 'utcOffsetMinutes'],
  ],
  [
    'place_details_enterprise',
    ['currentOpeningHours', 'currentSecondaryOpeningHours', 'internationalPhoneNumber', 'nationalPhoneNumber', 'priceLevel', 'priceRange', 'rating', 'regularOpeningHours', 'regularSecondaryOpeningHours', 'userRatingCount', 'websiteUri'],
  ],
  ['place_details_enterprise_atmosphere', ['editorialSummary', 'reviews', 'generativeSummary', 'reviewSummary']],
];
const TIER_OF = new Map(DETAILS_TIERS.flatMap(([sku, fields], rank) => fields.map((f) => [f, { sku, rank }])));

/** The Place Details SKU for a field mask, or null when any field is unknown (→ refuse). */
export function classifyDetailsMask(mask) {
  const fields = String(mask ?? '')
    .split(',')
    .map((f) => f.trim().split('.')[0])
    .filter(Boolean);
  if (fields.length === 0) return null;
  let best = null;
  for (const f of fields) {
    const tier = TIER_OF.get(f);
    if (!tier) return null;
    if (!best || tier.rank > best.rank) best = tier;
  }
  return best.sku;
}

/** SKU for one proxied call; null = cannot be classified (refused). */
export function classifyRequest(endpoint, fieldMask) {
  if (endpoint === 'autocomplete') return 'autocomplete_request';
  if (endpoint === 'details') return classifyDetailsMask(fieldMask);
  return null; // Nearby, Text Search and Photos are not enabled for Google.
}

/* ------------------------------------------------------------------ */
/* Configuration (server variables; validated, never trusted blindly)  */
/* ------------------------------------------------------------------ */

const num = (v) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Reads and checks the budget and pricing configuration. Returns { ok: false, reason }
 * for anything missing or inconsistent, so the proxy refuses Google calls.
 */
export function loadConfig(env) {
  let pricing;
  try {
    pricing = typeof env.PLACES_PRICING === 'string' ? JSON.parse(env.PLACES_PRICING) : env.PLACES_PRICING;
  } catch {
    return { ok: false, reason: 'pricing is not valid JSON' };
  }
  if (!pricing || typeof pricing !== 'object') return { ok: false, reason: 'pricing missing' };
  if (typeof pricing.verifiedOn !== 'string' || !DATE.test(pricing.verifiedOn)) return { ok: false, reason: 'pricing not verified (set verifiedOn after checking Google’s official price list)' };
  const usdToInr = num(pricing.usdToInr);
  const fxBufferPct = num(pricing.fxBufferPct);
  const taxPct = num(pricing.taxPct);
  if (!(usdToInr > 0) || !(fxBufferPct >= 0) || !(taxPct >= 0)) return { ok: false, reason: 'exchange rate, buffer or tax missing' };
  const usdPer1000 = {};
  for (const sku of SKUS) {
    const v = num(pricing.usdPer1000?.[sku]);
    if (!(v >= 0) || !Number.isFinite(v)) return { ok: false, reason: `price missing for ${sku}` };
    usdPer1000[sku] = v;
  }
  const total = num(env.BUDGET_TOTAL_INR);
  const allowance = num(env.BUDGET_ALLOWANCE_INR);
  const reserve = num(env.BUDGET_RESERVE_INR);
  if (!(total > 0) || !(allowance > 0) || !(reserve >= 0)) return { ok: false, reason: 'budget amounts missing' };
  // The reserve is never spendable: the allowance must leave it untouched.
  if (allowance + reserve > total + 1e-9) return { ok: false, reason: 'allowance + reserve exceed the total budget' };
  let dailyLimits;
  try {
    dailyLimits = typeof env.DAILY_LIMITS === 'string' ? JSON.parse(env.DAILY_LIMITS) : env.DAILY_LIMITS;
  } catch {
    return { ok: false, reason: 'daily limits are not valid JSON' };
  }
  if (!dailyLimits || typeof dailyLimits !== 'object') return { ok: false, reason: 'daily limits missing' };
  for (const sku of ['autocomplete_request', 'details']) {
    if (!(Number.isInteger(dailyLimits[sku]) && dailyLimits[sku] >= 0)) return { ok: false, reason: `daily limit missing for ${sku}` };
  }
  const timeZone = String(env.BILLING_TIMEZONE ?? '');
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date());
  } catch {
    return { ok: false, reason: 'billing time zone invalid' };
  }
  if (!timeZone) return { ok: false, reason: 'billing time zone missing' };
  return {
    ok: true,
    config: {
      priceList: pricing.priceList ?? 'unspecified',
      verifiedOn: pricing.verifiedOn,
      source: pricing.source ?? null,
      usdPer1000,
      usdToInr,
      fxBufferPct,
      taxPct,
      totalInr: total,
      allowanceInr: allowance,
      reserveInr: reserve,
      dailyLimits: { autocomplete_request: dailyLimits.autocomplete_request, details: dailyLimits.details },
      timeZone,
    },
  };
}

/**
 * Conservative INR estimate for one request: list price per request × (exchange rate +
 * buffer) × (1 + tax). Free monthly usage is deliberately NOT subtracted, and every
 * Autocomplete request is counted as billable even inside a session.
 */
export function costInr(sku, config) {
  const usd = config.usdPer1000[sku];
  if (!(usd >= 0)) return null;
  const inr = (usd / 1000) * config.usdToInr * (1 + config.fxBufferPct / 100) * (1 + config.taxPct / 100);
  return Math.round(inr * 1e6) / 1e6;
}

export const dailyLimitKey = (sku) => (sku === 'autocomplete_request' ? 'autocomplete_request' : 'details');

/* ------------------------------------------------------------------ */
/* Ledger                                                              */
/* ------------------------------------------------------------------ */

/** "YYYY-MM-DD" for an instant in the billing time zone. */
export function localDate(at, timeZone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
}

const emptyMonth = (month) => ({ month, totalInr: 0, skus: {}, days: {}, blocked: {}, upstream: { ok: 0, failed: 0 }, firstAt: null, updatedAt: null });

/**
 * The monthly usage ledger. All operations run one at a time (an internal queue,
 * on top of the Durable Object's own single-threaded execution), so a check and
 * its increment can never interleave with another request's.
 *
 * `storage` needs get(key) and put(key, value) (Durable Object storage in production).
 */
export class Ledger {
  constructor(storage, now = () => new Date()) {
    this.storage = storage;
    this.now = now;
    this.chain = Promise.resolve();
  }

  serial(task) {
    const run = this.chain.then(task, task);
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async month(key) {
    return (await this.storage.get(`month:${key}`)) ?? emptyMonth(key);
  }

  async save(m, at) {
    m.updatedAt = at.toISOString();
    m.firstAt ??= m.updatedAt;
    await this.storage.put(`month:${m.month}`, m);
    const months = (await this.storage.get('months')) ?? [];
    if (!months.includes(m.month)) await this.storage.put('months', [...months, m.month].sort());
    await this.storage.put('lastUpdate', m.updatedAt);
  }

  /**
   * Atomically checks the allowance and the day's limit, and reserves the cost.
   * Returns { ok: true, ... } or { ok: false, code }.
   */
  reserve({ sku, costInr: cost, allowanceInr, dailyLimit, timeZone }) {
    return this.serial(async () => {
      if (!(cost >= 0) || !(allowanceInr > 0) || !(dailyLimit >= 0)) return { ok: false, code: 'GOOGLE_BUDGET_CONFIG_INVALID' };
      const at = this.now();
      const day = localDate(at, timeZone);
      const m = await this.month(day.slice(0, 7));
      const d = (m.days[day] ??= { requests: 0, bySku: {}, limitKeys: {} });
      const limitKey = dailyLimitKey(sku);
      const usedToday = d.limitKeys[limitKey] ?? 0;
      let code = null;
      if (usedToday + 1 > dailyLimit) code = 'GOOGLE_DAILY_LIMIT';
      else if (m.totalInr + cost > allowanceInr + 1e-9) code = 'GOOGLE_BUDGET_EXHAUSTED';
      if (code) {
        m.blocked[code] = (m.blocked[code] ?? 0) + 1;
        await this.save(m, at);
        return { ok: false, code, month: m.month, totalInr: m.totalInr };
      }
      const s = (m.skus[sku] ??= { requests: 0, inr: 0 });
      s.requests += 1;
      s.inr = Math.round((s.inr + cost) * 1e6) / 1e6;
      m.totalInr = Math.round((m.totalInr + cost) * 1e6) / 1e6;
      d.requests += 1;
      d.bySku[sku] = (d.bySku[sku] ?? 0) + 1;
      d.limitKeys[limitKey] = usedToday + 1;
      await this.save(m, at);
      return { ok: true, month: m.month, day, totalInr: m.totalInr, remainingInr: Math.max(0, allowanceInr - m.totalInr) };
    });
  }

  /** After the Google call: counts success / failure. The reserved cost is never refunded. */
  record({ month, ok }) {
    return this.serial(async () => {
      const at = this.now();
      const m = await this.month(month);
      if (ok) m.upstream.ok += 1;
      else m.upstream.failed += 1;
      await this.save(m, at);
    });
  }

  /** A refusal before reaching the ledger's reserve (e.g. unknown SKU), for the report. */
  block(code, timeZone = 'UTC') {
    return this.serial(async () => {
      const at = this.now();
      const m = await this.month(localDate(at, timeZone).slice(0, 7));
      m.blocked[code] = (m.blocked[code] ?? 0) + 1;
      await this.save(m, at);
    });
  }

  /** Current month (billing time zone) plus every month's summary. */
  status({ allowanceInr, reserveInr, totalInr, timeZone, dailyLimits }) {
    return this.serial(async () => {
      const at = this.now();
      const day = localDate(at, timeZone);
      const current = await this.month(day.slice(0, 7));
      const months = (await this.storage.get('months')) ?? [];
      const history = [];
      for (const key of months) {
        const m = await this.month(key);
        history.push({ month: key, estimatedInr: m.totalInr, requests: Object.values(m.skus).reduce((a, s) => a + s.requests, 0), blocked: Object.values(m.blocked).reduce((a, n) => a + n, 0) });
      }
      return {
        month: current.month,
        today: day,
        estimatedInr: current.totalInr,
        allowanceInr,
        remainingAllowanceInr: Math.max(0, Math.round((allowanceInr - current.totalInr) * 100) / 100),
        reserveInr,
        totalBudgetInr: totalInr,
        skus: current.skus,
        todayUsage: current.days[day] ? { requests: current.days[day].requests, bySku: current.days[day].bySku, limits: dailyLimits, used: current.days[day].limitKeys } : { requests: 0, bySku: {}, limits: dailyLimits, used: {} },
        blocked: current.blocked,
        upstream: current.upstream,
        lastAccountingUpdate: (await this.storage.get('lastUpdate')) ?? null,
        history,
      };
    });
  }
}

/* ------------------------------------------------------------------ */
/* Durable Object: one ledger for the whole proxy                      */
/* ------------------------------------------------------------------ */

/**
 * Cloudflare Durable Object holding the ledger. A single named instance ("global")
 * serialises every reservation; its storage is strongly consistent and persistent.
 */
export class PlacesBudget {
  constructor(state) {
    this.ledger = new Ledger({ get: (k) => state.storage.get(k), put: (k, v) => state.storage.put(k, v) });
  }

  async fetch(request) {
    const url = new URL(request.url);
    const body = request.method === 'POST' ? await request.json() : {};
    let result;
    if (url.pathname === '/reserve') result = await this.ledger.reserve(body);
    else if (url.pathname === '/record') result = await this.ledger.record(body);
    else if (url.pathname === '/block') result = await this.ledger.block(body.code, body.timeZone);
    else if (url.pathname === '/status') result = await this.ledger.status(body);
    else return new Response('not found', { status: 404 });
    return new Response(JSON.stringify(result ?? { ok: true }), { headers: { 'Content-Type': 'application/json' } });
  }
}

/** Client for the Durable Object (throws when it is missing or failing → caller refuses). */
export function budgetClient(env) {
  if (!env.PLACES_BUDGET || typeof env.PLACES_BUDGET.idFromName !== 'function') return null;
  const stub = env.PLACES_BUDGET.get(env.PLACES_BUDGET.idFromName('global'));
  const call = async (path, body) => {
    const res = await stub.fetch(`https://budget${path}`, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
    if (!res.ok) throw new Error(`ledger ${path} failed (${res.status})`);
    return res.json();
  };
  return {
    reserve: (b) => call('/reserve', b),
    record: (b) => call('/record', b),
    block: (code, timeZone) => call('/block', { code, timeZone }),
    status: (b) => call('/status', b),
  };
}
