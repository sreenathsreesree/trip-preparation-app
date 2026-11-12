import { useLocalSearchParams } from 'expo-router';

import { ExpenseEditorScreen } from '@/features/expenses/ExpenseEditorScreen';

export default function ExpenseRoute() {
  const p = useLocalSearchParams<{ tripId: string; expenseId?: string; title?: string; amount?: string; currency?: string; category?: string; scope?: string }>();
  return (
    <ExpenseEditorScreen
      tripId={p.tripId}
      expenseId={p.expenseId}
      prefill={{ title: p.title, amount: p.amount, currency: p.currency, category: p.category, scope: p.scope === 'personal' ? 'personal' : p.scope === 'group' ? 'group' : undefined }}
    />
  );
}
