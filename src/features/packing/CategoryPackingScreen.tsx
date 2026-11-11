import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Screen } from '@/components/layout/Screen';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import {
  ActionSheet,
  AppText,
  Button,
  Card,
  EmptyState,
  ErrorState,
  IconButton,
  LoadingState,
  Notice,
  OptionTile,
  ProgressBar,
  type SheetAction,
} from '@/components/ui';
import { confirmAction } from '@/lib/confirm';
import { toErrorMessage } from '@/lib/errors';
import { spacing } from '@/theme';

import { useCategoryMaps, useEnsureInventoryLoaded } from '../inventory/hooks';
import { useInventoryStore } from '../inventory/inventoryStore';
import { useTrip } from '../trips/hooks';
import type { TripSummary } from '../trips/model';
import { quickInventory, suggestionChoices } from './addOptions';
import { categoryProgress, entriesInCategory, UNCATEGORISED } from './categories';
import { addToPackingCategory } from './components/ItemsTab';
import { EntryRow, openEntry, TravellerChips, type TravellerFilter } from './components/PackingParts';
import type { PackingEntry, PurchaseItem } from './model';
import { usePackingStore, useTripPacking } from './packingStore';

function Body({ trip, categoryKey, initialTraveller }: { trip: TripSummary; categoryKey: string; initialTraveller: TravellerFilter }) {
  const packing = useTripPacking(trip.id);
  const maps = useCategoryMaps();
  const items = useInventoryStore((state) => state.items);
  const categoriesStatus = useInventoryStore((state) => state.status);
  const [traveller, setTraveller] = useState<TravellerFilter>(initialTraveller);
  const [subId, setSubId] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<PackingEntry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const store = usePackingStore.getState;

  useFocusEffect(
    useCallback(() => {
      void usePackingStore.getState().load(trip.id);
    }, [trip.id]),
  );

  const category = categoryKey === UNCATEGORISED ? null : maps.byId.get(categoryKey) ?? null;
  const subcategories = category ? maps.childrenOf(category.id) : [];
  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const travellerNames = useMemo(() => new Map(trip.travellers.map((t) => [t.id, t.name])), [trip.travellers]);
  const bagNames = useMemo(() => new Map(packing.luggage.map((b) => [b.id, b.name])), [packing.luggage]);

  const inCategory = useMemo(() => entriesInCategory(packing.entries, categoryKey, maps.byId), [packing.entries, categoryKey, maps.byId]);
  const visible = inCategory.filter(
    (entry) =>
      (traveller === 'all' ? true : traveller === 'shared' ? !entry.travellerId : entry.travellerId === traveller) &&
      (!subId || entry.categoryId === subId),
  );
  const progress = categoryProgress(visible);

  // The shopping-list entry for each item (open ones first), if any.
  const purchaseByEntry = useMemo(() => {
    const map = new Map<string, PurchaseItem>();
    for (const purchase of packing.purchases) {
      if (!purchase.packingEntryId || purchase.status === 'skipped') continue;
      const current = map.get(purchase.packingEntryId);
      const open = purchase.status === 'needed' || purchase.status === 'purchased';
      if (!current || open) map.set(purchase.packingEntryId, purchase);
    }
    return map;
  }, [packing.purchases]);

  const badgeFor = (entry: PackingEntry): { label: string; tone: 'warning' | 'accent' | 'info' } | undefined => {
    const purchase = purchaseByEntry.get(entry.id);
    if (!purchase) return undefined;
    switch (purchase.status) {
      case 'needed':
        return { label: 'To buy', tone: 'warning' };
      case 'purchased':
        return { label: entry.isPacked ? 'Bought' : 'Bought · ready to pack', tone: 'accent' };
      case 'owned':
        return { label: 'Already had it', tone: 'info' };
      case 'borrowed':
        return { label: 'Borrowing', tone: 'info' };
      default:
        return undefined;
    }
  };

  // One-tap options: things you own in this category and default suggestions not yet on the trip.
  const QUICK_LIMIT = 8;
  const ownedOptions = useMemo(
    () => (categoryKey === UNCATEGORISED ? [] : quickInventory(items, categoryKey, maps.byId, packing.entries)),
    [items, categoryKey, maps.byId, packing.entries],
  );
  const systemKey = category?.systemKey ?? null;
  const suggestedOptions = suggestionChoices(systemKey, packing.entries, '', ownedOptions);
  const quickTraveller = traveller !== 'all' && traveller !== 'shared' ? traveller : null;
  const quickCategory = categoryKey === UNCATEGORISED ? null : categoryKey;

  const run = (fn: () => Promise<unknown>, fallback: string) => {
    setError(null);
    setInfo(null);
    fn().catch((err: unknown) => setError(toErrorMessage(err, fallback)));
  };

  async function remove(entry: PackingEntry) {
    const ok = await confirmAction({
      title: `Remove “${entry.name}”?`,
      message: entry.inventoryItemId
        ? 'It is removed from this trip only. The item stays in My Inventory.'
        : 'It is removed from this trip.',
      confirmLabel: 'Remove',
      destructive: true,
    });
    if (ok) run(() => store().removeEntry(trip.id, entry.id), 'Could not remove the item.');
  }

  const purchase = menuFor ? purchaseByEntry.get(menuFor.id) : undefined;
  const shoppingActions: SheetAction[] = !menuFor
    ? []
    : !purchase
      ? [
          {
            key: 'buy',
            label: 'Need to buy',
            description: 'Adds it to this trip’s shopping list',
            icon: 'cart-plus',
            onPress: () =>
              run(async () => {
                const { duplicate } = await store().needToBuy(trip.id, menuFor.id);
                setInfo(duplicate ? `${menuFor.name} is already on the shopping list.` : `${menuFor.name} added to the shopping list.`);
              }, 'Could not add it to the shopping list.'),
          },
        ]
      : purchase.status === 'needed'
        ? [
            {
              key: 'bought',
              label: 'Mark as bought',
              description: 'Then tick it when it is in the bag',
              icon: 'cart-check',
              onPress: () => run(() => store().setPurchaseStatus(trip.id, purchase.id, 'purchased'), 'Could not update the shopping list.'),
            },
          ]
        : purchase.status === 'purchased' && !purchase.inventoryItemId && !menuFor.inventoryItemId
          ? [
              {
                key: 'keep',
                label: 'Add to My Inventory',
                description: 'Keep it for future trips',
                icon: 'archive-plus-outline',
                onPress: () =>
                  run(async () => {
                    await store().purchaseToInventory(trip.id, purchase.id);
                    setInfo(`${menuFor.name} is now in My Inventory.`);
                  }, 'Could not add it to your inventory.'),
              },
            ]
          : [];

  const actions: SheetAction[] = menuFor
    ? [
        { key: 'edit', label: 'Edit', icon: 'pencil-outline', onPress: () => openEntry(trip.id, menuFor.id) },
        ...shoppingActions,
        {
          key: 'remove',
          label: 'Remove from this trip',
          icon: 'delete-outline',
          destructive: true,
          onPress: () => void remove(menuFor),
        },
      ]
    : [];

  if (categoryKey !== UNCATEGORISED && !category) {
    return (
      <Screen bottomInset>
        <ScreenHeader showBack eyebrow={trip.name} title="Category" />
        {categoriesStatus === 'ready' ? (
          <EmptyState icon="shape-outline" title="Category not found" message="It may have been deleted." />
        ) : (
          <LoadingState label="Loading…" />
        )}
      </Screen>
    );
  }

  const name = category?.name ?? 'Uncategorised';
  return (
    <Screen
      testID="packing-category-screen"
      bottomInset
      footer={
        <Button
          label="Add item"
          icon="plus"
          fullWidth
          onPress={() => addToPackingCategory(trip.id, categoryKey)}
          testID="category-add-item"
        />
      }
    >
      <ScreenHeader
        showBack
        eyebrow={`${trip.name} · Packing`}
        title={name}
        subtitle={category?.description || (category ? undefined : 'Items without a category')}
        trailing={
          category ? (
            <IconButton
              icon="pencil-outline"
              accessibilityLabel={`Edit category ${category.name}`}
              onPress={() => router.push({ pathname: '/inventory/categories/[categoryId]', params: { categoryId: category.id } })}
              testID="category-edit"
            />
          ) : undefined
        }
      />

      <Card style={styles.summary}>
        <AppText variant="bodyStrong" testID="category-progress">
          {progress.total === 0
            ? 'Nothing here yet'
            : `${progress.packed} of ${progress.total} packed · ${progress.remaining} left`}
        </AppText>
        <ProgressBar value={progress.total === 0 ? 0 : progress.packed / progress.total} accessibilityLabel={`${name} progress`} />
      </Card>

      {trip.travellers.length > 1 ? <TravellerChips travellers={trip.travellers} value={traveller} onChange={setTraveller} /> : null}
      {subcategories.length > 0 ? (
        <View style={styles.chips}>
          <OptionTile layout="chip" label="All" icon="shape-outline" selected={!subId} onPress={() => setSubId(null)} />
          {subcategories.map((sub) => (
            <OptionTile key={sub.id} layout="chip" label={sub.name} icon={sub.icon} selected={subId === sub.id} onPress={() => setSubId(sub.id)} />
          ))}
        </View>
      ) : null}

      {error ? <Notice tone="danger" title="Not updated" message={error} /> : null}
      {info ? (
        <Notice
          tone="success"
          title={info}
          action={{ label: 'Shopping list', icon: 'cart-outline', onPress: () => router.push({ pathname: '/trips/[tripId]/packing', params: { tripId: trip.id, tab: 'buy' } }) }}
          testID="category-info"
        />
      ) : null}

      {packing.status === 'error' ? (
        <ErrorState message={packing.error ?? 'Could not load the packing list.'} onRetry={() => void store().load(trip.id)} />
      ) : !packing.state ? (
        <LoadingState label="Loading…" />
      ) : visible.length === 0 ? (
        <EmptyState
          icon={category?.icon ?? 'tray-full'}
          title={`Nothing in ${name} yet`}
          message="Add things you own, suggested items or something just for this trip. New items start unpacked."
        />
      ) : (
        <View style={styles.list} testID="category-items">
          {visible.map((entry) => (
            <EntryRow
              key={entry.id}
              entry={entry}
              item={entry.inventoryItemId ? itemById.get(entry.inventoryItemId) : undefined}
              maps={maps}
              travellerName={entry.travellerId ? travellerNames.get(entry.travellerId) : undefined}
              bagName={entry.luggageId ? bagNames.get(entry.luggageId) : undefined}
              badge={badgeFor(entry)}
              onToggle={(e) => run(() => store().togglePacked(trip.id, e.id), 'Could not update the item.')}
              onMenu={setMenuFor}
            />
          ))}
        </View>
      )}

      {ownedOptions.length + suggestedOptions.length > 0 ? (
        <View style={styles.quick} testID="category-quick-add">
          <AppText variant="label" tone="textMuted">
            Quick add · tap to add, starts unpacked
          </AppText>
          {ownedOptions.length > 0 ? (
            <View style={styles.chips} testID="quick-owned">
              {ownedOptions.slice(0, QUICK_LIMIT).map((item) => (
                <OptionTile
                  key={item.id}
                  layout="chip"
                  label={item.name}
                  icon="archive-check-outline"
                  selected={false}
                  onPress={() =>
                    run(
                      () =>
                        store().addEntry(trip.id, {
                          inventoryItemId: item.id,
                          name: item.name,
                          categoryId: quickCategory,
                          travellerId: quickTraveller,
                          source: 'inventory',
                        }),
                      'Could not add the item.',
                    )
                  }
                  testID={`quick-owned-${item.name}`}
                />
              ))}
            </View>
          ) : null}
          {suggestedOptions.length > 0 ? (
            <View style={styles.chips} testID="quick-suggested">
              {suggestedOptions.slice(0, QUICK_LIMIT).map((suggestion) => (
                <OptionTile
                  key={suggestion.name}
                  layout="chip"
                  label={suggestion.name}
                  icon="plus"
                  selected={false}
                  onPress={() =>
                    run(
                      () =>
                        store().addEntry(trip.id, {
                          name: suggestion.name,
                          unit: suggestion.unit,
                          categoryId: quickCategory,
                          travellerId: quickTraveller,
                          source: 'manual',
                        }),
                      'Could not add the item.',
                    )
                  }
                  testID={`quick-suggested-${suggestion.name}`}
                />
              ))}
            </View>
          ) : null}
          <AppText variant="caption" tone="textMuted">
            Archive icon: you own it (from My Inventory). Plus: a suggestion just for this trip. Use Add item to search,
            set quantities or create your own.
          </AppText>
        </View>
      ) : null}

      <ActionSheet
        visible={menuFor !== null}
        title={menuFor?.name ?? ''}
        subtitle="This trip only"
        actions={actions}
        onClose={() => setMenuFor(null)}
        testID="entry-actions"
      />
    </Screen>
  );
}

export function CategoryPackingScreen({
  tripId,
  categoryId,
  traveller,
}: {
  tripId: string | undefined;
  categoryId: string | undefined;
  traveller?: string;
}) {
  useEnsureInventoryLoaded();
  const { trip, status, error, reload } = useTrip(tripId);
  if (trip && categoryId) {
    return <Body trip={trip} categoryKey={categoryId} initialTraveller={traveller ?? 'all'} />;
  }
  return (
    <Screen bottomInset>
      <ScreenHeader showBack title="Packing" />
      {status === 'error' ? (
        <ErrorState message={error ?? 'Could not load your trips.'} onRetry={() => void reload()} />
      ) : status === 'ready' ? (
        <EmptyState icon="map-marker-question-outline" title="Trip not found" message="It may have been deleted from this device." />
      ) : (
        <LoadingState label="Loading…" />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  summary: {
    gap: spacing.sm,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  list: {
    gap: spacing.sm,
  },
  quick: {
    gap: spacing.sm,
  },
});
