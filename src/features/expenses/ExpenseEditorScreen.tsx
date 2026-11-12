import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Screen } from '@/components/layout/Screen';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { AppText, Button, Icon, IconButton, LoadingState, Notice, OptionTile, SegmentedControl, TextField } from '@/components/ui';
import { confirmAction } from '@/lib/confirm';
import { toErrorMessage } from '@/lib/errors';
import { successFeedback } from '@/lib/haptics';
import { colors, radii, spacing } from '@/theme';

import { useToday } from '../trips/hooks';
import type { Expense, ExpenseScope, Workspace } from './expenseRepository';
import { useExpenseStore, useTripLedger } from './expenseStore';
import {
  COMMON_CURRENCIES,
  formatMoney,
  isCurrency,
  minorToInput,
  MoneyError,
  parseAmount,
  parsePercent,
  SPLIT_LABELS,
  SPLIT_METHODS,
  splitAmount,
  type Share,
  type SplitInput,
  type SplitMethod,
} from './money';
import { BUILT_IN_CATEGORIES, CUSTOM_PREFIX } from './planning';

export interface EditorPrefill {
  title?: string;
  amount?: string;
  currency?: string;
  category?: string;
  scope?: ExpenseScope;
}

function initialInputs(expense: Expense | null, currency: string): Record<string, string> {
  if (!expense) return {};
  return Object.fromEntries(
    expense.splits.map((s) => [
      s.participantId,
      expense.splitMethod === 'exact' ? minorToInput(s.inputValue, currency) : expense.splitMethod === 'percent' ? String(s.inputValue / 100) : String(s.inputValue),
    ]),
  );
}

function Editor({ tripId, ws, expense, prefill }: { tripId: string; ws: Workspace; expense: Expense | null; prefill: EditorPrefill }) {
  const today = useToday();
  const active = ws.participants.filter((p) => !p.archived || expense?.splits.some((s) => s.participantId === p.id) || expense?.paidBy === p.id);
  const me = ws.participants.find((p) => p.isMe) ?? active[0];
  const readOnly = ws.groupReadOnly && expense?.scope === 'group';
  const [scope, setScope] = useState<ExpenseScope>(expense?.scope ?? (ws.groupReadOnly ? 'personal' : (prefill.scope ?? 'group')));
  const [title, setTitle] = useState(expense?.title ?? prefill.title ?? '');
  const [currency, setCurrency] = useState(expense?.currency ?? (prefill.currency && isCurrency(prefill.currency) ? prefill.currency : ws.currency));
  const [amount, setAmount] = useState(expense ? minorToInput(expense.amountMinor, expense.currency) : (prefill.amount ?? ''));
  const [category, setCategory] = useState(expense?.category ?? prefill.category ?? 'food');
  const [spentOn, setSpentOn] = useState(expense?.spentOn ?? today);
  const [paidBy, setPaidBy] = useState<string | null>(expense?.paidBy ?? me?.id ?? null);
  const [method, setMethod] = useState<SplitMethod>(expense?.splitMethod ?? 'equal');
  const [included, setIncluded] = useState<Set<string>>(new Set(expense?.scope === 'group' ? expense.splits.map((s) => s.participantId) : active.filter((p) => !p.archived).map((p) => p.id)));
  const [inputs, setInputs] = useState<Record<string, string>>(initialInputs(expense, expense?.currency ?? ws.currency));
  const [notes, setNotes] = useState(expense?.notes ?? '');
  const [newCategory, setNewCategory] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [touched, setTouched] = useState(false);

  const parsedAmount = parseAmount(amount, currency);
  const people = active.filter((p) => included.has(p.id));
  let splitInputs: SplitInput[] = [];
  let preview: Share[] | null = null;
  let splitError: string | null = null;
  if (scope === 'group') {
    try {
      splitInputs = people.map((p) => {
        const text = (inputs[p.id] ?? '').trim();
        if (method === 'equal') return { participantId: p.id, value: 0 };
        if (method === 'exact') {
          const v = text ? parseAmount(text, currency) : ({ ok: true, minor: 0 } as const);
          if (!v.ok) throw new MoneyError(`${p.name}: ${v.error}`);
          return { participantId: p.id, value: v.minor };
        }
        if (method === 'percent') {
          const v = text ? parsePercent(text) : 0;
          if (v === null) throw new MoneyError(`${p.name}: use a percentage like 33.33.`);
          return { participantId: p.id, value: v };
        }
        const v = text ? Number(text) : 1;
        if (!Number.isInteger(v) || v < 0) throw new MoneyError(`${p.name}: shares are whole numbers.`);
        return { participantId: p.id, value: v };
      });
      if (parsedAmount.ok) preview = splitAmount(parsedAmount.minor, method, splitInputs, currency);
    } catch (e) {
      splitError = e instanceof MoneyError ? e.message : 'Check the split.';
    }
  }

  const categories = [...BUILT_IN_CATEGORIES.map((c) => ({ key: c.key, label: c.label, icon: c.icon })), ...ws.categories.map((c) => ({ key: `${CUSTOM_PREFIX}${c.id}`, label: c.name, icon: 'tag-outline' as const }))];
  const toggle = (id: string) =>
    setIncluded((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  async function addCategory() {
    setError(null);
    try {
      const id = await useExpenseStore.getState().addCategory(tripId, newCategory);
      setCategory(`${CUSTOM_PREFIX}${id}`);
      setNewCategory('');
    } catch (e) {
      setError(toErrorMessage(e, 'Could not add the category.'));
    }
  }

  async function save() {
    setTouched(true);
    setError(null);
    if (!parsedAmount.ok) return setError(parsedAmount.error);
    if (scope === 'group' && splitError) return setError(splitError);
    setSaving(true);
    try {
      await useExpenseStore.getState().saveExpense(
        tripId,
        { scope, title, amountMinor: parsedAmount.minor, currency, category, spentOn: spentOn.trim(), paidBy: scope === 'group' ? paidBy : null, splitMethod: method, splits: splitInputs, notes },
        expense?.id ?? null,
      );
      successFeedback();
      router.back();
    } catch (e) {
      setError(toErrorMessage(e, 'Could not save the expense.'));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!expense) return;
    const ok = await confirmAction({
      title: 'Delete this expense?',
      message: expense.scope === 'group' ? 'Everyone’s balances are recalculated without it.' : 'It is removed from your spending.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    try {
      await useExpenseStore.getState().removeExpense(tripId, expense.id);
      router.back();
    } catch (e) {
      setError(toErrorMessage(e, 'Could not delete it.'));
    }
  }

  return (
    <Screen testID="calc-editor" bottomInset>
      <ScreenHeader
        showBack
        eyebrow="Trip calculator"
        title={expense ? (readOnly ? 'Expense' : 'Edit expense') : 'New expense'}
        trailing={expense && !readOnly ? <IconButton icon="delete-outline" tone="danger" accessibilityLabel="Delete expense" onPress={() => void remove()} testID="calc-delete" /> : undefined}
      />
      {readOnly ? <Notice tone="info" title="View only" message="You can view this shared trip’s group expenses but not change them." testID="calc-readonly" /> : null}

      <SegmentedControl
        options={[
          { value: 'group', label: 'Group (split)' },
          { value: 'personal', label: 'Personal' },
        ]}
        value={scope}
        onChange={(v) => !readOnly && !(v === 'group' && ws.groupReadOnly) && setScope(v)}
        accessibilityLabel="Who is this expense for"
      />
      <AppText variant="caption" tone="textMuted" testID="calc-scope-help">
        {scope === 'group'
          ? 'Paid by one person and shared. Counts in everyone’s balances.'
          : 'Only yours: private, never split and never part of anyone’s balance.'}
      </AppText>

      <TextField label="What for" placeholder="e.g. Dinner at the houseboat" value={title} onChangeText={setTitle} maxLength={120} editable={!readOnly} testID="calc-title" />
      <View style={styles.inline}>
        <View style={styles.flex}>
          <TextField
            label="Amount"
            placeholder="0.00"
            value={amount}
            onChangeText={setAmount}
            keyboardType="decimal-pad"
            editable={!readOnly}
            error={touched && !parsedAmount.ok ? parsedAmount.error : undefined}
            testID="calc-amount"
          />
        </View>
        <View style={styles.currency}>
          <TextField label="Currency" value={currency} onChangeText={(v) => setCurrency(v.toUpperCase().slice(0, 3))} autoCapitalize="characters" maxLength={3} editable={!readOnly} testID="calc-currency-input" />
        </View>
      </View>
      {!readOnly ? (
        <View style={styles.chips}>
          {COMMON_CURRENCIES.slice(0, 6).map((c) => (
            <OptionTile key={c} layout="chip" label={c} icon="cash" selected={currency === c} onPress={() => setCurrency(c)} testID={`calc-cur-${c}`} />
          ))}
        </View>
      ) : null}
      <TextField label="Date" placeholder="YYYY-MM-DD" value={spentOn} onChangeText={setSpentOn} maxLength={10} editable={!readOnly} testID="calc-date" />

      <View style={styles.group}>
        <AppText variant="label" tone="textSecondary">
          Category
        </AppText>
        <View style={styles.chips}>
          {categories.map((c) => (
            <OptionTile key={c.key} layout="chip" label={c.label} icon={c.icon} selected={category === c.key} onPress={() => !readOnly && setCategory(c.key)} testID={`calc-cat-${c.label}`} />
          ))}
        </View>
        {!readOnly ? (
          <View style={styles.inline}>
            <View style={styles.flex}>
              <TextField label="New category" placeholder="e.g. Souvenirs" value={newCategory} onChangeText={setNewCategory} maxLength={40} testID="calc-cat-new" />
            </View>
            <Button label="Add" size="sm" variant="secondary" disabled={!newCategory.trim()} onPress={() => void addCategory()} style={styles.fieldButton} testID="calc-cat-add" />
          </View>
        ) : null}
      </View>

      {scope === 'group' ? (
        <>
          <View style={styles.group}>
            <AppText variant="label" tone="textSecondary">
              Paid by
            </AppText>
            <View style={styles.chips}>
              {active.map((p) => (
                <OptionTile key={p.id} layout="chip" label={p.isMe ? `${p.name} (me)` : p.name} icon="account-cash-outline" selected={paidBy === p.id} onPress={() => !readOnly && setPaidBy(p.id)} testID={`calc-payer-${p.name}`} />
              ))}
            </View>
          </View>

          <View style={styles.group}>
            <AppText variant="label" tone="textSecondary">
              Split
            </AppText>
            <View style={styles.chips}>
              {SPLIT_METHODS.map((m) => (
                <OptionTile key={m} layout="chip" label={SPLIT_LABELS[m]} icon="call-split" selected={method === m} onPress={() => !readOnly && setMethod(m)} testID={`calc-method-${m}`} />
              ))}
            </View>
            {active.map((p) => {
              const on = included.has(p.id);
              const share = preview?.find((s) => s.participantId === p.id);
              return (
                <View key={p.id} style={styles.person} testID={`calc-split-${p.name}`}>
                  <Pressable
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on }}
                    accessibilityLabel={`${p.name} shares this expense`}
                    onPress={() => !readOnly && toggle(p.id)}
                    style={styles.check}
                    testID={`calc-include-${p.name}`}
                  >
                    <Icon name={on ? 'checkbox-marked' : 'checkbox-blank-outline'} size={22} color={on ? colors.accent : colors.textMuted} />
                    <AppText variant="body" style={styles.flex} numberOfLines={1}>
                      {p.name}
                    </AppText>
                  </Pressable>
                  {on && method !== 'equal' ? (
                    <View style={styles.input}>
                      <TextField
                        label={method === 'exact' ? currency : method === 'percent' ? '%' : 'Shares'}
                        value={inputs[p.id] ?? ''}
                        placeholder={method === 'shares' ? '1' : '0'}
                        onChangeText={(v) => setInputs((s) => ({ ...s, [p.id]: v }))}
                        keyboardType={method === 'shares' ? 'number-pad' : 'decimal-pad'}
                        editable={!readOnly}
                        testID={`calc-input-${p.name}`}
                      />
                    </View>
                  ) : null}
                  <AppText variant="bodyStrong" style={styles.share} testID={`calc-share-${p.name}`}>
                    {on && share ? formatMoney(share.minor, currency) : '—'}
                  </AppText>
                </View>
              );
            })}
            {splitError && (touched || method !== 'equal') ? <Notice tone="warning" title={splitError} testID="calc-split-error" /> : null}
          </View>
        </>
      ) : null}

      <TextField label="Notes (optional)" value={notes} onChangeText={setNotes} maxLength={1000} multiline editable={!readOnly} />
      {error ? <Notice tone="danger" title={error} testID="calc-error" /> : null}
      {!readOnly ? <Button label={expense ? 'Save changes' : 'Save expense'} icon="content-save-outline" loading={saving} onPress={() => void save()} fullWidth testID="calc-save" /> : null}
    </Screen>
  );
}

export function ExpenseEditorScreen({ tripId, expenseId, prefill }: { tripId: string | undefined; expenseId?: string; prefill: EditorPrefill }) {
  const ledger = useTripLedger(tripId);
  useFocusEffect(
    useCallback(() => {
      if (tripId && !useExpenseStore.getState().byTrip[tripId]?.workspace) void useExpenseStore.getState().load(tripId);
    }, [tripId]),
  );
  const ws = ledger.workspace;
  const expense = expenseId ? (ws?.expenses.find((e) => e.id === expenseId) ?? null) : null;
  if (!tripId || !ws) {
    return (
      <Screen bottomInset>
        <ScreenHeader showBack title="Expense" />
        <LoadingState label="Loading…" />
      </Screen>
    );
  }
  if (expenseId && !expense) {
    return (
      <Screen bottomInset>
        <ScreenHeader showBack title="Expense" />
        <Notice tone="info" title="This expense no longer exists." />
      </Screen>
    );
  }
  return <Editor key={expense?.id ?? 'new'} tripId={tripId} ws={ws} expense={expense} prefill={prefill} />;
}

const styles = StyleSheet.create({
  group: {
    gap: spacing.sm,
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
  currency: {
    width: 96,
  },
  fieldButton: {
    marginTop: spacing.lg,
  },
  person: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 52,
    borderRadius: radii.md,
  },
  check: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 44,
  },
  input: {
    width: 96,
  },
  share: {
    minWidth: 80,
    textAlign: 'right',
  },
});
