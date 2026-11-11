import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText, Button, Icon, ProgressBar } from '@/components/ui';
import { colors, radii, spacing, withAlpha } from '@/theme';

import type { CategoryMaps } from '../../inventory/hooks';
import type { Traveller } from '../../trips/model';
import { groupByCategory, UNCATEGORISED, type PackingCategoryGroup } from '../categories';
import type { TripPacking } from '../packingStore';
import { TravellerChips, type TravellerFilter } from './PackingParts';

export const openPackingCategory = (tripId: string, categoryId: string, traveller?: TravellerFilter) =>
  router.push({
    pathname: '/trips/[tripId]/packing/category/[categoryId]',
    params: traveller && traveller !== 'all' ? { tripId, categoryId, traveller } : { tripId, categoryId },
  });

export const addToPackingCategory = (tripId: string, categoryId: string) =>
  router.push({ pathname: '/trips/[tripId]/packing/add', params: { tripId, category: categoryId } });

/** Level 1: every category with its own progress. */
function CategoryRow({ group, onPress }: { group: PackingCategoryGroup; onPress: () => void }) {
  const { category, progress } = group;
  const name = category?.name ?? 'Uncategorised';
  const color = category?.color ?? colors.neutral;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${name}, ${progress.total} items, ${progress.packed} packed`}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      testID={`packing-category-${group.key}`}
    >
      <View style={[styles.iconBox, { backgroundColor: withAlpha(color, 0.16) }]}>
        <Icon name={category?.icon ?? 'tray-full'} color={color} />
      </View>
      <View style={styles.rowText}>
        <View style={styles.titleLine}>
          <AppText variant="bodyStrong" numberOfLines={1} style={styles.flex}>
            {name}
          </AppText>
          <AppText variant="caption" tone={progress.percent === 100 ? 'accent' : 'textSecondary'}>
            {progress.percent}%
          </AppText>
        </View>
        <AppText variant="caption" tone="textMuted" testID={`packing-category-count-${group.key}`}>
          {progress.total} {progress.total === 1 ? 'item' : 'items'} · {progress.packed} packed
        </AppText>
        <ProgressBar value={progress.total === 0 ? 0 : progress.packed / progress.total} accessibilityLabel={`${name} progress`} />
      </View>
      <Icon name="chevron-right" tone="textMuted" />
    </Pressable>
  );
}

function EmptyCategoryRow({ group, onOpen, onAdd }: { group: PackingCategoryGroup; onOpen: () => void; onAdd: () => void }) {
  const category = group.category!;
  return (
    <View style={styles.emptyRow} testID={`packing-category-${group.key}`}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${category.name}, no items`}
        onPress={onOpen}
        style={({ pressed }) => [styles.emptyMain, pressed && styles.pressed]}
      >
        <Icon name={category.icon} color={category.color} size={20} />
        <AppText variant="body" tone="textSecondary" numberOfLines={1} style={styles.flex}>
          {category.name}
        </AppText>
      </Pressable>
      <Button label="Add items" icon="plus" variant="ghost" size="sm" onPress={onAdd} testID={`packing-category-add-${group.key}`} />
    </View>
  );
}

export function ItemsTab({
  tripId,
  travellers,
  packing,
  maps,
}: {
  tripId: string;
  travellers: readonly Traveller[];
  packing: TripPacking;
  maps: CategoryMaps;
}) {
  const [filter, setFilter] = useState<TravellerFilter>('all');
  const visible = useMemo(
    () =>
      packing.entries.filter((entry) =>
        filter === 'all' ? true : filter === 'shared' ? !entry.travellerId : entry.travellerId === filter,
      ),
    [packing.entries, filter],
  );
  const grouped = useMemo(() => groupByCategory(visible, maps.topLevel, maps.byId), [visible, maps]);

  return (
    <View style={styles.container} testID="items-tab">
      {travellers.length > 1 ? <TravellerChips travellers={travellers} value={filter} onChange={setFilter} /> : null}

      {packing.entries.length === 0 ? (
        <AppText variant="caption" tone="textMuted">
          Open a category to add things you own from My Inventory, suggested items or trip-only items. Nothing is added
          until you choose it.
        </AppText>
      ) : null}

      {grouped.filled.length > 0 ? (
        <View style={styles.list} testID="packing-categories">
          {grouped.filled.map((group) => (
            <CategoryRow key={group.key} group={group} onPress={() => openPackingCategory(tripId, group.key, filter)} />
          ))}
        </View>
      ) : null}

      {grouped.empty.length > 0 ? (
        <View style={styles.list} testID="packing-empty-categories">
          <AppText variant="label" tone="textMuted">
            {grouped.filled.length > 0 ? 'Empty categories' : 'Categories'}
          </AppText>
          {grouped.empty.map((group) => (
            <EmptyCategoryRow
              key={group.key}
              group={group}
              onOpen={() => openPackingCategory(tripId, group.key, filter)}
              onAdd={() => addToPackingCategory(tripId, group.key)}
            />
          ))}
        </View>
      ) : null}

      <View style={styles.actions}>
        <Button
          label="Add category"
          icon="plus"
          variant="secondary"
          onPress={() => router.push('/inventory/categories/new')}
          testID="packing-add-category"
        />
        <Button
          label="Manage categories"
          icon="sort"
          variant="ghost"
          onPress={() => router.push('/inventory/categories')}
          testID="packing-manage-categories"
        />
      </View>
      <AppText variant="caption" tone="textMuted">
        Categories are shared with My Inventory and reused for every trip.
      </AppText>
    </View>
  );
}

export { UNCATEGORISED };

const styles = StyleSheet.create({
  container: {
    gap: spacing.md,
  },
  list: {
    gap: spacing.sm,
  },
  row: {
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
    opacity: 0.75,
  },
  iconBox: {
    width: 44,
    height: 44,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xs,
  },
  titleLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  flex: {
    flex: 1,
    minWidth: 0,
  },
  emptyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingRight: spacing.xs,
  },
  emptyMain: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    minHeight: 48,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
});
