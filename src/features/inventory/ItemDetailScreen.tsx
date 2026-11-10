import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Screen } from '@/components/layout/Screen';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import {
  AppText,
  Card,
  EmptyState,
  Icon,
  IconButton,
  LoadingState,
  Notice,
  Stepper,
  Tag,
} from '@/components/ui';
import { getRepositories } from '@/db/repositories';
import { formatDateRange } from '@/lib/dates';
import { toErrorMessage } from '@/lib/errors';
import { colors, radii, spacing } from '@/theme';

import type { ItemTripUsage } from './inventoryRepository';
import { ItemImage } from './components/ItemImage';
import { StatusBadge } from './components/ItemViews';
import { useItemActions } from './components/ItemActions';
import { placeholderFor, useCategoryMaps, useEnsureInventoryLoaded } from './hooks';
import { useInventoryStore } from './inventoryStore';
import { CONDITION_LABELS, effectiveStatus, formatWeight, INVENTORY_LIMITS } from './model';

function Detail({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <View style={styles.detail}>
      <AppText variant="caption" tone="textMuted">
        {label}
      </AppText>
      <AppText variant="body" style={styles.detailValue}>
        {value}
      </AppText>
    </View>
  );
}

export function ItemDetailScreen({ itemId }: { itemId: string | undefined }) {
  useEnsureInventoryLoaded();
  const status = useInventoryStore((state) => state.status);
  const item = useInventoryStore((state) => state.items.find((i) => i.id === itemId));
  const maps = useCategoryMaps();
  const [usage, setUsage] = useState<ItemTripUsage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const actions = useItemActions(item, { onDeleted: () => router.back() });

  useFocusEffect(
    useCallback(() => {
      if (!itemId) return;
      let cancelled = false;
      getRepositories()
        .then((repos) => repos.inventory.usage(itemId))
        .then((rows) => !cancelled && setUsage(rows))
        .catch(() => !cancelled && setUsage([]));
      return () => {
        cancelled = true;
      };
    }, [itemId]),
  );

  if (!item) {
    return (
      <Screen bottomInset>
        <ScreenHeader showBack title="Item" />
        {status === 'ready' ? (
          <EmptyState icon="file-question-outline" title="Item not found" message="It may have been deleted." />
        ) : (
          <LoadingState label="Loading item…" />
        )}
      </Screen>
    );
  }

  const placeholder = placeholderFor(item, maps);
  const category = item.categoryId ? maps.byId.get(item.categoryId) : undefined;
  const subcategory = item.subcategoryId ? maps.byId.get(item.subcategoryId) : undefined;
  const itemStatus = effectiveStatus(item, item.usage);

  return (
    <Screen testID="item-detail" bottomInset>
      <ScreenHeader
        showBack
        eyebrow={[category?.name, subcategory?.name].filter(Boolean).join(' · ') || 'Uncategorised'}
        title={item.name}
        trailing={<IconButton icon="dots-horizontal" accessibilityLabel="Item actions" onPress={actions.open} testID="item-actions" />}
      />

      <View style={styles.hero}>
        <ItemImage image={item.image} fallbackIcon={placeholder.icon} fallbackColor={placeholder.color} size={128} rounded={radii.lg} />
        <View style={styles.heroText}>
          <StatusBadge status={itemStatus} />
          {item.image?.source !== 'photo' ? (
            <AppText variant="caption" tone="textMuted">
              {item.image ? 'Illustration (not a photo of the item)' : 'No picture — add one in Edit'}
            </AppText>
          ) : null}
          {item.usage.reservedQuantity > 0 ? (
            <AppText variant="caption" tone="info">
              {item.usage.reservedQuantity} of {item.quantity} reserved for upcoming trips
            </AppText>
          ) : null}
        </View>
      </View>

      {actions.error || error ? <Notice tone="danger" title="Not updated" message={actions.error ?? error ?? ''} /> : null}
      {item.archivedAt ? (
        <Notice
          tone="info"
          icon="archive-outline"
          title="Archived"
          message="Hidden from your active inventory and cannot be packed."
          action={{
            label: 'Restore',
            icon: 'archive-arrow-up-outline',
            onPress: () => void useInventoryStore.getState().setArchived(item.id, false),
          }}
        />
      ) : (
        <Stepper
          label="Quantity"
          description={item.usage.reservedQuantity > 0 ? 'Cannot go below what trips have reserved' : 'Units you own'}
          value={item.quantity}
          min={0}
          max={INVENTORY_LIMITS.quantityMax}
          onChange={(next) => {
            setError(null);
            useInventoryStore
              .getState()
              .adjustQuantity(item.id, next - item.quantity)
              .catch((err: unknown) => setError(toErrorMessage(err, 'Could not change the quantity.')));
          }}
          testID="item-detail-quantity"
        />
      )}

      <Card>
        <Detail label="Brand / model" value={[item.brand, item.model].filter(Boolean).join(' ')} />
        <Detail label="Weight (each)" value={item.weightGrams !== null ? formatWeight(item.weightGrams) : 'Unknown'} />
        <Detail label="Condition" value={CONDITION_LABELS[item.condition]} />
        <Detail label="Stored at" value={item.storageLocation} />
        <Detail label="Notes" value={item.description} />
      </Card>

      <View style={styles.group}>
        <AppText variant="label" tone="textMuted">
          Used on trips
        </AppText>
        {usage === null ? (
          <LoadingState label="Loading trips…" />
        ) : usage.length === 0 ? (
          <AppText variant="caption" tone="textMuted">
            Not on any packing list yet. Add it from a trip’s packing screen.
          </AppText>
        ) : (
          usage.map((trip) => (
            <Pressable
              key={trip.tripId}
              accessibilityRole="button"
              accessibilityLabel={`${trip.tripName} packing list`}
              onPress={() => router.push({ pathname: '/trips/[tripId]/packing', params: { tripId: trip.tripId } })}
              style={({ pressed }) => [styles.tripRow, pressed && styles.pressed]}
            >
              <Icon name="map-marker-path" tone="info" />
              <View style={styles.flex}>
                <AppText variant="bodyStrong" numberOfLines={1}>
                  {trip.tripName}
                </AppText>
                <AppText variant="caption" tone="textMuted">
                  {formatDateRange(trip.startDate, trip.endDate)} · ×{trip.quantity}
                </AppText>
              </View>
              {trip.reserved ? <Tag label="Reserved" color={colors.info} /> : <Tag label="Draft" />}
            </Pressable>
          ))
        )}
      </View>
      {actions.sheet}
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
  },
  heroText: {
    flex: 1,
    gap: spacing.sm,
  },
  detail: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.lg,
    paddingVertical: spacing.xs,
  },
  detailValue: {
    flex: 1,
    textAlign: 'right',
  },
  group: {
    gap: spacing.sm,
  },
  tripRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  pressed: {
    opacity: 0.8,
  },
  flex: {
    flex: 1,
  },
});
