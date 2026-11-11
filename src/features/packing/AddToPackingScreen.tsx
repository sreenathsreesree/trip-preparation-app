import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Screen } from '@/components/layout/Screen';
import { goBackOrHome, ScreenHeader } from '@/components/layout/ScreenHeader';
import {
  AppText,
  Button,
  EmptyState,
  Icon,
  LoadingState,
  MiniStepper,
  Notice,
  OptionTile,
  SearchField,
} from '@/components/ui';
import { toErrorMessage } from '@/lib/errors';
import { successFeedback } from '@/lib/haptics';
import { colors, radii, spacing } from '@/theme';

import { ItemImage } from '../inventory/components/ItemImage';
import { placeholderFor, useCategoryMaps, useEnsureInventoryLoaded } from '../inventory/hooks';
import { useInventoryStore } from '../inventory/inventoryStore';
import { DEFAULT_FILTERS, matchesFilters, sortItems, type InventoryItemSummary } from '../inventory/model';
import { useTrip } from '../trips/hooks';
import type { TripSummary } from '../trips/model';
import { PACKING_LIMITS } from './model';
import { UNCATEGORISED } from './categories';
import { usePackingStore, useTripPacking } from './packingStore';

function blockedReason(item: InventoryItemSummary): string | null {
  if (item.availability === 'damaged') return 'Marked damaged';
  if (item.availability === 'borrowed') return 'Lent out';
  if (item.quantity === 0) return 'None owned';
  return null;
}

function Picker({ trip, categoryKey }: { trip: TripSummary; categoryKey?: string }) {
  const items = useInventoryStore((state) => state.items);
  const status = useInventoryStore((state) => state.status);
  const packing = useTripPacking(trip.id);
  const maps = useCategoryMaps();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Record<string, number>>({});
  const [travellerId, setTravellerId] = useState<string | null>(null);
  const [free, setFree] = useState<Record<string, number> | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const active = useMemo(
    () =>
      sortItems(
        items.filter((item) => matchesFilters(item, { ...DEFAULT_FILTERS, query }, maps.names)),
        'category',
        maps.names,
      ),
    [items, query, maps.names],
  );
  const onList = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of packing.entries) {
      if (entry.inventoryItemId) counts.set(entry.inventoryItemId, (counts.get(entry.inventoryItemId) ?? 0) + entry.quantity);
    }
    return counts;
  }, [packing.entries]);

  const itemIds = useMemo(() => items.filter((i) => !i.archivedAt).map((i) => i.id).join(','), [items]);
  useEffect(() => {
    if (!itemIds) return;
    let cancelled = false;
    usePackingStore
      .getState()
      .availability(trip.id, itemIds.split(','))
      .then((result) => !cancelled && setFree(result))
      .catch(() => !cancelled && setFree({}));
    return () => {
      cancelled = true;
    };
  }, [trip.id, itemIds]);

  const count = Object.keys(selected).length;
  const toggle = (item: InventoryItemSummary) =>
    setSelected((current) => {
      const next = { ...current };
      if (next[item.id]) delete next[item.id];
      else next[item.id] = 1;
      return next;
    });

  async function add() {
    setSaving(true);
    setError(null);
    try {
      const byId = new Map(items.map((i) => [i.id, i]));
      await usePackingStore.getState().addEntries(
        trip.id,
        Object.entries(selected).map(([id, quantity]) => ({
          inventoryItemId: id,
          name: byId.get(id)?.name ?? '',
          quantity,
          travellerId,
          // Added from a category screen: the entry belongs to that category on this trip.
          ...(categoryKey ? { categoryId: categoryKey === UNCATEGORISED ? null : categoryKey } : {}),
          source: 'inventory' as const,
        })),
      );
      successFeedback();
      goBackOrHome();
    } catch (err) {
      setError(toErrorMessage(err, 'Could not add those items.'));
      setSaving(false);
    }
  }

  return (
    <Screen
      testID="packing-add"
      footer={
        <View style={styles.footer}>
          <Button label="Cancel" variant="secondary" onPress={goBackOrHome} disabled={saving} />
          <Button
            label={count === 0 ? 'Select items' : `Add ${count} ${count === 1 ? 'item' : 'items'}`}
            icon="plus"
            onPress={() => void add()}
            disabled={count === 0}
            loading={saving}
            style={styles.primary}
            testID="packing-add-confirm"
          />
        </View>
      }
    >
      <ScreenHeader showBack backIcon="close" eyebrow={trip.name} title="Add from inventory" />
      {packing.state?.confirmedAt ? (
        <Notice tone="info" icon="calendar-lock" title="This list is confirmed" message="Added items are reserved straight away, so they must be free for these dates." />
      ) : null}
      {trip.travellers.length > 1 ? (
        <View style={styles.group}>
          <AppText variant="label" tone="textSecondary">
            For
          </AppText>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            <OptionTile layout="chip" label="Shared" icon="share-variant-outline" selected={travellerId === null} onPress={() => setTravellerId(null)} />
            {trip.travellers.map((t) => (
              <OptionTile
                key={t.id}
                layout="chip"
                label={t.name}
                icon={t.kind === 'child' ? 'human-child' : 'account'}
                selected={travellerId === t.id}
                onPress={() => setTravellerId(t.id)}
              />
            ))}
          </ScrollView>
        </View>
      ) : null}
      <SearchField value={query} onChangeText={setQuery} placeholder="Search your inventory" testID="packing-add-search" />
      {error ? <Notice tone="danger" title="Not added" message={error} /> : null}

      {status !== 'ready' || (itemIds !== '' && free === null) ? (
        <LoadingState label="Checking what is free…" />
      ) : items.filter((i) => !i.archivedAt).length === 0 ? (
        <EmptyState
          icon="archive-outline"
          title="Your inventory is empty"
          message="Add the things you own once, then reuse them on every trip."
          action={{ label: 'Add an item', icon: 'plus', onPress: () => router.push('/inventory/item/new') }}
        />
      ) : active.length === 0 ? (
        <AppText variant="caption" tone="textMuted">
          No items match “{query}”.
        </AppText>
      ) : (
        <View style={styles.list}>
          {active.map((item) => {
            const blocked = blockedReason(item);
            const freeUnits = free?.[item.id] ?? 0;
            const quantity = selected[item.id];
            const placeholder = placeholderFor(item, maps);
            const listed = onList.get(item.id);
            return (
              <View key={item.id} style={[styles.row, quantity ? styles.rowSelected : null, blocked ? styles.rowBlocked : null]}>
                <Pressable
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: Boolean(quantity), disabled: Boolean(blocked) }}
                  accessibilityLabel={`${item.name}, ${blocked ?? `${freeUnits} of ${item.quantity} free`}`}
                  disabled={Boolean(blocked)}
                  onPress={() => toggle(item)}
                  style={styles.rowMain}
                  testID={`pick-${item.name}`}
                >
                  <Icon
                    name={quantity ? 'checkbox-marked' : 'checkbox-blank-outline'}
                    tone={quantity ? 'accent' : 'textMuted'}
                  />
                  <ItemImage image={item.image} fallbackIcon={placeholder.icon} fallbackColor={placeholder.color} size={40} rounded={radii.sm} />
                  <View style={styles.flex}>
                    <AppText variant="bodyStrong" numberOfLines={1}>
                      {item.name}
                    </AppText>
                    <AppText
                      variant="caption"
                      tone={blocked ? 'danger' : freeUnits === 0 ? 'warning' : 'textMuted'}
                      numberOfLines={1}
                    >
                      {blocked ?? `${freeUnits} of ${item.quantity} free for these dates`}
                      {listed ? ` · on list ×${listed}` : ''}
                    </AppText>
                  </View>
                </Pressable>
                {quantity ? (
                  <MiniStepper
                    value={quantity}
                    min={1}
                    max={Math.max(1, Math.min(item.quantity, PACKING_LIMITS.quantityMax))}
                    label={item.name}
                    onChange={(value) => setSelected((current) => ({ ...current, [item.id]: value }))}
                    testID={`pick-qty-${item.name}`}
                  />
                ) : null}
              </View>
            );
          })}
        </View>
      )}
    </Screen>
  );
}

export function AddToPackingScreen({ tripId, categoryKey }: { tripId: string | undefined; categoryKey?: string }) {
  useEnsureInventoryLoaded();
  const { trip, status } = useTrip(tripId);
  const packingStatus = useTripPacking(tripId).status;
  useEffect(() => {
    if (tripId && packingStatus === 'idle') void usePackingStore.getState().load(tripId);
  }, [tripId, packingStatus]);

  if (trip) return <Picker trip={trip} categoryKey={categoryKey} />;
  return (
    <Screen bottomInset>
      <ScreenHeader showBack backIcon="close" title="Add from inventory" />
      {status === 'ready' ? (
        <EmptyState icon="map-marker-question-outline" title="Trip not found" message="It may have been deleted." />
      ) : (
        <LoadingState label="Loading…" />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  footer: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  primary: {
    flex: 1,
  },
  group: {
    gap: spacing.sm,
  },
  chips: {
    gap: spacing.sm,
  },
  list: {
    gap: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: spacing.sm,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  rowSelected: {
    borderColor: colors.accentBorder,
  },
  rowBlocked: {
    opacity: 0.6,
  },
  rowMain: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.sm,
    minHeight: 56,
  },
  flex: {
    flex: 1,
    minWidth: 0,
  },
});
