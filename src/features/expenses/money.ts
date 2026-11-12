/**
 * Money, splits, balances and debts — pure and exact.
 *
 * Amounts are integers in the currency's minor unit (paise, cents, yen…).
 * Nothing is ever converted between currencies: every total, balance and
 * debt is kept per currency, because Trip Prep has no exchange rates and
 * never invents them.
 */

/** Minor-unit digits for currencies that differ from the usual 2 (ISO 4217). */
const MINOR_DIGITS: Record<string, number> = {
  JPY: 0, KRW: 0, VND: 0, IDR: 0, CLP: 0, ISK: 0, HUF: 2, UGX: 0, XAF: 0, XOF: 0, PYG: 0,
  BHD: 3, KWD: 3, OMR: 3, JOD: 3, TND: 3, LYD: 3, IQD: 3,
};

/** Currencies offered first in pickers (any 3-letter ISO code is accepted). */
export const COMMON_CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD', 'THB', 'LKR', 'NPR', 'JPY', 'AUD', 'CAD'] as const;

export const isCurrency = (code: string) => /^[A-Z]{3}$/.test(code);
export const minorDigits = (currency: string) => MINOR_DIGITS[currency] ?? 2;

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyError';
  }
}

/** Largest amount accepted for one expense (keeps sums far inside safe integers). */
export const MAX_MINOR = 100_000_000_000;
/** Most shares one person can have (keeps amount × weight exact). */
export const MAX_SHARES = 1000;

/**
 * Parses what the user typed ("1,250.50", "1250", "99.9") into minor units.
 * Returns an error message instead of guessing (too many decimals, letters…).
 */
export function parseAmount(text: string, currency: string): { ok: true; minor: number } | { ok: false; error: string } {
  const digits = minorDigits(currency);
  const clean = text.trim().replace(/[,\s_]/g, '');
  if (!clean) return { ok: false, error: 'Enter an amount.' };
  const match = /^(\d+)(?:\.(\d*))?$/.exec(clean);
  if (!match) return { ok: false, error: 'Use numbers only, like 1250.50.' };
  const fraction = match[2] ?? '';
  if (fraction.length > digits) {
    return { ok: false, error: digits === 0 ? `${currency} has no decimal places.` : `${currency} has at most ${digits} decimal places.` };
  }
  const minor = Number(match[1]) * 10 ** digits + Number(fraction.padEnd(digits, '0') || '0');
  if (!Number.isSafeInteger(minor) || minor > MAX_MINOR) return { ok: false, error: 'That amount is too large.' };
  return { ok: true, minor };
}

/** "₹1,250.50"-style text using the device locale; falls back to "INR 1250.50". */
export function formatMoney(minor: number, currency: string, options: { signed?: boolean } = {}): string {
  const digits = minorDigits(currency);
  const value = minor / 10 ** digits;
  let text: string;
  try {
    text = new Intl.NumberFormat(undefined, { style: 'currency', currency, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(Math.abs(value));
  } catch {
    text = `${currency} ${Math.abs(value).toFixed(digits)}`;
  }
  if (minor < 0) return `−${text}`;
  return options.signed && minor > 0 ? `+${text}` : text;
}

/** Plain number for editing ("1250.5" → "1250.50"). */
export function minorToInput(minor: number, currency: string): string {
  const digits = minorDigits(currency);
  if (digits === 0) return String(minor);
  const whole = Math.trunc(minor / 10 ** digits);
  return `${whole}.${String(minor % 10 ** digits).padStart(digits, '0')}`;
}

/* ------------------------------------------------------------------ */
/* Splitting                                                           */
/* ------------------------------------------------------------------ */

export const SPLIT_METHODS = ['equal', 'exact', 'percent', 'shares'] as const;
export type SplitMethod = (typeof SPLIT_METHODS)[number];
export const SPLIT_LABELS: Record<SplitMethod, string> = {
  equal: 'Equally',
  exact: 'Exact amounts',
  percent: 'Percentages',
  shares: 'Shares',
};

/**
 * One participant's input. Meaning depends on the method:
 * equal — ignored; exact — minor units; percent — basis points (100% = 10000);
 * shares — a positive whole number of shares.
 */
export interface SplitInput {
  participantId: string;
  value: number;
}

export interface Share {
  participantId: string;
  minor: number;
}

/**
 * Distributes `total` by integer weights. Each gets floor(total·w/W); the
 * leftover minor units go one each to the largest remainders (ties: input
 * order), so the parts always add up to exactly `total`.
 */
export function allocate(total: number, weights: readonly number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0) throw new MoneyError('Nothing to split by.');
  const base = weights.map((w) => Math.floor((total * w) / sum));
  let left = total - base.reduce((a, b) => a + b, 0);
  const order = weights
    .map((w, i) => ({ i, remainder: (total * w) % sum }))
    .sort((a, b) => b.remainder - a.remainder || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    base[i] = (base[i] as number) + 1;
    left -= 1;
  }
  return base;
}

/** Computes each participant's share of `amount`, or throws a MoneyError saying what to fix. */
export function splitAmount(amount: number, method: SplitMethod, inputs: readonly SplitInput[], currency = 'INR'): Share[] {
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > MAX_MINOR) throw new MoneyError('The amount must be more than zero.');
  if (inputs.length === 0) throw new MoneyError('Choose who shared this expense.');
  const ids = new Set(inputs.map((i) => i.participantId));
  if (ids.size !== inputs.length) throw new MoneyError('Each person can appear only once.');
  const shares = (minors: number[]) => inputs.map((input, i) => ({ participantId: input.participantId, minor: minors[i] as number }));

  switch (method) {
    case 'equal':
      return shares(allocate(amount, inputs.map(() => 1)));
    case 'exact': {
      if (inputs.some((i) => !Number.isSafeInteger(i.value) || i.value < 0)) throw new MoneyError('Amounts can’t be negative.');
      const sum = inputs.reduce((a, i) => a + i.value, 0);
      if (sum !== amount) {
        const diff = amount - sum;
        throw new MoneyError(`The amounts add up to ${formatMoney(sum, currency)}: ${formatMoney(Math.abs(diff), currency)} ${diff > 0 ? 'left to assign' : 'too much'}.`);
      }
      return shares(inputs.map((i) => i.value));
    }
    case 'percent': {
      if (inputs.some((i) => !Number.isInteger(i.value) || i.value < 0)) throw new MoneyError('Percentages can’t be negative.');
      const sum = inputs.reduce((a, i) => a + i.value, 0);
      if (sum !== 10_000) throw new MoneyError(`The percentages add up to ${(sum / 100).toFixed(2).replace(/\.00$/, '')}%, not 100%.`);
      return shares(allocate(amount, inputs.map((i) => i.value)));
    }
    case 'shares': {
      if (inputs.some((i) => !Number.isInteger(i.value) || i.value < 0 || i.value > MAX_SHARES)) throw new MoneyError(`Shares must be whole numbers from 0 to ${MAX_SHARES}.`);
      if (inputs.every((i) => i.value === 0)) throw new MoneyError('Give at least one person a share.');
      return shares(allocate(amount, inputs.map((i) => i.value)));
    }
    default:
      throw new MoneyError('Choose how to split.');
  }
}

/** Parses a percentage like "33.33" into basis points (3333). */
export function parsePercent(text: string): number | null {
  const m = /^(\d{1,3})(?:\.(\d{0,2}))?$/.exec(text.trim());
  if (!m) return null;
  const bp = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0') || '0');
  return bp <= 10_000 ? bp : null;
}

/* ------------------------------------------------------------------ */
/* Balances and debts                                                  */
/* ------------------------------------------------------------------ */

export interface GroupExpense {
  amountMinor: number;
  currency: string;
  paidBy: string;
  shares: readonly Share[];
}

export interface Settlement {
  fromId: string;
  toId: string;
  amountMinor: number;
  currency: string;
}

/**
 * Net position per currency and participant: positive = is owed money,
 * negative = owes. Only group expenses and settlements count (personal
 * expenses never reach here). Every currency's balances sum to zero.
 */
export function balances(expenses: readonly GroupExpense[], settlements: readonly Settlement[]): Map<string, Map<string, number>> {
  const result = new Map<string, Map<string, number>>();
  const add = (currency: string, id: string, minor: number) => {
    const book = result.get(currency) ?? new Map<string, number>();
    book.set(id, (book.get(id) ?? 0) + minor);
    result.set(currency, book);
  };
  for (const e of expenses) {
    add(e.currency, e.paidBy, e.amountMinor);
    for (const s of e.shares) add(e.currency, s.participantId, -s.minor);
  }
  for (const s of settlements) {
    // The payer has paid off part of what they owed; the receiver is owed less.
    add(s.currency, s.fromId, s.amountMinor);
    add(s.currency, s.toId, -s.amountMinor);
  }
  return result;
}

export interface Debt {
  fromId: string;
  toId: string;
  amountMinor: number;
  currency: string;
}

/**
 * Turns net balances into a short list of payments that settles everyone:
 * repeatedly the largest debtor pays the largest creditor. Uses at most
 * (people − 1) payments per currency; amounts stay exact integers.
 */
export function simplifyDebts(net: Map<string, Map<string, number>>): Debt[] {
  const debts: Debt[] = [];
  for (const [currency, book] of [...net.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const creditors = [...book.entries()].filter(([, v]) => v > 0).map(([id, v]) => ({ id, v }));
    const debtors = [...book.entries()].filter(([, v]) => v < 0).map(([id, v]) => ({ id, v: -v }));
    const byAmount = (a: { id: string; v: number }, b: { id: string; v: number }) => b.v - a.v || a.id.localeCompare(b.id);
    for (;;) {
      creditors.sort(byAmount);
      debtors.sort(byAmount);
      const c = creditors[0];
      const d = debtors[0];
      if (!c || !d || c.v === 0 || d.v === 0) break;
      const pay = Math.min(c.v, d.v);
      debts.push({ fromId: d.id, toId: c.id, amountMinor: pay, currency });
      c.v -= pay;
      d.v -= pay;
      if (c.v === 0) creditors.shift();
      if (d.v === 0) debtors.shift();
    }
  }
  return debts;
}
