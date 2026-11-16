import { EMPTY_CALC, evaluate, formatResult, fromResult, groupDigits, preview, press, resultToAmount, type CalcKey, type CalcState } from '../calculator';

/** Presses keys like a person would ("12+3*4="). */
const type = (keys: string, start: CalcState = EMPTY_CALC): CalcState =>
  [...keys].reduce<CalcState>((s, ch) => press(s, (ch === 'x' ? '*' : ch === 'B' ? '⌫' : ch === 'N' ? '±' : ch) as CalcKey), start);
const result = (keys: string) => type(keys).evaluated?.result ?? null;

describe('quick calculator arithmetic', () => {
  it('adds, subtracts, multiplies and divides', () => {
    expect(result('12+30=')).toBe('42');
    expect(result('50-80=')).toBe('-30');
    expect(result('7x6=')).toBe('42');
    expect(result('10/4=')).toBe('2.5');
  });

  it('follows operator precedence (× and ÷ before + and −)', () => {
    expect(result('2+3x4=')).toBe('14');
    expect(result('20-12/4=')).toBe('17');
    expect(result('2x3+4x5=')).toBe('26');
    expect(result('100/4/5=')).toBe('5');
    expect(result('10-2-3=')).toBe('5');
  });

  it('handles decimals without floating-point noise', () => {
    expect(result('0.1+0.2=')).toBe('0.3');
    expect(result('1.005x1000=')).toBe('1005');
    expect(result('.5+.25=')).toBe('0.75');
    // A second point in one number is ignored.
    expect(result('1.2.3+1=')).toBe('2.23');
  });

  it('uses phone-style percentages', () => {
    expect(result('200+10%=')).toBe('220');
    expect(result('200-10%=')).toBe('180');
    expect(result('200x10%=')).toBe('20');
    expect(result('50%=')).toBe('0.5');
    expect(result('1500/100%=')).toBe('1500');
  });

  it('changes sign, clears and backspaces', () => {
    expect(result('5N+3=')).toBe('-2');
    expect(result('5NN+3=')).toBe('8');
    expect(type('123B').tokens).toEqual([{ kind: 'num', text: '12' }]);
    expect(type('12+B').tokens).toEqual([{ kind: 'num', text: '12' }]);
    expect(type('12+3C')).toEqual(EMPTY_CALC);
  });

  it('replaces a repeated operator and ignores a trailing one', () => {
    expect(result('5+x2=')).toBe('10');
    expect(result('5+=')).toBe('5');
  });

  it('reports division by zero and keeps the expression', () => {
    const s = type('8/0=');
    expect(s.error).toMatch(/divide by zero/);
    expect(s.evaluated).toBeNull();
    expect(s.tokens).toHaveLength(3);
  });

  it('continues from a result with an operator, or starts fresh with a digit', () => {
    const done = type('6x7=');
    expect(done.evaluated?.expression).toBe('6 × 7');
    expect(type('+8=', done).evaluated?.result).toBe('50');
    expect(type('3=', done).evaluated?.result).toBe('3');
  });

  it('shows a live preview and groups digits for display', () => {
    expect(preview(type('1200+34'))).toBe('1234');
    expect(preview(type('12'))).toBeNull();
    expect(groupDigits('1234567.5')).toBe('1,234,567.5');
    expect(groupDigits('-1000')).toBe('−1,000');
  });

  it('refuses numbers that are too large', () => {
    expect(() => formatResult(1e16)).toThrow(/too large/);
    expect(type('999999999999999x999999999999999=').error).toMatch(/too large/);
    expect(type('1234567890123456').error).toMatch(/15 digits/);
  });

  it('evaluates without any network or storage (pure)', () => {
    // No fetch is available or needed: the calculator works completely offline.
    const realFetch = global.fetch;
    // @ts-expect-error — simulate an offline device
    global.fetch = undefined;
    try {
      expect(evaluate([{ kind: 'num', text: '2' }, { kind: 'op', op: '*' }, { kind: 'num', text: '21' }])).toBe(42);
      expect(result('99x3=')).toBe('297');
    } finally {
      global.fetch = realFetch;
    }
  });

  it('turns a result into an expense amount only when it is above zero', () => {
    expect(resultToAmount('1234.567', 2)).toBe('1234.57');
    expect(resultToAmount('1500', 0)).toBe('1500');
    expect(resultToAmount('0', 2)).toBeNull();
    expect(resultToAmount('-20', 2)).toBeNull();
    expect(resultToAmount('0.001', 2)).toBeNull();
  });

  it('reuses a previous result from history', () => {
    const s = fromResult('42.5');
    expect(type('x2=', s).evaluated?.result).toBe('85');
    expect(fromResult('not a number')).toEqual(EMPTY_CALC);
  });
});
