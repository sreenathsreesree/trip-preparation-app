/**
 * Phone-style calculator (pure, offline).
 *
 * The expression is a list of tokens: numbers (as typed, optionally with a
 * leading "-" and a trailing "%") and the operators + − × ÷. Evaluation
 * follows the usual precedence (× and ÷ before + and −). Percent works like a
 * phone calculator: "200 + 10%" is 220 (10% of what came before), while
 * "200 × 10%" is 20 (10% is 0.1). Results are rounded to 12 significant
 * digits so 0.1 + 0.2 shows 0.3.
 */

export type Operator = '+' | '-' | '*' | '/';
export type CalcToken = { kind: 'num'; text: string } | { kind: 'op'; op: Operator };
export type CalcKey = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '.' | Operator | '%' | '±' | 'C' | '⌫' | '=';

export interface CalcState {
  tokens: CalcToken[];
  /** The last evaluation: the next digit starts a new calculation, an operator continues from it. */
  evaluated: { expression: string; result: string } | null;
  error: string | null;
}

export const EMPTY_CALC: CalcState = { tokens: [], evaluated: null, error: null };

/** Digits allowed in one number (keeps every value exact enough to show). */
export const MAX_DIGITS = 15;
const MAX_TOKENS = 60;
const LIMIT = 1e15;

export class CalcError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CalcError';
  }
}

const SYMBOL: Record<Operator, string> = { '+': '+', '-': '−', '*': '×', '/': '÷' };

/** "12×3+4%" style text for the display and history. */
export function formatExpression(tokens: readonly CalcToken[]): string {
  return tokens.map((t) => (t.kind === 'op' ? ` ${SYMBOL[t.op]} ` : t.text.replace(/^-/, '−'))).join('').trim();
}

/** Plain result text (no grouping): 12 significant digits, no exponent for normal sizes. */
export function formatResult(value: number): string {
  if (!Number.isFinite(value)) throw new CalcError('That is too large.');
  if (Math.abs(value) >= LIMIT) throw new CalcError('That is too large.');
  const rounded = Number(value.toPrecision(12));
  if (Object.is(rounded, -0) || rounded === 0) return '0';
  if (Math.abs(rounded) < 1e-9) return '0';
  let text = rounded.toFixed(10);
  text = text.replace(/\.?0+$/, '');
  return text;
}

/** Display text with digit grouping ("1,234.5"). */
export function groupDigits(text: string): string {
  const match = /^(-?)(\d+)(\.\d*)?(%?)$/.exec(text);
  if (!match) return text.replace(/^-/, '−');
  const [, sign, whole, fraction = '', pct] = match;
  return `${sign ? '−' : ''}${(whole as string).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${fraction}${pct}`;
}

const numberValue = (text: string): number => {
  const clean = text.replace(/%$/, '');
  if (clean === '' || clean === '-' || clean === '.' || clean === '-.') throw new CalcError('Finish the number first.');
  const n = Number(clean);
  if (!Number.isFinite(n)) throw new CalcError('Check the number.');
  return n;
};

/** Evaluates tokens with precedence. A trailing operator is ignored ("5 +" is 5). */
export function evaluate(input: readonly CalcToken[]): number {
  const tokens = [...input];
  while (tokens.length > 0 && tokens[tokens.length - 1]?.kind === 'op') tokens.pop();
  if (tokens.length === 0) return 0;
  // Split into terms joined by + / −, each term a run of × / ÷.
  let total = 0;
  let sign: '+' | '-' = '+';
  let i = 0;
  let first = true;
  while (i < tokens.length) {
    const termStart = i;
    let value: number | null = null;
    let pendingOp: '*' | '/' | null = null;
    while (i < tokens.length) {
      const t = tokens[i] as CalcToken;
      if (t.kind === 'op' && (t.op === '+' || t.op === '-')) break;
      if (t.kind === 'op') {
        pendingOp = t.op as '*' | '/';
        i += 1;
        continue;
      }
      const percent = t.text.endsWith('%');
      let n = numberValue(t.text);
      const aloneInTerm = i === termStart && (tokens[i + 1] === undefined || (tokens[i + 1]?.kind === 'op' && ['+', '-'].includes((tokens[i + 1] as { op: Operator }).op)));
      if (percent) n = !first && aloneInTerm ? (total * n) / 100 : n / 100;
      if (value === null) value = n;
      else if (pendingOp === '/') {
        if (n === 0) throw new CalcError('Can’t divide by zero.');
        value /= n;
      } else value *= n;
      pendingOp = null;
      i += 1;
    }
    total = sign === '+' ? total + (value ?? 0) : total - (value ?? 0);
    first = false;
    const op = tokens[i];
    if (op?.kind === 'op') {
      sign = op.op === '-' ? '-' : '+';
      i += 1;
    }
  }
  if (!Number.isFinite(total) || Math.abs(total) >= LIMIT) throw new CalcError('That is too large.');
  return total;
}

const lastOf = (tokens: readonly CalcToken[]) => tokens[tokens.length - 1];
const digitCount = (text: string) => text.replace(/[^0-9]/g, '').length;

/** Applies one key press. Never throws: errors are kept in `error` and the expression stays. */
export function press(state: CalcState, key: CalcKey): CalcState {
  const s: CalcState = { tokens: state.tokens.map((t) => ({ ...t })), evaluated: state.evaluated, error: null };
  const last = lastOf(s.tokens);

  if (key === 'C') return EMPTY_CALC;

  if (key === '=') {
    if (s.tokens.length === 0) return s;
    try {
      const value = evaluate(s.tokens);
      const result = formatResult(value);
      const trimmed = s.tokens.filter((t, i, all) => !(t.kind === 'op' && i === all.length - 1));
      return { tokens: [{ kind: 'num', text: result }], evaluated: { expression: formatExpression(trimmed), result }, error: null };
    } catch (e) {
      return { ...state, error: e instanceof CalcError ? e.message : 'Check the calculation.' };
    }
  }

  if (/^[0-9]$/.test(key) || key === '.') {
    if (s.evaluated) {
      s.tokens = [];
      s.evaluated = null;
    }
    const tail = lastOf(s.tokens);
    if (!tail || tail.kind === 'op') {
      if (s.tokens.length >= MAX_TOKENS) return { ...s, error: 'That calculation is long enough.' };
      s.tokens.push({ kind: 'num', text: key === '.' ? '0.' : key });
      return s;
    }
    if (tail.text.endsWith('%')) return s; // a percentage is complete
    if (key === '.') {
      if (!tail.text.includes('.')) tail.text = tail.text === '-' || tail.text === '' ? `${tail.text}0.` : `${tail.text}.`;
      return s;
    }
    if (digitCount(tail.text) >= MAX_DIGITS) return { ...s, error: `Up to ${MAX_DIGITS} digits.` };
    if (tail.text === '0') tail.text = key;
    else if (tail.text === '-0') tail.text = `-${key}`;
    else tail.text += key;
    return s;
  }

  if (key === '+' || key === '-' || key === '*' || key === '/') {
    s.evaluated = null;
    if (!last) {
      if (key === '-') {
        s.tokens.push({ kind: 'num', text: '-' });
        return s;
      }
      s.tokens.push({ kind: 'num', text: '0' });
    } else if (last.kind === 'op') {
      last.op = key;
      return s;
    } else if (last.text === '-' || last.text === '.') {
      return s;
    }
    if (s.tokens.length >= MAX_TOKENS) return { ...s, error: 'That calculation is long enough.' };
    s.tokens.push({ kind: 'op', op: key });
    return s;
  }

  if (key === '%') {
    if (last?.kind === 'num' && !last.text.endsWith('%') && /\d/.test(last.text)) {
      last.text = `${last.text.replace(/\.$/, '')}%`;
      s.evaluated = null;
    }
    return s;
  }

  if (key === '±') {
    if (last?.kind === 'num') {
      last.text = last.text.startsWith('-') ? last.text.slice(1) : `-${last.text}`;
      if (last.text === '') s.tokens.pop();
      s.evaluated = null;
    } else if (!last) s.tokens.push({ kind: 'num', text: '-' });
    return s;
  }

  // Backspace
  if (s.evaluated) return { ...EMPTY_CALC };
  if (!last) return s;
  if (last.kind === 'op') s.tokens.pop();
  else {
    last.text = last.text.slice(0, -1);
    if (last.text === '' || last.text === '-') s.tokens.pop();
  }
  return s;
}

/** Live preview of the current expression; null while it cannot be evaluated yet. */
export function preview(state: CalcState): string | null {
  if (state.evaluated || state.tokens.length < 2) return null;
  try {
    return formatResult(evaluate(state.tokens));
  } catch {
    return null;
  }
}

/** Loads a stored result back into the calculator (e.g. from history). */
export function fromResult(result: string): CalcState {
  if (!/^-?\d+(\.\d+)?$/.test(result)) return EMPTY_CALC;
  return { tokens: [{ kind: 'num', text: result }], evaluated: null, error: null };
}

/**
 * Amount text for the expense form, rounded to the currency's minor digits.
 * Null when the result cannot be an expense (zero or negative).
 */
export function resultToAmount(result: string, digits: number): string | null {
  const n = Number(result);
  if (!Number.isFinite(n) || n <= 0) return null;
  const fixed = n.toFixed(digits);
  return Number(fixed) > 0 ? fixed : null;
}
