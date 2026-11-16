// Shared helpers for the places proxy tests (not a test file).

export const PRICING = {
  verifiedOn: '2026-11-16',
  priceList: 'test',
  usdPer1000: { autocomplete_request: 2.83, place_details_ids_only: 0, place_details_essentials: 5, place_details_pro: 17, place_details_enterprise: 20, place_details_enterprise_atmosphere: 25 },
  usdToInr: 90,
  fxBufferPct: 10,
  taxPct: 18,
};
export const ENV = {
  PLACES_PRICING: JSON.stringify(PRICING),
  BUDGET_TOTAL_INR: '100',
  BUDGET_ALLOWANCE_INR: '70',
  BUDGET_RESERVE_INR: '30',
  DAILY_LIMITS: '{"autocomplete_request": 120, "details": 30}',
  BILLING_TIMEZONE: 'America/Los_Angeles',
};

/** Durable-Object-like storage; `delay` makes every call yield (to provoke interleaving). */
export function memoryStorage({ delay = 0, failing = false } = {}) {
  const map = new Map();
  const wait = () => new Promise((r) => setTimeout(r, delay));
  return {
    map,
    async get(k) {
      if (failing) throw new Error('storage down');
      if (delay) await wait();
      return map.has(k) ? structuredClone(map.get(k)) : undefined;
    },
    async put(k, v) {
      if (failing) throw new Error('storage down');
      if (delay) await wait();
      map.set(k, structuredClone(v));
    },
  };
}

