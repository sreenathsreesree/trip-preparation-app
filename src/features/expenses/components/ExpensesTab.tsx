import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText, Button, Card, EmptyState, Icon, Notice, SegmentedControl, Tag } from '@/components/ui';
import { formatDateLong } from '@/lib/dates';
import { colors, radii, spacing } from '@/theme';

import type { Workspace } from '../expenseRepository';
import type { LedgerSummary } from '../ledger';
import { formatMoney } from '../money';
import { budgetSummary, categoryMeta } from '../planning';

type Filter = 'all' | 'group' | 'personal';

export function ExpensesTab({ tripId, ws, summary, today }: { tripId: string; ws: Workspace; summary: LedgerSummary; today: string }) {
  const [filter, setFilter] = useState<Filter>('all');
  const names = new Map(ws.participants.map((p) => [p.id, p.name]));
  const list = ws.expenses.filter((e) => filter === 'all' || e.scope === filter);
  const days = [...new Set(list.map((e) => e.spentOn))].sort((a, b) => b.localeCompare(a));
  const newExpense = () => router.push({ pathname: '/calculator/[tripId]/expense', params: { tripId } });

  // Today's spending against each currency's daily limit (shared budget: group spending).
  const warnings = ws.budgets
    .map((b) => ({ b, s: budgetSummary(summary.groupItems, b, b.currency, today) }))
    .filter(({ s }) => s.today && (s.today.level === 'over' || s.today.level === 'near'));

  return (
    <View style={styles.root} testID="calc-expenses">
      <View style={styles.totals}>
        {summary.totals.length === 0 ? (
          <AppText variant="caption" tone="textMuted">
            No spending yet.
          </AppText>
        ) : (
          summary.totals.map((t) => (
            <Card key={t.currency} style={styles.totalCard} testID={`calc-total-${t.currency}`}>
              <AppText variant="label" tone="textMuted">
                {t.currency}
              </AppText>
              <AppText variant="h3">{formatMoney(t.groupMinor, t.currency)}</AppText>
              <AppText variant="caption" tone="textSecondary">
                Group spending
              </AppText>
              <AppText variant="bodyStrong">{formatMoney(t.myMinor, t.currency)}</AppText>
              <AppText variant="caption" tone="textSecondary">
                My spending (my shares + personal)
              </AppText>
            </Card>
          ))
        )}
      </View>

      {warnings.map(({ b, s }) => (
        <Notice
          key={b.currency}
          tone={s.today?.level === 'over' ? 'danger' : 'warning'}
          icon="speedometer"
          title={s.today?.level === 'over' ? `Over today’s ${b.currency} limit` : `Close to today’s ${b.currency} limit`}
          message={`${formatMoney(s.today?.actualMinor ?? 0, b.currency)} of ${formatMoney(s.today?.limitMinor ?? 0, b.currency)} spent today.`}
          testID={`calc-daily-warning-${b.currency}`}
        />
      ))}

      <Button label="Add expense" icon="plus" onPress={newExpense} fullWidth testID="calc-add" />
      <SegmentedControl
        options={[
          { value: 'all', label: 'All' },
          { value: 'group', label: 'Group' },
          { value: 'personal', label: 'Personal' },
        ]}
        value={filter}
        onChange={setFilter}
        accessibilityLabel="Show expenses"
      />

      {list.length === 0 ? (
        <EmptyState
          icon="receipt-text-outline"
          title={filter === 'personal' ? 'No personal expenses' : 'No expenses yet'}
          message="Group expenses are split between people. Personal expenses are only yours and never change anyone’s balance."
          testID="calc-no-expenses"
        />
      ) : (
        days.map((day) => (
          <View key={day} style={styles.group}>
            <AppText variant="label" tone="textSecondary">
              {formatDateLong(day)}
            </AppText>
            {list
              .filter((e) => e.spentOn === day)
              .map((e) => {
                const cat = categoryMeta(e.category, ws.categories);
                return (
                  <Card
                    key={e.id}
                    padding="md"
                    onPress={() => router.push({ pathname: '/calculator/[tripId]/expense', params: { tripId, expenseId: e.id } })}
                    accessibilityLabel={`${e.title}, ${formatMoney(e.amountMinor, e.currency)}`}
                    testID={`calc-expense-${e.title}`}
                  >
                    <View style={styles.row}>
                      <View style={styles.icon}>
                        <Icon name={cat.icon} size={20} color={colors.accent} />
                      </View>
                      <View style={styles.flex}>
                        <AppText variant="bodyStrong" numberOfLines={1}>
                          {e.title}
                        </AppText>
                        <AppText variant="caption" tone="textSecondary" numberOfLines={1}>
                          {e.scope === 'group' ? `${names.get(e.paidBy ?? '') ?? 'Someone'} paid · ${e.splits.length} sharing` : 'Personal'} · {e.categoryName || cat.label}
                        </AppText>
                      </View>
                      <View style={styles.amount}>
                        <AppText variant="bodyStrong">{formatMoney(e.amountMinor, e.currency)}</AppText>
                        {e.scope === 'personal' ? <Tag label="Private" icon="lock-outline" /> : null}
                      </View>
                    </View>
                  </Card>
                );
              })}
          </View>
        ))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: spacing.lg,
  },
  totals: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  totalCard: {
    flexGrow: 1,
    minWidth: 150,
  },
  group: {
    gap: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  icon: {
    width: 36,
    height: 36,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentSoft,
  },
  flex: {
    flex: 1,
  },
  amount: {
    alignItems: 'flex-end',
    gap: spacing.xxs,
  },
});
