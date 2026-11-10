import { ScrollView, StyleSheet, View } from 'react-native';

import { ActionSheet, AppText, Button, OptionTile, SearchField } from '@/components/ui';
import { spacing } from '@/theme';
import { useState } from 'react';

import { useInventoryStore } from '../inventoryStore';
import { SORT_LABELS, STATUS_META, type SortKey, type StatusFilter } from '../model';

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'active', label: 'All active' },
  { value: 'available', label: STATUS_META.available.label },
  { value: 'reserved', label: STATUS_META.reserved.label },
  { value: 'packed', label: STATUS_META.packed.label },
  { value: 'borrowed', label: STATUS_META.borrowed.label },
  { value: 'damaged', label: STATUS_META.damaged.label },
  { value: 'archived', label: STATUS_META.archived.label },
];

/** Search, status filter and sort — shared state, so gallery and list stay in sync. */
export function FilterBar({ resultCount }: { resultCount: number }) {
  const filters = useInventoryStore((state) => state.filters);
  const sort = useInventoryStore((state) => state.sort);
  const { setFilters, setSort } = useInventoryStore.getState();
  const [sortOpen, setSortOpen] = useState(false);

  return (
    <View style={styles.container}>
      <SearchField
        value={filters.query}
        onChangeText={(query) => setFilters({ query })}
        placeholder="Search name, brand, location…"
        testID="inventory-search"
      />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {STATUS_OPTIONS.map((option) => (
          <OptionTile
            key={option.value}
            layout="chip"
            label={option.label}
            icon={option.value === 'active' ? 'filter-variant' : STATUS_META[option.value as keyof typeof STATUS_META].icon}
            selected={filters.status === option.value}
            onPress={() => setFilters({ status: option.value })}
            testID={`status-filter-${option.value}`}
          />
        ))}
      </ScrollView>
      <View style={styles.row}>
        <AppText variant="caption" tone="textMuted" testID="inventory-result-count">
          {resultCount} {resultCount === 1 ? 'item' : 'items'}
        </AppText>
        <Button
          label={`Sort: ${SORT_LABELS[sort]}`}
          icon="sort"
          variant="ghost"
          size="sm"
          onPress={() => setSortOpen(true)}
          testID="inventory-sort"
        />
      </View>
      <ActionSheet
        visible={sortOpen}
        title="Sort items"
        onClose={() => setSortOpen(false)}
        actions={(Object.keys(SORT_LABELS) as SortKey[]).map((key) => ({
          key: `sort-${key}`,
          label: SORT_LABELS[key],
          icon: key === sort ? 'radiobox-marked' : 'radiobox-blank',
          onPress: () => setSort(key),
        }))}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.sm,
  },
  chips: {
    gap: spacing.sm,
    paddingRight: spacing.lg,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
});
