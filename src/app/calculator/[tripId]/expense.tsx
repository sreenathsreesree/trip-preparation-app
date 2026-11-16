import { useLocalSearchParams } from 'expo-router';

import { ExpenseEditorScreen } from '@/features/expenses/ExpenseEditorScreen';
import { SPLIT_METHODS, type SplitMethod } from '@/features/expenses/money';

/** Participant id → split input text; anything malformed is ignored. */
function parseSplits(raw: string | undefined): Record<string, string> | undefined {
  if (!raw) return undefined;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const entries = Object.entries(value as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === 'string' && e[1].length <= 20).slice(0, 100);
    return Object.fromEntries(entries);
  } catch {
    return undefined;
  }
}

const isSplitMethod = (v: unknown): v is SplitMethod => SPLIT_METHODS.includes(v as SplitMethod);

export default function ExpenseRoute() {
  const p = useLocalSearchParams<{ tripId: string; expenseId?: string; title?: string; amount?: string; currency?: string; category?: string; scope?: string; method?: string; placeNodeId?: string; splits?: string }>();
  return (
    <ExpenseEditorScreen
      tripId={p.tripId}
      expenseId={p.expenseId}
      prefill={{ title: p.title, amount: p.amount, currency: p.currency, category: p.category, scope: p.scope === 'personal' ? 'personal' : p.scope === 'group' ? 'group' : undefined,
        method: isSplitMethod(p.method) ? p.method : undefined,
        placeNodeId: p.placeNodeId || undefined,
        splits: parseSplits(p.splits),
      }}
    />
  );
}
