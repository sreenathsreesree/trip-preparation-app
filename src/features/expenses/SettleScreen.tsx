import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Screen } from '@/components/layout/Screen';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { AppText, Button, LoadingState, Notice, OptionTile, TextField } from '@/components/ui';
import { toErrorMessage } from '@/lib/errors';
import { successFeedback } from '@/lib/haptics';
import { spacing } from '@/theme';

import { useToday } from '../trips/hooks';
import { useExpenseStore, useTripLedger } from './expenseStore';
import { isCurrency, minorToInput, parseAmount } from './money';

function Picker({ label, value, onChange, prefix, people }: { label: string; value: string | null; onChange: (id: string) => void; prefix: string; people: { id: string; name: string }[] }) {
  return (
    <View style={styles.group}>
      <AppText variant="label" tone="textSecondary">
        {label}
      </AppText>
      <View style={styles.chips}>
        {people.map((p) => (
          <OptionTile key={p.id} layout="chip" label={p.name} icon="account-outline" selected={value === p.id} onPress={() => onChange(p.id)} testID={`${prefix}-${p.name}`} />
        ))}
      </View>
    </View>
  );
}

/** Records a payment between two people (settling up). */
export function SettleScreen({ tripId, from, to, amount, currency }: { tripId: string | undefined; from?: string; to?: string; amount?: string; currency?: string }) {
  const ledger = useTripLedger(tripId);
  const today = useToday();
  const ws = ledger.workspace;
  const startCurrency = currency && isCurrency(currency) ? currency : (ws?.currency ?? 'INR');
  const [fromId, setFrom] = useState(from ?? null);
  const [toId, setTo] = useState(to ?? null);
  const [cur, setCur] = useState(startCurrency);
  const [text, setText] = useState(amount && /^\d+$/.test(amount) ? minorToInput(Number(amount), startCurrency) : '');
  const [date, setDate] = useState(today);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  if (!tripId || !ws) {
    return (
      <Screen bottomInset>
        <ScreenHeader showBack title="Record a payment" />
        <LoadingState label="Loading…" />
      </Screen>
    );
  }
  const people = ws.participants.filter((p) => !p.archived || p.id === from || p.id === to);

  async function save() {
    setError(null);
    const parsed = parseAmount(text, cur);
    if (!parsed.ok) return setError(parsed.error);
    if (!fromId || !toId) return setError('Choose who paid and who received it.');
    setSaving(true);
    try {
      await useExpenseStore.getState().addSettlement(tripId as string, { fromId, toId, amountMinor: parsed.minor, currency: cur, settledOn: date.trim(), note });
      successFeedback();
      router.back();
    } catch (e) {
      setError(toErrorMessage(e, 'Could not record the payment.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen testID="calc-settle" bottomInset>
      <ScreenHeader showBack eyebrow="Trip calculator" title="Record a payment" />
      {ws.groupReadOnly ? <Notice tone="info" title="View only" message="Only the trip’s owner and editors can record payments." /> : null}
      <Picker label="Who paid" value={fromId} onChange={setFrom} prefix="calc-settle-from" people={people} />
      <Picker label="Who received it" value={toId} onChange={setTo} prefix="calc-settle-to" people={people} />
      <View style={styles.inline}>
        <View style={styles.flex}>
          <TextField label="Amount" value={text} onChangeText={setText} keyboardType="decimal-pad" testID="calc-settle-amount" />
        </View>
        <View style={styles.currency}>
          <TextField label="Currency" value={cur} onChangeText={(v) => setCur(v.toUpperCase().slice(0, 3))} autoCapitalize="characters" maxLength={3} />
        </View>
      </View>
      <TextField label="Date" value={date} onChangeText={setDate} maxLength={10} placeholder="YYYY-MM-DD" />
      <TextField label="Note (optional)" placeholder="e.g. UPI" value={note} onChangeText={setNote} maxLength={200} />
      {error ? <Notice tone="danger" title={error} testID="calc-settle-error" /> : null}
      {!ws.groupReadOnly ? <Button label="Save payment" icon="cash-check" loading={saving} onPress={() => void save()} fullWidth testID="calc-settle-save" /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  group: {
    gap: spacing.sm,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  inline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  flex: {
    flex: 1,
  },
  currency: {
    width: 96,
  },
});
