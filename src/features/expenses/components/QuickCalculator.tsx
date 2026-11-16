import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';

import { AppText, Button, Card, IconButton } from '@/components/ui';
import { toErrorMessage } from '@/lib/errors';
import { selectionFeedback } from '@/lib/haptics';
import { colors, radii, spacing } from '@/theme';

import { EMPTY_CALC, formatExpression, fromResult, groupDigits, preview, press, resultToAmount, type CalcKey, type CalcState } from '../calculator';
import { useCalcHistory, useCalculatorStore } from '../calculatorStore';
import { minorDigits } from '../money';

const ROWS: { key: CalcKey; label: string; a11y: string; kind?: 'op' | 'fn' | 'eq' }[][] = [
  [
    { key: 'C', label: 'C', a11y: 'Clear', kind: 'fn' },
    { key: '±', label: '±', a11y: 'Change sign', kind: 'fn' },
    { key: '%', label: '%', a11y: 'Percent', kind: 'fn' },
    { key: '/', label: '÷', a11y: 'Divide', kind: 'op' },
  ],
  [
    { key: '7', label: '7', a11y: '7' },
    { key: '8', label: '8', a11y: '8' },
    { key: '9', label: '9', a11y: '9' },
    { key: '*', label: '×', a11y: 'Multiply', kind: 'op' },
  ],
  [
    { key: '4', label: '4', a11y: '4' },
    { key: '5', label: '5', a11y: '5' },
    { key: '6', label: '6', a11y: '6' },
    { key: '-', label: '−', a11y: 'Minus', kind: 'op' },
  ],
  [
    { key: '1', label: '1', a11y: '1' },
    { key: '2', label: '2', a11y: '2' },
    { key: '3', label: '3', a11y: '3' },
    { key: '+', label: '+', a11y: 'Plus', kind: 'op' },
  ],
  [
    { key: '⌫', label: '⌫', a11y: 'Backspace', kind: 'fn' },
    { key: '0', label: '0', a11y: '0' },
    { key: '.', label: '.', a11y: 'Decimal point' },
    { key: '=', label: '=', a11y: 'Equals', kind: 'eq' },
  ],
];

const KEYBOARD: Record<string, CalcKey> = {
  Enter: '=',
  '=': '=',
  Backspace: '⌫',
  Escape: 'C',
  Delete: 'C',
  x: '*',
  X: '*',
  '*': '*',
  '/': '/',
  '+': '+',
  '-': '-',
  '%': '%',
  '.': '.',
  ',': '.',
};

/** The trip's quick calculator: works offline; a result becomes an expense only when the user saves one. */
export function QuickCalculator({ tripId, currency }: { tripId: string; currency: string }) {
  const [state, setState] = useState<CalcState>(EMPTY_CALC);
  const [notice, setNotice] = useState<string | null>(null);
  const history = useCalcHistory(tripId);

  useEffect(() => {
    void useCalculatorStore.getState().load(tripId);
  }, [tripId]);

  const latest = useRef(state);
  const apply = (key: CalcKey) => {
    const prev = latest.current;
    const next = press(prev, key);
    latest.current = next;
    setNotice(null);
    setState(next);
    if (key === '=' && next.evaluated && !prev.evaluated) {
      const { expression, result } = next.evaluated;
      if (expression !== result) void useCalculatorStore.getState().record(tripId, expression, result).catch(() => undefined);
    }
  };
  const load = (next: CalcState) => {
    latest.current = next;
    setState(next);
  };

  // Hardware / desktop keyboard support on the web.
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      const key = /^[0-9]$/.test(e.key) ? (e.key as CalcKey) : KEYBOARD[e.key];
      if (!key) return;
      e.preventDefault();
      apply(key);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripId]);

  const current = state.tokens[state.tokens.length - 1];
  const shown = state.evaluated ? state.evaluated.result : current?.kind === 'num' ? current.text : state.tokens.length ? '' : '0';
  const expression = state.evaluated ? `${state.evaluated.expression} =` : formatExpression(state.tokens);
  const live = preview(state);
  const result = state.evaluated?.result ?? null;
  const amount = result ? resultToAmount(result, minorDigits(currency)) : null;

  async function copy() {
    if (!result) return;
    try {
      await Clipboard.setStringAsync(result);
      setNotice('Copied');
    } catch (e) {
      setNotice(toErrorMessage(e, 'Could not copy.'));
    }
  }

  return (
    <View style={styles.root} testID="calc-quick">
      <Card>
        <View style={styles.display} accessibilityLiveRegion="polite">
          <AppText variant="body" tone="textMuted" numberOfLines={2} style={styles.right} testID="calc-quick-expression">
            {expression || ' '}
          </AppText>
          <AppText variant="h1" numberOfLines={1} adjustsFontSizeToFit style={styles.big} testID="calc-quick-display">
            {groupDigits(shown || '0')}
          </AppText>
          <AppText variant="caption" tone={state.error ? 'danger' : 'textMuted'} style={styles.right} testID="calc-quick-status">
            {state.error ?? (live !== null ? `= ${groupDigits(live)}` : (notice ?? ' '))}
          </AppText>
        </View>
      </Card>

      <View style={styles.keypad}>
        {ROWS.map((row, r) => (
          <View key={r} style={styles.row}>
            {row.map((k) => (
              <Pressable
                key={k.key}
                accessibilityRole="button"
                accessibilityLabel={k.a11y}
                onPress={() => {
                  selectionFeedback();
                  apply(k.key);
                }}
                style={({ pressed }) => [styles.key, k.kind === 'op' && styles.op, k.kind === 'fn' && styles.fn, k.kind === 'eq' && styles.eq, pressed && styles.pressed]}
                testID={`calc-key-${k.a11y}`}
              >
                <AppText variant="h3" style={k.kind === 'eq' ? styles.eqText : k.kind === 'op' ? styles.opText : undefined}>
                  {k.label}
                </AppText>
              </Pressable>
            ))}
          </View>
        ))}
      </View>

      <View style={styles.actions}>
        <Button label="Copy" icon="content-copy" variant="secondary" size="sm" disabled={!result} onPress={() => void copy()} testID="calc-quick-copy" />
        <Button
          label="Add as expense"
          icon="receipt-text-plus-outline"
          size="sm"
          disabled={!amount}
          onPress={() => amount && router.push({ pathname: '/calculator/[tripId]/expense', params: { tripId, amount, currency } })}
          testID="calc-quick-add"
        />
      </View>
      {result && !amount ? (
        <AppText variant="caption" tone="textMuted">
          Only an amount above zero can be saved as an expense.
        </AppText>
      ) : (
        <AppText variant="caption" tone="textMuted">
          Calculations are not expenses. Nothing is saved to your spending until you choose “Add as expense” and save it.
        </AppText>
      )}

      <Card>
        <View style={styles.historyHead}>
          <AppText variant="title" style={styles.flex}>
            History
          </AppText>
          {history.length > 0 ? (
            <Button label="Clear" variant="ghost" size="sm" onPress={() => void useCalculatorStore.getState().clear(tripId)} testID="calc-history-clear" />
          ) : null}
        </View>
        {history.length === 0 ? (
          <AppText variant="caption" tone="textMuted" testID="calc-history-empty">
            Finished calculations for this trip appear here.
          </AppText>
        ) : (
          <View testID="calc-history">
            {history.slice(0, 20).map((h) => (
              <View key={h.id} style={styles.historyRow}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Use ${h.result} from ${h.expression}`}
                  onPress={() => load(fromResult(h.result))}
                  style={styles.flex}
                  testID={`calc-history-${h.result}`}
                >
                  <AppText variant="caption" tone="textMuted" numberOfLines={1}>
                    {h.expression}
                  </AppText>
                  <AppText variant="bodyStrong">{groupDigits(h.result)}</AppText>
                </Pressable>
                <IconButton icon="close" size="sm" accessibilityLabel={`Remove ${h.expression}`} onPress={() => void useCalculatorStore.getState().remove(tripId, h.id)} />
              </View>
            ))}
          </View>
        )}
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: spacing.md,
  },
  display: {
    gap: spacing.xs,
    minHeight: 120,
    justifyContent: 'flex-end',
  },
  right: {
    textAlign: 'right',
  },
  big: {
    textAlign: 'right',
    fontSize: 44,
    lineHeight: 52,
  },
  keypad: {
    gap: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  key: {
    flex: 1,
    minHeight: 56,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  op: {
    backgroundColor: colors.accentSoft,
  },
  fn: {
    backgroundColor: colors.surfacePressed,
  },
  eq: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  eqText: {
    color: colors.textOnAccent,
  },
  opText: {
    color: colors.accent,
  },
  pressed: {
    opacity: 0.7,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  historyHead: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  flex: {
    flex: 1,
  },
});
