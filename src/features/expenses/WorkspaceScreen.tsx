import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Screen } from '@/components/layout/Screen';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { ActionSheet, ErrorState, IconButton, LoadingState, SegmentedControl, Tag, type SheetAction } from '@/components/ui';
import { colors, spacing } from '@/theme';

import { usePlannerStore } from '../planner/plannerStore';
import { useSharingStore, useTripSharing } from '../sharing/sharingStore';
import { useToday, useTrip } from '../trips/hooks';
import { BalancesTab } from './components/BalancesTab';
import { BudgetTab } from './components/BudgetTab';
import { ExpensesTab } from './components/ExpensesTab';
import { ToolsTab } from './components/ToolsTab';
import { useExpenseStore, useTripLedger } from './expenseStore';
import { summarize } from './ledger';
import { COMMON_CURRENCIES } from './money';

export type WorkspaceTab = 'expenses' | 'balances' | 'budget' | 'tools';
export const isWorkspaceTab = (v: unknown): v is WorkspaceTab => v === 'expenses' || v === 'balances' || v === 'budget' || v === 'tools';

export function WorkspaceScreen({ tripId, initialTab = 'expenses' }: { tripId: string | undefined; initialTab?: WorkspaceTab }) {
  const { trip } = useTrip(tripId);
  const ledger = useTripLedger(tripId);
  const sharing = useTripSharing(tripId);
  const today = useToday();
  const [tab, setTab] = useState<WorkspaceTab>(initialTab);
  const [choosingCurrency, setChoosingCurrency] = useState(false);
  useFocusEffect(
    useCallback(() => {
      if (!tripId) return;
      void useExpenseStore.getState().load(tripId);
      void usePlannerStore.getState().load(tripId);
      void useSharingStore
        .getState()
        .load(tripId)
        .then(() => useSharingStore.getState().sync(tripId))
        .then(() => useExpenseStore.getState().load(tripId));
    }, [tripId]),
  );

  const ws = ledger.workspace;
  const role = sharing.space?.role;
  const currencyActions: SheetAction[] = COMMON_CURRENCIES.map((c) => ({
    key: c,
    label: c,
    icon: 'cash',
    description: ws?.currency === c ? 'Current' : undefined,
    onPress: () => void useExpenseStore.getState().setCurrency(tripId as string, c),
  }));

  return (
    <Screen testID="calc-workspace" bottomInset onRefresh={() => tripId && void useExpenseStore.getState().load(tripId)}>
      <ScreenHeader
        showBack
        eyebrow="Trip calculator"
        title={trip?.name ?? 'Trip'}
        trailing={ws ? <IconButton icon="cash-multiple" accessibilityLabel={`Default currency ${ws.currency}`} onPress={() => setChoosingCurrency(true)} testID="calc-currency" /> : undefined}
      />
      {ws ? (
        <View style={styles.tags}>
          <Tag label={`Default ${ws.currency}`} icon="cash" />
          {role ? (
            <Tag
              label={role === 'viewer' ? 'Shared · view only' : role === 'removed' ? 'No longer shared with you' : 'Shared trip'}
              icon="account-multiple-outline"
              color={role === 'viewer' || role === 'removed' ? colors.warning : colors.info}
            />
          ) : null}
        </View>
      ) : null}
      <SegmentedControl
        options={[
          { value: 'expenses', label: 'Expenses' },
          { value: 'balances', label: 'Balances' },
          { value: 'budget', label: 'Budget' },
          { value: 'tools', label: 'Tools' },
        ]}
        value={tab}
        onChange={setTab}
        accessibilityLabel="Calculator sections"
      />
      {ledger.status === 'error' ? (
        <ErrorState message={ledger.error ?? 'Could not load expenses.'} onRetry={() => tripId && void useExpenseStore.getState().load(tripId)} />
      ) : !ws || !tripId ? (
        <LoadingState label="Loading expenses…" />
      ) : (
        <View testID={`calc-panel-${tab}`}>
          {tab === 'expenses' ? <ExpensesTab tripId={tripId} ws={ws} summary={summarize(ws)} today={today} /> : null}
          {tab === 'balances' ? <BalancesTab tripId={tripId} ws={ws} summary={summarize(ws)} /> : null}
          {tab === 'budget' ? <BudgetTab tripId={tripId} ws={ws} summary={summarize(ws)} today={today} /> : null}
          {tab === 'tools' ? <ToolsTab tripId={tripId} currency={ws.currency} people={ws.participants.filter((p) => !p.archived).length} canAddGroup={!ws.groupReadOnly} /> : null}
        </View>
      )}
      <ActionSheet visible={choosingCurrency} title="Default currency" subtitle="New expenses start in this currency. Existing amounts are never converted." actions={currencyActions} onClose={() => setChoosingCurrency(false)} testID="calc-currency-sheet" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  tags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
});
