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
import { placeholderFor, useCategoryMaps, useEnsureInventoryLoaded, type CategoryMaps } from '../inventory/hooks';
import { useInventoryStore } from '../inventory/inventoryStore';
import type { CategoryKey, InventoryItemSummary } from '../inventory/model';
import { useTrip } from '../trips/hooks';
import type { TripSummary } from '../trips/model';
import { blockedReason, canCreate, inventoryChoices, suggestionChoices, type SuggestionChoice } from './addOptions';
import { UNCATEGORISED } from './categories';
import { PACKING_LIMITS, UNIT_META, type EntryUnit, type NewEntryInput } from './model';
import { usePackingStore, useTripPacking } from './packingStore';

/** Something the user chose to add. Nothing is added until they confirm. */
type Pick =
  | { kind: 'inventory'; itemId: string; name: string; quantity: number; elsewhere: boolean }
  | { kind: 'suggestion'; name: string; unit: EntryUnit; categoryKey: CategoryKey; quantity: number }
  | { kind: 'new'; name: string; quantity: number };

const inventoryKey = (id: string) => `inv:${id}`;
const suggestionKey = (name: string) => `sug:${name}`;
const newKey = (name: string) => `new:${name.trim().toLowerCase()}`;

function SelectRow({
  selected,
  disabled,
  onPress,
  label,
  accessibilityLabel,
  testID,
  leading,
  title,
  caption,
  captionTone = 'textMuted',
  quantity,
  quantityMax,
  onQuantity,
  quantityTestID,
}: {
  selected: boolean;
  disabled?: boolean;
  onPress: () => void;
  label: string;
  accessibilityLabel: string;
  testID: string;
  leading?: React.ReactNode;
  title: string;
  caption: string;
  captionTone?: 'textMuted' | 'warning' | 'danger';
  quantity?: number;
  quantityMax: number;
  onQuantity: (value: number) => void;
  quantityTestID: string;
}) {
  return (
    <View style={[styles.row, selected && styles.rowSelected, disabled && styles.rowBlocked]}>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: selected, disabled: Boolean(disabled) }}
        accessibilityLabel={accessibilityLabel}
        disabled={disabled}
        onPress={onPress}
        style={styles.rowMain}
        testID={testID}
      >
        <Icon name={selected ? 'checkbox-marked' : 'checkbox-blank-outline'} tone={selected ? 'accent' : 'textMuted'} />
        {leading}
        <View style={styles.flex}>
          <AppText variant="bodyStrong" numberOfLines={1}>
            {title}
          </AppText>
          <AppText variant="caption" tone={captionTone} numberOfLines={1}>
            {caption}
          </AppText>
        </View>
      </Pressable>
      {selected && quantity !== undefined ? (
        <MiniStepper value={quantity} min={1} max={quantityMax} label={label} onChange={onQuantity} testID={quantityTestID} />
      ) : null}
    </View>
  );
}

function Section({ title, children, testID }: { title: string; children: React.ReactNode; testID?: string }) {
  return (
    <View style={styles.group} testID={testID}>
      <AppText variant="label" tone="textMuted">
        {title}
      </AppText>
      <View style={styles.list}>{children}</View>
    </View>
  );
}

function starterCategoryId(maps: CategoryMaps, key: CategoryKey): string | null {
  return maps.topLevel.find((category) => category.systemKey === key)?.id ?? null;
}

function Picker({ trip, categoryKey }: { trip: TripSummary; categoryKey?: string }) {
  const items = useInventoryStore((state) => state.items);
  const status = useInventoryStore((state) => state.status);
  const packing = useTripPacking(trip.id);
  const maps = useCategoryMaps();
  const [query, setQuery] = useState('');
  const [picks, setPicks] = useState<Record<string, Pick>>({});
  const [travellerId, setTravellerId] = useState<string | null>(null);
  const [free, setFree] = useState<Record<string, number> | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scope = categoryKey ?? null; // null: opened without a category
  const category = scope && scope !== UNCATEGORISED ? maps.byId.get(scope) ?? null : null;
  const systemKey = category?.systemKey ?? null;

  const inventory = useMemo(() => inventoryChoices(items, scope, maps.byId, query), [items, scope, maps.byId, query]);
  // Owned items shown on this screen take the place of matching suggestions.
  const suggestions = useMemo(
    () => suggestionChoices(systemKey, packing.entries, query, [...inventory.here, ...inventory.elsewhere]),
    [systemKey, packing.entries, query, inventory],
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

  const togglePick = (key: string, pick: Pick) =>
    setPicks((current) => {
      const next = { ...current };
      if (next[key]) delete next[key];
      else next[key] = pick;
      return next;
    });
  const setQuantity = (key: string, quantity: number) =>
    setPicks((current) => (current[key] ? { ...current, [key]: { ...current[key], quantity } } : current));

  const newPicks = Object.entries(picks).filter((entry): entry is [string, Extract<Pick, { kind: 'new' }>] => entry[1].kind === 'new');
  const knownNames = [
    ...packing.entries.map((e) => e.name),
    ...inventory.here.map((i) => i.name),
    ...inventory.elsewhere.map((i) => i.name),
    ...suggestions.map((s) => s.name),
    ...newPicks.map(([, p]) => p.name),
  ];
  const offerCreate = canCreate(query, knownNames) && query.trim().length <= PACKING_LIMITS.nameMax;

  function createFromQuery() {
    const name = query.trim().replace(/\s+/g, ' ');
    if (!name) return;
    setPicks((current) => ({ ...current, [newKey(name)]: { kind: 'new', name, quantity: 1 } }));
    setQuery('');
  }

  const count = Object.keys(picks).length;
  const targetCategory = scope === null ? undefined : scope === UNCATEGORISED ? null : scope;

  async function add() {
    setSaving(true);
    setError(null);
    try {
      const inputs: NewEntryInput[] = Object.values(picks).map((pick) => {
        const base = { quantity: pick.quantity, travellerId };
        if (pick.kind === 'inventory') {
          return {
            ...base,
            inventoryItemId: pick.itemId,
            name: pick.name,
            source: 'inventory' as const,
            // Items of this category go here; items found in other categories keep their own.
            ...(targetCategory !== undefined && !pick.elsewhere ? { categoryId: targetCategory } : {}),
          };
        }
        if (pick.kind === 'suggestion') {
          return {
            ...base,
            name: pick.name,
            unit: pick.unit,
            source: 'manual' as const,
            categoryId: targetCategory !== undefined ? targetCategory : starterCategoryId(maps, pick.categoryKey),
          };
        }
        return { ...base, name: pick.name, source: 'manual' as const, categoryId: targetCategory ?? null };
      });
      await usePackingStore.getState().addEntries(trip.id, inputs);
      successFeedback();
      goBackOrHome();
    } catch (err) {
      setError(toErrorMessage(err, 'Could not add those items.'));
      setSaving(false);
    }
  }

  const renderInventory = (item: InventoryItemSummary, elsewhere: boolean) => {
    const key = inventoryKey(item.id);
    const blocked = blockedReason(item);
    const freeUnits = free?.[item.id] ?? 0;
    const pick = picks[key];
    const placeholder = placeholderFor(item, maps);
    const listed = onList.get(item.id);
    return (
      <SelectRow
        key={key}
        selected={Boolean(pick)}
        disabled={Boolean(blocked)}
        onPress={() => togglePick(key, { kind: 'inventory', itemId: item.id, name: item.name, quantity: 1, elsewhere })}
        label={item.name}
        accessibilityLabel={`${item.name}, ${blocked ?? `${freeUnits} of ${item.quantity} free`}`}
        testID={`pick-${item.name}`}
        leading={<ItemImage image={item.image} fallbackIcon={placeholder.icon} fallbackColor={placeholder.color} size={40} rounded={radii.sm} />}
        title={item.name}
        caption={`${blocked ?? `${freeUnits} of ${item.quantity} free for these dates`}${listed ? ` · on this trip ×${listed}` : ''}`}
        captionTone={blocked ? 'danger' : freeUnits === 0 ? 'warning' : 'textMuted'}
        quantity={pick?.quantity}
        quantityMax={Math.max(1, Math.min(item.quantity, PACKING_LIMITS.quantityMax))}
        onQuantity={(value) => setQuantity(key, value)}
        quantityTestID={`pick-qty-${item.name}`}
      />
    );
  };

  const renderSuggestion = (suggestion: SuggestionChoice) => {
    const key = suggestionKey(suggestion.name);
    const pick = picks[key];
    return (
      <SelectRow
        key={key}
        selected={Boolean(pick)}
        onPress={() =>
          togglePick(key, {
            kind: 'suggestion',
            name: suggestion.name,
            unit: suggestion.unit,
            categoryKey: suggestion.categoryKey,
            quantity: 1,
          })
        }
        label={suggestion.name}
        accessibilityLabel={`${suggestion.name}, suggested`}
        testID={`suggest-${suggestion.name}`}
        title={suggestion.name}
        caption={`Suggested · counted in ${UNIT_META[suggestion.unit].label.toLowerCase()} · trip only`}
        quantity={pick?.quantity}
        quantityMax={PACKING_LIMITS.quantityMax}
        onQuantity={(value) => setQuantity(key, value)}
        quantityTestID={`suggest-qty-${suggestion.name}`}
      />
    );
  };

  const ownsNothing = items.filter((i) => !i.archivedAt).length === 0;
  const loading = status !== 'ready' || (itemIds !== '' && free === null);
  const nothingFound =
    !loading && inventory.here.length + inventory.elsewhere.length + suggestions.length === 0 && !offerCreate;

  return (
    <Screen
      testID="packing-add"
      footer={
        <View style={styles.footer}>
          <Button label="Cancel" variant="secondary" onPress={goBackOrHome} disabled={saving} />
          <Button
            label={count === 0 ? 'Choose items' : `Add ${count} ${count === 1 ? 'item' : 'items'}`}
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
      <ScreenHeader
        showBack
        backIcon="close"
        eyebrow={trip.name}
        title={category ? `Add to ${category.name}` : scope === UNCATEGORISED ? 'Add without a category' : 'Add items'}
        subtitle="For this trip. New items start unpacked."
      />
      {packing.state?.confirmedAt ? (
        <Notice tone="info" icon="calendar-lock" title="This list is confirmed" message="Items you own are reserved straight away, so they must be free for these dates." />
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
      <SearchField value={query} onChangeText={setQuery} placeholder="Search or type a new item" testID="packing-add-search" />
      {error ? <Notice tone="danger" title="Not added" message={error} /> : null}

      {offerCreate ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Create ${query.trim()} for this trip`}
          onPress={createFromQuery}
          style={({ pressed }) => [styles.create, pressed && styles.pressed]}
          testID="packing-create"
        >
          <Icon name="plus-circle-outline" tone="accent" />
          <View style={styles.flex}>
            <AppText variant="bodyStrong" numberOfLines={1}>
              Create “{query.trim()}”
            </AppText>
            <AppText variant="caption" tone="textMuted">
              Trip-only item · not added to My Inventory
            </AppText>
          </View>
        </Pressable>
      ) : null}

      {newPicks.length > 0 ? (
        <Section title="New for this trip" testID="packing-add-new">
          {newPicks.map(([key, pick]) => (
            <SelectRow
              key={key}
              selected
              onPress={() => togglePick(key, pick)}
              label={pick.name}
              accessibilityLabel={`${pick.name}, new trip-only item`}
              testID={`new-${pick.name}`}
              title={pick.name}
              caption="Trip only"
              quantity={pick.quantity}
              quantityMax={PACKING_LIMITS.quantityMax}
              onQuantity={(value) => setQuantity(key, value)}
              quantityTestID={`new-qty-${pick.name}`}
            />
          ))}
        </Section>
      ) : null}

      {loading ? (
        <LoadingState label="Checking what is free…" />
      ) : (
        <>
          {inventory.here.length > 0 ? (
            <Section title={category ? `You own · ${category.name}` : 'You own'} testID="packing-add-inventory">
              {inventory.here.map((item) => renderInventory(item, false))}
            </Section>
          ) : null}
          {inventory.elsewhere.length > 0 ? (
            <Section title="You own · other categories (they keep their category)" testID="packing-add-inventory-other">
              {inventory.elsewhere.map((item) => renderInventory(item, true))}
            </Section>
          ) : null}
          {suggestions.length > 0 ? (
            <Section title="Suggested" testID="packing-add-suggestions">
              {suggestions.map(renderSuggestion)}
            </Section>
          ) : null}
          {ownsNothing ? (
            <Button
              label="Add things you own to My Inventory"
              icon="archive-plus-outline"
              variant="ghost"
              size="sm"
              onPress={() => router.push('/inventory/item/new')}
              style={styles.left}
            />
          ) : null}
          {nothingFound ? (
            <AppText variant="caption" tone="textMuted">
              {query.trim() ? `Nothing matches “${query.trim()}”.` : 'Type a name to search or create an item for this trip.'}
            </AppText>
          ) : null}
        </>
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
      <ScreenHeader showBack backIcon="close" title="Add items" />
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
  left: {
    alignSelf: 'flex-start',
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
  create: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.accentBorder,
  },
  pressed: {
    opacity: 0.75,
  },
  flex: {
    flex: 1,
    minWidth: 0,
  },
});
