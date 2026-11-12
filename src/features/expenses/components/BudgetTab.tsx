import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText, Button, Card, Icon, Notice, OptionTile, ProgressBar, SegmentedControl, TextField } from '@/components/ui';
import { toErrorMessage } from '@/lib/errors';
import { formatDateLong } from '@/lib/dates';
import { colors, spacing } from '@/theme';

import type { Workspace } from '../expenseRepository';
import { useExpenseStore } from '../expenseStore';
import type { LedgerSummary } from '../ledger';
import { formatMoney, minorToInput, parseAmount } from '../money';
import { BUILT_IN_CATEGORIES, budgetSummary, categoryMeta, CUSTOM_PREFIX, type BudgetLevel, type BudgetPlan } from '../planning';

const LEVEL_COLOR: Record<BudgetLevel, string> = { ok: colors.accent, near: colors.warning, over: colors.danger };

function Editor({ tripId, ws, currency, onDone }: { tripId: string; ws: Workspace; currency: string; onDone: () => void }) {
  const plan = ws.budgets.find((b) => b.currency === currency);
  const categories = [...BUILT_IN_CATEGORIES.map((c) => ({ key: c.key, label: c.label })), ...ws.categories.map((c) => ({ key: `${CUSTOM_PREFIX}${c.id}`, label: c.name }))];
  const [total, setTotal] = useState(plan?.totalMinor != null ? minorToInput(plan.totalMinor, currency) : '');
  const [daily, setDaily] = useState(plan?.dailyLimitMinor != null ? minorToInput(plan.dailyLimitMinor, currency) : '');
  const [lines, setLines] = useState<Record<string, string>>(Object.fromEntries((plan?.lines ?? []).map((l) => [l.category, minorToInput(l.plannedMinor, currency)])));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function read(text: string, label: string): number | null {
    if (!text.trim()) return null;
    const parsed = parseAmount(text, currency);
    if (!parsed.ok) throw new Error(`${label}: ${parsed.error}`);
    return parsed.minor;
  }

  async function save() {
    setError(null);
    setSaving(true);
    try {
      const next: BudgetPlan = {
        currency,
        totalMinor: read(total, 'Total'),
        dailyLimitMinor: read(daily, 'Daily limit'),
        lines: categories
          .map((c) => ({ category: c.key, plannedMinor: read(lines[c.key] ?? '', c.label) ?? 0 }))
          .filter((l) => l.plannedMinor > 0),
      };
      await useExpenseStore.getState().saveBudget(tripId, next);
      onDone();
    } catch (e) {
      setError(toErrorMessage(e, 'Could not save the budget.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card testID="calc-budget-editor">
      <View style={styles.group}>
        <AppText variant="title">{currency} budget</AppText>
        <TextField label="Total budget" placeholder="e.g. 50000" value={total} onChangeText={setTotal} keyboardType="decimal-pad" testID="calc-budget-total" />
        <TextField label="Daily spending limit" placeholder="e.g. 8000" value={daily} onChangeText={setDaily} keyboardType="decimal-pad" helper="You’ll see a warning from 80% of it." testID="calc-budget-daily" />
        <AppText variant="label" tone="textSecondary">
          By category (optional)
        </AppText>
        {categories.map((c) => (
          <TextField
            key={c.key}
            label={c.label}
            value={lines[c.key] ?? ''}
            onChangeText={(v) => setLines((l) => ({ ...l, [c.key]: v }))}
            keyboardType="decimal-pad"
            testID={`calc-budget-line-${c.key}`}
          />
        ))}
        {error ? <Notice tone="danger" title={error} testID="calc-budget-error" /> : null}
        <View style={styles.inline}>
          <Button label="Save budget" icon="content-save-outline" loading={saving} onPress={() => void save()} testID="calc-budget-save" />
          <Button label="Cancel" variant="ghost" onPress={onDone} />
        </View>
      </View>
    </Card>
  );
}

function Bar({ label, actual, planned, level, currency, testID }: { label: string; actual: number; planned: number | null; level: BudgetLevel | null; currency: string; testID?: string }) {
  return (
    <View style={styles.bar} testID={testID}>
      <View style={styles.inline}>
        <AppText variant="body" style={styles.flex}>
          {label}
        </AppText>
        <AppText variant="bodyStrong" style={level ? { color: LEVEL_COLOR[level] } : undefined}>
          {formatMoney(actual, currency)}
          {planned !== null ? ` / ${formatMoney(planned, currency)}` : ''}
        </AppText>
      </View>
      {planned !== null && planned > 0 ? (
        <ProgressBar value={Math.min(1, actual / planned)} color={level ? LEVEL_COLOR[level] : colors.accent} accessibilityLabel={`${label} budget used`} />
      ) : null}
    </View>
  );
}

export function BudgetTab({ tripId, ws, summary, today }: { tripId: string; ws: Workspace; summary: LedgerSummary; today: string }) {
  const currencies = [...new Set([ws.currency, ...ws.budgets.map((b) => b.currency), ...summary.totals.map((t) => t.currency)])].sort();
  const [currency, setCurrency] = useState(ws.currency);
  const [view, setView] = useState<'group' | 'mine'>('group');
  const [editing, setEditing] = useState(false);
  const plan = ws.budgets.find((b) => b.currency === currency) ?? null;
  const s = budgetSummary(view === 'group' ? summary.groupItems : summary.myItems, plan, currency, today);

  return (
    <View style={styles.root} testID="calc-budget">
      {currencies.length > 1 ? (
        <View style={styles.chips}>
          {currencies.map((c) => (
            <OptionTile key={c} layout="chip" label={c} icon="cash" selected={c === currency} onPress={() => setCurrency(c)} testID={`calc-budget-cur-${c}`} />
          ))}
        </View>
      ) : null}
      <SegmentedControl
        options={[
          { value: 'group', label: 'Shared budget' },
          { value: 'mine', label: 'My spending' },
        ]}
        value={view}
        onChange={setView}
        accessibilityLabel="Budget view"
      />
      <AppText variant="caption" tone="textMuted">
        {view === 'group' ? 'Group expenses against the trip’s budget.' : 'Your shares of group expenses plus your personal expenses, against the same budget.'}
      </AppText>

      {editing ? (
        <Editor key={currency} tripId={tripId} ws={ws} currency={currency} onDone={() => setEditing(false)} />
      ) : (
        <>
          {s.total.level === 'over' || s.total.level === 'near' ? (
            <Notice
              tone={s.total.level === 'over' ? 'danger' : 'warning'}
              title={s.total.level === 'over' ? 'Over budget' : 'Close to the budget'}
              message={`${formatMoney(s.spentMinor, currency)} of ${formatMoney(s.total.plannedMinor ?? 0, currency)} spent.`}
              testID="calc-budget-warning"
            />
          ) : null}
          <Card testID={`calc-budget-summary-${currency}`}>
            <View style={styles.group}>
              <Bar label="Total" actual={s.spentMinor} planned={s.total.plannedMinor} level={s.total.level} currency={currency} testID="calc-budget-total-bar" />
              {s.total.remainingMinor !== null ? (
                <AppText variant="caption" tone={s.total.remainingMinor < 0 ? 'danger' : 'textSecondary'}>
                  {s.total.remainingMinor < 0 ? `${formatMoney(-s.total.remainingMinor, currency)} over` : `${formatMoney(s.total.remainingMinor, currency)} left`}
                </AppText>
              ) : null}
              {s.today && s.today.limitMinor !== null ? (
                <Bar label="Today" actual={s.today.actualMinor} planned={s.today.limitMinor} level={s.today.level} currency={currency} testID="calc-budget-today" />
              ) : null}
            </View>
          </Card>
          {s.categories.length > 0 ? (
            <Card>
              <View style={styles.group}>
                <AppText variant="label" tone="textSecondary">
                  Planned vs actual
                </AppText>
                {s.categories.map((c) => (
                  <Bar
                    key={c.category}
                    label={categoryMeta(c.category, ws.categories).label}
                    actual={c.actualMinor}
                    planned={c.plannedMinor}
                    level={c.level}
                    currency={currency}
                    testID={`calc-budget-cat-${c.category}`}
                  />
                ))}
              </View>
            </Card>
          ) : null}
          {s.days.length > 0 ? (
            <View style={styles.group}>
              <AppText variant="label" tone="textSecondary">
                By day
              </AppText>
              {s.days.map((d) => (
                <View key={d.date} style={styles.inline} testID={`calc-day-${d.date}`}>
                  <Icon name={d.level === 'over' ? 'alert-circle' : 'calendar-blank-outline'} size={18} color={d.level ? LEVEL_COLOR[d.level] : colors.textMuted} />
                  <AppText variant="body" style={styles.flex}>
                    {formatDateLong(d.date)}
                  </AppText>
                  <AppText variant="bodyStrong" style={d.level ? { color: LEVEL_COLOR[d.level] } : undefined}>
                    {formatMoney(d.actualMinor, currency)}
                  </AppText>
                </View>
              ))}
            </View>
          ) : null}
          {ws.groupReadOnly ? (
            <AppText variant="caption" tone="textMuted">
              Only the trip’s owner and editors can change the shared budget.
            </AppText>
          ) : (
            <Button label={plan ? 'Edit budget' : 'Set a budget'} icon="pencil-outline" variant="secondary" onPress={() => setEditing(true)} testID="calc-budget-edit" />
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: spacing.lg,
  },
  group: {
    gap: spacing.md,
  },
  inline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  flex: {
    flex: 1,
  },
  bar: {
    gap: spacing.xs,
  },
});
