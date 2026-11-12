import { useLocalSearchParams } from 'expo-router';

import { SettleScreen } from '@/features/expenses/SettleScreen';

export default function SettleRoute() {
  const p = useLocalSearchParams<{ tripId: string; from?: string; to?: string; amount?: string; currency?: string }>();
  return <SettleScreen tripId={p.tripId} from={p.from} to={p.to} amount={p.amount} currency={p.currency} />;
}
