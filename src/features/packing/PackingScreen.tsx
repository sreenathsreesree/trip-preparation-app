import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Screen } from '@/components/layout/Screen';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import {
  AppText,
  Button,
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  Notice,
  ProgressBar,
  SegmentedControl,
  type SegmentOption,
} from '@/components/ui';
import { confirmAction } from '@/lib/confirm';
import { formatDateRange } from '@/lib/dates';
import { toErrorMessage } from '@/lib/errors';
import { successFeedback } from '@/lib/haptics';
import { spacing } from '@/theme';

import { useCategoryMaps, useEnsureInventoryLoaded } from '../inventory/hooks';
import { useInventoryStore } from '../inventory/inventoryStore';
import { useTrip } from '../trips/hooks';
import { getTripLifecycle, type TripSummary } from '../trips/model';
import { BagsTab } from './components/BagsTab';
import { BuyTab } from './components/BuyTab';
import { ItemsTab } from './components/ItemsTab';
import { PackingStatusLine } from './components/PackingParts';
import { SuggestTab } from './components/SuggestTab';
import { categoryProgress } from './categories';
import { describeConflict, type ReservationConflict } from './model';
import { usePackingStore, useTripPacking } from './packingStore';

type Tab = 'items' | 'bags' | 'suggest' | 'buy';
const isTab = (value: unknown): value is Tab =>
  value === 'items' || value === 'bags' || value === 'suggest' || value === 'buy';

function ConfirmPanel({ trip, confirmed, entries }: { trip: TripSummary; confirmed: boolean; entries: number }) {
  const [busy, setBusy] = useState(false);
  const [conflicts, setConflicts] = useState<ReservationConflict[]>([]);
  const [error, setError] = useState<string | null>(null);
  const lifecycle = getTripLifecycle(trip);
  const store = usePackingStore.getState;

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      const found = await store().confirm(trip.id);
      setConflicts(found);
      if (found.length === 0) successFeedback();
    } catch (err) {
      setError(toErrorMessage(err, 'Could not confirm the list.'));
    } finally {
      setBusy(false);
    }
  }

  async function unconfirm() {
    const ok = await confirmAction({
      title: 'Back to draft?',
      message: 'Your inventory items are released for these dates so other trips can use them. The list itself stays.',
      confirmLabel: 'Back to draft',
    });
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      await store().unconfirm(trip.id);
      setConflicts([]);
    } catch (err) {
      setError(toErrorMessage(err, 'Could not change the list.'));
    } finally {
      setBusy(false);
    }
  }

  if (lifecycle !== 'active') {
    return (
      <Notice
        tone="info"
        icon={lifecycle === 'archived' ? 'archive-outline' : 'flag-checkered'}
        title={lifecycle === 'archived' ? 'Trip archived' : 'Trip completed'}
        message="Nothing is reserved for this trip. Restore or reopen it to confirm the list again."
      />
    );
  }

  return (
    <View style={styles.confirm}>
      <PackingStatusLine confirmed={confirmed} />
      <AppText variant="caption" tone="textMuted">
        {confirmed
          ? `Items from your inventory are held for ${formatDateRange(trip.startDate, trip.endDate)} so overlapping trips cannot over-book them.`
          : 'Confirm when the list is settled to hold your inventory items for these dates.'}
      </AppText>
      {confirmed ? (
        <Button label="Back to draft" icon="pencil-outline" variant="secondary" size="sm" onPress={() => void unconfirm()} loading={busy} style={styles.left} testID="packing-unconfirm" />
      ) : (
        <Button
          label="Confirm list"
          icon="calendar-lock"
          size="sm"
          onPress={() => void confirm()}
          loading={busy}
          disabled={entries === 0}
          style={styles.left}
          testID="packing-confirm"
        />
      )}
      {conflicts.length > 0 ? (
        <Notice
          tone="warning"
          title="Not enough free for these dates"
          message={`${conflicts.map(describeConflict).join('\n')}\nLower the quantity, remove the item, or change the other trip.`}
          testID="packing-conflicts"
        />
      ) : null}
      {error ? <Notice tone="danger" title="Not confirmed" message={error} /> : null}
    </View>
  );
}

function PackingBody({ trip, initialTab }: { trip: TripSummary; initialTab: Tab }) {
  const packing = useTripPacking(trip.id);
  const items = useInventoryStore((state) => state.items);
  const maps = useCategoryMaps();
  const [tab, setTab] = useState<Tab>(initialTab);
  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  useFocusEffect(
    useCallback(() => {
      void usePackingStore.getState().load(trip.id);
      void usePackingStore.getState().loadPreferences();
    }, [trip.id]),
  );

  // Item-based, like each category's progress: "4 of 6 items packed".
  const progress = categoryProgress(packing.entries);
  const pending = packing.recommendations.filter((r) => r.status === 'pending').length;
  const toBuy = packing.purchases.filter((p) => p.status === 'needed').length;
  const options: SegmentOption<Tab>[] = [
    { value: 'items', label: `Items${packing.entries.length ? ` ${packing.entries.length}` : ''}` },
    { value: 'bags', label: 'Bags' },
    { value: 'suggest', label: 'Suggest' },
    { value: 'buy', label: `Buy${toBuy ? ` ${toBuy}` : ''}` },
  ];

  return (
    <Screen testID="packing-screen" bottomInset onRefresh={() => void usePackingStore.getState().load(trip.id)}>
      <ScreenHeader
        showBack
        eyebrow={trip.name}
        title="Packing"
        subtitle={
          progress.total === 0
            ? 'Nothing on the list yet'
            : `${progress.packed} of ${progress.total} ${progress.total === 1 ? 'item' : 'items'} packed · ${progress.remaining} left`
        }
      />

      {packing.status === 'error' ? (
        <ErrorState message={packing.error ?? 'Could not load the packing list.'} onRetry={() => void usePackingStore.getState().load(trip.id)} />
      ) : !packing.state ? (
        <LoadingState label="Loading packing list…" />
      ) : (
        <>
          {packing.state.draftReason ? (
            <Notice
              tone="warning"
              title="Packing list moved back to draft"
              message={packing.state.draftReason}
              action={{ label: 'OK', onPress: () => void usePackingStore.getState().dismissDraftReason(trip.id) }}
              testID="draft-reason"
            />
          ) : null}
          <Card>
            <View style={styles.progressRow}>
              <AppText variant="title" style={styles.flex}>
                {progress.percent}% packed
              </AppText>
            </View>
            <ProgressBar
              value={progress.total === 0 ? 0 : progress.packed / progress.total}
              accessibilityLabel="Packing progress"
            />
            <View style={styles.confirmWrap}>
              <ConfirmPanel trip={trip} confirmed={Boolean(packing.state.confirmedAt)} entries={packing.entries.length} />
            </View>
          </Card>

          <SegmentedControl options={options} value={tab} onChange={setTab} accessibilityLabel="Packing sections" />
          {pending > 0 && tab !== 'suggest' ? (
            <Button
              label={`Review ${pending} ${pending === 1 ? 'suggestion' : 'suggestions'}`}
              icon="lightbulb-on-outline"
              variant="ghost"
              size="sm"
              onPress={() => setTab('suggest')}
              style={styles.left}
              testID="packing-review-suggestions"
            />
          ) : null}

          {tab === 'items' ? (
            <ItemsTab tripId={trip.id} travellers={trip.travellers} packing={packing} maps={maps} />
          ) : tab === 'bags' ? (
            <BagsTab tripId={trip.id} travellers={trip.travellers} packing={packing} itemById={itemById} />
          ) : tab === 'suggest' ? (
            <SuggestTab tripId={trip.id} travellers={trip.travellers} packing={packing} itemById={itemById} />
          ) : (
            <BuyTab tripId={trip.id} purchases={packing.purchases} />
          )}
        </>
      )}
    </Screen>
  );
}

export function PackingScreen({ tripId, initialTab }: { tripId: string | undefined; initialTab?: string }) {
  useEnsureInventoryLoaded();
  const { trip, status, error, reload } = useTrip(tripId);
  if (trip) return <PackingBody trip={trip} initialTab={isTab(initialTab) ? initialTab : 'items'} />;
  return (
    <Screen bottomInset>
      <ScreenHeader showBack title="Packing" />
      {status === 'error' ? (
        <ErrorState message={error ?? 'Could not load your trips.'} onRetry={() => void reload()} />
      ) : status === 'ready' ? (
        <EmptyState
          icon="map-marker-question-outline"
          title="Trip not found"
          message="It may have been deleted from this device."
          action={{ label: 'View all trips', onPress: () => router.replace('/trips') }}
        />
      ) : (
        <LoadingState label="Loading trip…" />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  left: {
    alignSelf: 'flex-start',
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  confirmWrap: {
    marginTop: spacing.md,
  },
  confirm: {
    gap: spacing.sm,
  },
});
