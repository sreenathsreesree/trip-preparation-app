import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { Screen } from '@/components/layout/Screen';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import {
  AppText,
  Button,
  EmptyState,
  ErrorState,
  LoadingState,
  Notice,
  SegmentedControl,
} from '@/components/ui';
import { toErrorMessage } from '@/lib/errors';
import { colors, spacing } from '@/theme';

import { CategoryFolderCard, ItemCard, ItemRow } from './components/ItemViews';
import { FilterBar } from './components/FilterBar';
import { useItemActions } from './components/ItemActions';
import { useCategoryMaps, useEnsureInventoryLoaded, useVisibleItems } from './hooks';
import { useInventoryStore, type InventoryView } from './inventoryStore';
import type { InventoryItemSummary } from './model';

const openCategory = (id: string) => router.push({ pathname: '/inventory/category/[categoryId]', params: { categoryId: id } });

function FoldersView() {
  const items = useInventoryStore((state) => state.items);
  const maps = useCategoryMaps();
  const uncategorised = items.filter((i) => !i.categoryId);
  return (
    <View style={styles.grid}>
      {maps.topLevel.map((category) => (
        <CategoryFolderCard
          key={category.id}
          category={category}
          items={items.filter((i) => i.categoryId === category.id)}
          onPress={() => openCategory(category.id)}
          testID={`folder-${category.systemKey ?? category.id}`}
        />
      ))}
      {uncategorised.length > 0 ? (
        <CategoryFolderCard
          category={{ name: 'Uncategorised', icon: 'help-box-outline', color: colors.info, coverImageUri: null }}
          items={uncategorised}
          onPress={() => openCategory('uncategorised')}
          testID="folder-uncategorised"
        />
      ) : null}
    </View>
  );
}

export function ItemCollection({
  items,
  mode,
  emptyMessage,
}: {
  items: InventoryItemSummary[];
  mode: 'gallery' | 'list';
  emptyMessage: string;
}) {
  const maps = useCategoryMaps();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = items.find((i) => i.id === selectedId);
  const actions = useItemActions(selected);
  const [error, setError] = useState<string | null>(null);

  if (items.length === 0) {
    return <EmptyState icon="magnify-close" title="No matching items" message={emptyMessage} />;
  }
  return (
    <View style={styles.collection}>
      {error || actions.error ? <Notice tone="danger" title="Something went wrong" message={error ?? actions.error ?? ''} /> : null}
      {mode === 'gallery' ? (
        <View style={styles.grid}>
          {items.map((item) => (
            <ItemCard key={item.id} item={item} maps={maps} />
          ))}
        </View>
      ) : (
        <View style={styles.list}>
          {items.map((item) => (
            <ItemRow
              key={item.id}
              item={item}
              maps={maps}
              onAdjust={(target, delta) => {
                setError(null);
                useInventoryStore
                  .getState()
                  .adjustQuantity(target.id, delta)
                  .catch((err: unknown) => setError(toErrorMessage(err, 'Could not change the quantity.')));
              }}
              onMore={(target) => {
                setSelectedId(target.id);
                actions.open();
              }}
            />
          ))}
        </View>
      )}
      {actions.sheet}
    </View>
  );
}

export function InventoryScreen() {
  useEnsureInventoryLoaded();
  const status = useInventoryStore((state) => state.status);
  const error = useInventoryStore((state) => state.error);
  const items = useInventoryStore((state) => state.items);
  const view = useInventoryStore((state) => state.view);
  const filters = useInventoryStore((state) => state.filters);
  const sort = useInventoryStore((state) => state.sort);
  const { load, setView } = useInventoryStore.getState();
  const visible = useVisibleItems(filters, sort);
  const maps = useCategoryMaps();

  const stats = useMemo(() => {
    const active = items.filter((i) => !i.archivedAt);
    return {
      items: active.length,
      units: active.reduce((sum, i) => sum + i.quantity, 0),
      reserved: active.filter((i) => i.usage.reservedQuantity > 0).length,
    };
  }, [items]);

  const addItem = () => router.push('/inventory/item/new');

  return (
    <Screen testID="inventory-screen" onRefresh={() => void load()}>
      <ScreenHeader
        eyebrow="Gear locker"
        title="Inventory"
        trailing={<Button label="Add item" icon="plus" size="sm" onPress={addItem} testID="inventory-add" />}
      />

      {status === 'error' ? (
        <ErrorState message={error ?? 'Could not load your inventory.'} onRetry={() => void load()} />
      ) : status !== 'ready' ? (
        <LoadingState label="Loading inventory…" />
      ) : (
        <>
          <View style={styles.summary}>
            <AppText variant="caption" tone="textSecondary" style={styles.flex}>
              {stats.items} {stats.items === 1 ? 'item' : 'items'} · {stats.units} units · {maps.topLevel.length} categories
              {stats.reserved > 0 ? ` · ${stats.reserved} reserved` : ''}
            </AppText>
          </View>
          <View style={styles.links}>
            <Button
              label="Categories"
              icon="shape-outline"
              variant="secondary"
              size="sm"
              onPress={() => router.push('/inventory/categories')}
              testID="manage-categories"
            />
            <Button
              label="Shopping list"
              icon="cart-outline"
              variant="secondary"
              size="sm"
              onPress={() => router.push('/inventory/shopping')}
              testID="open-shopping"
            />
          </View>

          <SegmentedControl<InventoryView>
            accessibilityLabel="Inventory view"
            value={view}
            onChange={setView}
            options={[
              { value: 'folders', label: 'Folders' },
              { value: 'gallery', label: 'Gallery' },
              { value: 'list', label: 'List' },
            ]}
          />

          {items.length === 0 ? (
            <EmptyState
              icon="bag-personal-outline"
              title="Start your gear locker"
              message="Add the things you travel with once — clothes, chargers, documents, gear — and reuse them on every trip's packing list."
              action={{ label: 'Add your first item', icon: 'plus', onPress: addItem }}
              testID="inventory-empty"
            />
          ) : view === 'folders' ? (
            <Animated.View entering={FadeIn.duration(180)}>
              <FoldersView />
            </Animated.View>
          ) : (
            <Animated.View entering={FadeIn.duration(180)} style={styles.collection}>
              <FilterBar resultCount={visible.length} />
              <ItemCollection items={visible} mode={view} emptyMessage="Try another search or filter." />
            </Animated.View>
          )}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  summary: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  links: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  collection: {
    gap: spacing.md,
  },
  list: {
    gap: spacing.sm,
  },
});
