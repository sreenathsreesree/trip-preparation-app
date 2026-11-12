import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ActionSheet, AppText, Button, Card, Icon, IconButton, Notice, Tag, TextField, type SheetAction } from '@/components/ui';
import { confirmAction } from '@/lib/confirm';
import { toErrorMessage } from '@/lib/errors';
import { formatDateLong } from '@/lib/dates';
import { colors, spacing } from '@/theme';

import type { Participant, Workspace } from '../expenseRepository';
import { useExpenseStore } from '../expenseStore';
import type { LedgerSummary } from '../ledger';
import { formatMoney } from '../money';

function People({ tripId, ws }: { tripId: string; ws: Workspace }) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Participant | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const store = useExpenseStore.getState();
  const run = (fn: () => Promise<unknown>) => {
    setError(null);
    fn().catch((e: unknown) => setError(toErrorMessage(e, 'Could not change it.')));
  };
  const actions: SheetAction[] = selected
    ? [
        { key: 'me', label: 'This is me', icon: 'account-check-outline', onPress: () => run(() => store.setMe(tripId, selected.id)) },
        ...(ws.groupReadOnly
          ? []
          : [
              { key: 'rename', label: 'Rename', icon: 'pencil-outline' as const, onPress: () => setRenaming({ id: selected.id, name: selected.name }) },
              {
                key: 'archive',
                label: selected.archived ? 'Bring back' : 'Hide from new expenses',
                icon: (selected.archived ? 'account-reactivate-outline' : 'account-off-outline') as 'account-off-outline',
                description: 'Past expenses and balances keep them',
                onPress: () => run(() => store.setArchived(tripId, selected.id, !selected.archived)),
              },
            ]),
      ]
    : [];

  return (
    <View style={styles.group} testID="calc-people">
      <AppText variant="label" tone="textSecondary">
        People
      </AppText>
      <Card padding="xs">
        {ws.participants.map((p) => (
          <View key={p.id} style={styles.line}>
            <Icon name={p.isMe ? 'account-check' : 'account-outline'} size={20} color={p.isMe ? colors.accent : colors.textSecondary} />
            <AppText variant="body" tone={p.archived ? 'textMuted' : 'textPrimary'} style={styles.flex}>
              {p.name}
              {p.isMe ? ' (me)' : ''}
              {p.archived ? ' · hidden' : ''}
            </AppText>
            <IconButton icon="dots-horizontal" size="sm" variant="plain" accessibilityLabel={`Options for ${p.name}`} onPress={() => setSelected(p)} testID={`calc-person-${p.name}`} />
          </View>
        ))}
      </Card>
      {renaming ? (
        <View style={styles.inline}>
          <View style={styles.flex}>
            <TextField label="New name" value={renaming.name} onChangeText={(v) => setRenaming({ ...renaming, name: v })} maxLength={60} />
          </View>
          <Button label="Save" size="sm" onPress={() => run(async () => (await store.renameParticipant(tripId, renaming.id, renaming.name), setRenaming(null)))} style={styles.fieldButton} />
        </View>
      ) : null}
      {!ws.groupReadOnly ? (
        <View style={styles.inline}>
          <View style={styles.flex}>
            <TextField label="Add a person" placeholder="Name" value={name} onChangeText={setName} maxLength={60} testID="calc-person-name" />
          </View>
          <Button
            label="Add"
            size="sm"
            variant="secondary"
            disabled={!name.trim()}
            onPress={() => run(async () => (await store.addParticipant(tripId, name), setName('')))}
            style={styles.fieldButton}
            testID="calc-person-add"
          />
        </View>
      ) : null}
      {error ? <Notice tone="danger" title={error} /> : null}
      <ActionSheet visible={selected !== null} title={selected?.name ?? ''} actions={actions} onClose={() => setSelected(null)} testID="calc-person-sheet" />
    </View>
  );
}

export function BalancesTab({ tripId, ws, summary }: { tripId: string; ws: Workspace; summary: LedgerSummary }) {
  const names = new Map(ws.participants.map((p) => [p.id, p.name]));
  const name = (id: string) => names.get(id) ?? 'Someone';
  const currencies = [...summary.net.keys()].sort();
  const removeSettlement = async (id: string) => {
    const ok = await confirmAction({ title: 'Delete this payment?', message: 'Balances go back to what they were before it.', confirmLabel: 'Delete', destructive: true });
    if (ok) await useExpenseStore.getState().removeSettlement(tripId, id).catch(() => undefined);
  };

  return (
    <View style={styles.root} testID="calc-balances">
      <AppText variant="caption" tone="textMuted">
        Only group expenses and payments count here. Personal expenses never change anyone’s balance. Each currency is kept separate — nothing is converted.
      </AppText>
      {currencies.length === 0 ? (
        <Notice tone="info" title="No group expenses yet" message="Add a group expense to see who owes whom." />
      ) : (
        currencies.map((currency) => {
          const book = summary.net.get(currency) ?? new Map<string, number>();
          const debts = summary.debts.filter((d) => d.currency === currency);
          return (
            <Card key={currency} testID={`calc-balance-${currency}`}>
              <View style={styles.group}>
                <AppText variant="title">{currency}</AppText>
                {[...book.entries()]
                  .filter(([, v]) => v !== 0)
                  .sort((a, b) => b[1] - a[1])
                  .map(([id, v]) => (
                    <View key={id} style={styles.line}>
                      <AppText variant="body" style={styles.flex}>
                        {name(id)}
                      </AppText>
                      <AppText variant="bodyStrong" tone={v > 0 ? 'accent' : 'warning'}>
                        {v > 0 ? 'gets back ' : 'owes '}
                        {formatMoney(Math.abs(v), currency)}
                      </AppText>
                    </View>
                  ))}
                {debts.length === 0 ? (
                  <Tag label="All settled up" icon="check-circle-outline" color={colors.accent} />
                ) : (
                  <View style={styles.group}>
                    <AppText variant="label" tone="textSecondary">
                      Simplest way to settle
                    </AppText>
                    {debts.map((d) => (
                      <View key={`${d.fromId}-${d.toId}`} style={styles.line} testID={`calc-debt-${name(d.fromId)}-${name(d.toId)}`}>
                        <AppText variant="body" style={styles.flex}>
                          {name(d.fromId)} pays {name(d.toId)} <AppText variant="bodyStrong">{formatMoney(d.amountMinor, currency)}</AppText>
                        </AppText>
                        {!ws.groupReadOnly ? (
                          <Button
                            label="Record"
                            size="sm"
                            variant="secondary"
                            onPress={() =>
                              router.push({ pathname: '/calculator/[tripId]/settle', params: { tripId, from: d.fromId, to: d.toId, amount: String(d.amountMinor), currency } })
                            }
                            testID={`calc-settle-${name(d.fromId)}-${name(d.toId)}`}
                          />
                        ) : null}
                      </View>
                    ))}
                  </View>
                )}
              </View>
            </Card>
          );
        })
      )}

      {!ws.groupReadOnly && ws.participants.length > 1 ? (
        <Button label="Record a payment" icon="cash-fast" variant="secondary" onPress={() => router.push({ pathname: '/calculator/[tripId]/settle', params: { tripId } })} testID="calc-settle-new" />
      ) : null}

      {ws.settlements.length > 0 ? (
        <View style={styles.group} testID="calc-settlements">
          <AppText variant="label" tone="textSecondary">
            Payments
          </AppText>
          {ws.settlements.map((s) => (
            <View key={s.id} style={styles.line} testID={`calc-settlement-${name(s.fromId)}-${name(s.toId)}`}>
              <Icon name="cash-check" size={20} color={colors.accent} />
              <View style={styles.flex}>
                <AppText variant="body">
                  {name(s.fromId)} paid {name(s.toId)} {formatMoney(s.amountMinor, s.currency)}
                </AppText>
                <AppText variant="caption" tone="textMuted">
                  {formatDateLong(s.settledOn)}
                  {s.note ? ` · ${s.note}` : ''}
                </AppText>
              </View>
              {!ws.groupReadOnly ? <IconButton icon="delete-outline" size="sm" variant="plain" accessibilityLabel="Delete payment" onPress={() => void removeSettlement(s.id)} /> : null}
            </View>
          ))}
        </View>
      ) : null}

      <People tripId={tripId} ws={ws} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: spacing.lg,
  },
  group: {
    gap: spacing.sm,
  },
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 40,
    paddingHorizontal: spacing.xs,
  },
  inline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  flex: {
    flex: 1,
  },
  fieldButton: {
    marginTop: spacing.lg,
  },
});
