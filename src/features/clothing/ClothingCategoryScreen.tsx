import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Screen } from '@/components/layout/Screen';
import { goBackOrHome, ScreenHeader } from '@/components/layout/ScreenHeader';
import { ActionSheet, AppText, Button, Card, Icon, IconButton, LoadingState, MiniStepper, Notice, OptionTile, SearchField, TextField } from '@/components/ui';
import { confirmAction } from '@/lib/confirm';
import { toErrorMessage } from '@/lib/errors';
import { colors, radii, spacing } from '@/theme';

import { useInventoryStore } from '../inventory/inventoryStore';
import { PACKING_LIMITS, type PackingEntry } from '../packing/model';
import { usePackingStore, useTripPacking } from '../packing/packingStore';
import { useTrip } from '../trips/hooks';
import { useClothingStore, useTripClothing } from './clothingStore';
import { CATEGORY_ICONS } from './model';

/** One item's editor: name, quantity, notes, bag, packed, category, remove. */
function ItemEditor({ tripId, entry, onClose }: { tripId: string; entry: PackingEntry; onClose: () => void }) {
  const packing = useTripPacking(tripId);
  const clothing = useTripClothing(tripId);
  const [name, setName] = useState(entry.name);
  const [notes, setNotes] = useState(entry.notes);
  const [error, setError] = useState<string | null>(null);
  const store = usePackingStore.getState;
  const run = (fn: () => Promise<unknown>) => {
    setError(null);
    fn().catch((err: unknown) => setError(toErrorMessage(err, 'Could not save that.')));
  };
  const dirty = name.trim() !== entry.name || notes.trim() !== entry.notes;
  return (
    <Card variant="outline" testID="clothing-item-editor">
      <View style={styles.group}>
        <View style={styles.row}>
          <AppText variant="title" style={styles.flex} numberOfLines={1}>
            {entry.name}
          </AppText>
          <IconButton icon="close" size="sm" accessibilityLabel="Close editor" onPress={onClose} />
        </View>
        <TextField label="Name" value={name} onChangeText={setName} maxLength={PACKING_LIMITS.nameMax} testID="clothing-item-name" />
        <TextField label="Notes" value={notes} onChangeText={setNotes} maxLength={PACKING_LIMITS.notesMax} multiline testID="clothing-item-notes" />
        {dirty ? <Button label="Save" size="sm" icon="content-save-outline" onPress={() => run(() => store().updateEntry(tripId, entry.id, { name, notes }))} style={styles.left} testID="clothing-item-save" /> : null}
        <View style={styles.row}>
          <AppText variant="body" style={styles.flex}>
            Quantity
          </AppText>
          <MiniStepper label="Quantity" value={entry.quantity} min={1} max={PACKING_LIMITS.quantityMax} onChange={(quantity) => run(() => store().updateEntry(tripId, entry.id, { quantity }))} testID="clothing-item-qty" />
        </View>
        <AppText variant="label" tone="textSecondary">
          Bag
        </AppText>
        <View style={styles.chips}>
          <OptionTile layout="chip" role="radio" label="No bag" icon="tray" selected={!entry.luggageId} onPress={() => run(() => store().updateEntry(tripId, entry.id, { luggageId: null }))} />
          {packing.luggage.map((b) => (
            <OptionTile key={b.id} layout="chip" role="radio" label={b.name} icon="bag-suitcase-outline" selected={entry.luggageId === b.id} onPress={() => run(() => store().updateEntry(tripId, entry.id, { luggageId: b.id }))} testID={`clothing-item-bag-${b.name}`} />
          ))}
        </View>
        <AppText variant="label" tone="textSecondary">
          Category
        </AppText>
        <View style={styles.chips}>
          {clothing.categories.map((c) => (
            <OptionTile key={c.id} layout="chip" role="radio" label={c.name} icon={c.icon} selected={clothing.links[entry.id] === c.id} onPress={() => run(() => useClothingStore.getState().setCategory(tripId, entry.id, c.id))} />
          ))}
        </View>
        <View style={styles.row}>
          <Button
            label={entry.isPacked ? 'Packed' : 'Mark packed'}
            icon={entry.isPacked ? 'check-circle' : 'checkbox-blank-circle-outline'}
            variant={entry.isPacked ? 'secondary' : 'primary'}
            size="sm"
            onPress={() => run(() => store().togglePacked(tripId, entry.id))}
            testID="clothing-item-packed"
          />
          <Button
            label="Remove"
            icon="trash-can-outline"
            variant="ghost"
            size="sm"
            onPress={() =>
              void confirmAction({
                title: `Remove ${entry.name}?`,
                message: entry.inventoryItemId ? 'It comes off this trip’s packing list. Your Inventory item is not changed.' : 'It comes off this trip’s packing list.',
                confirmLabel: 'Remove',
                destructive: true,
              }).then((ok) => {
                if (ok) {
                  onClose();
                  run(() => store().removeEntry(tripId, entry.id));
                }
              })
            }
            testID="clothing-item-remove"
          />
        </View>
        {error ? <Notice tone="danger" title={error} /> : null}
      </View>
    </Card>
  );
}

/**
 * One clothing category (e.g. T-shirts): its pieces as a grid with packed
 * state and bag, adding pieces by hand or from Inventory (the Inventory item
 * is linked, never copied or changed), renaming and deleting the category.
 */
export function ClothingCategoryScreen({ tripId, categoryId }: { tripId: string | undefined; categoryId: string | undefined }) {
  const { trip } = useTrip(tripId);
  const clothing = useTripClothing(tripId);
  const packing = useTripPacking(tripId);
  const inventory = useInventoryStore((s) => s.items);
  const inventoryCategories = useInventoryStore((s) => s.categories);
  const [name, setName] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [picking, setPicking] = useState(false);
  const [onlyClothing, setOnlyClothing] = useState(true);
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [icon, setIcon] = useState(CATEGORY_ICONS[0]!);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (tripId) void useClothingStore.getState().load(tripId);
    }, [tripId]),
  );
  useEffect(() => {
    if (picking) void useInventoryStore.getState().load();
  }, [picking]);

  const category = clothing.categories.find((c) => c.id === categoryId) ?? null;
  if (!tripId || !trip || !category) {
    return (
      <Screen bottomInset>
        <ScreenHeader showBack title="Clothing" />
        {clothing.status === 'ready' && !category ? <Notice tone="info" title="This category no longer exists." /> : <LoadingState label="Loading…" />}
      </Screen>
    );
  }

  const items = packing.entries.filter((e) => clothing.links[e.id] === category.id);
  const bagName = new Map(packing.luggage.map((b) => [b.id, b.name]));
  const packed = items.reduce((n, e) => n + (e.isPacked ? e.quantity : 0), 0);
  const units = items.reduce((n, e) => n + e.quantity, 0);
  const editingEntry = items.find((e) => e.id === editing) ?? null;
  const onTrip = new Set(packing.entries.flatMap((e) => (e.inventoryItemId ? [e.inventoryItemId] : [])));
  const clothingCat = inventoryCategories.find((c) => c.systemKey === 'clothing');
  const clothingIds = new Set(inventoryCategories.filter((c) => c.id === clothingCat?.id || c.parentId === clothingCat?.id).map((c) => c.id));
  const choices = inventory
    .filter((i) => !i.archivedAt)
    .filter((i) => !onlyClothing || (i.categoryId && clothingIds.has(i.categoryId)) || (i.subcategoryId && clothingIds.has(i.subcategoryId)))
    .filter((i) => !query.trim() || i.name.toLowerCase().includes(query.trim().toLowerCase()))
    .slice(0, 40);

  const run = (fn: () => Promise<unknown>, fallback: string) => {
    setError(null);
    return fn().then(
      () => true,
      (err: unknown) => {
        setError(toErrorMessage(err, fallback));
        return false;
      },
    );
  };
  const others = clothing.categories.filter((c) => c.id !== category.id);

  return (
    <Screen testID="clothing-category" bottomInset>
      <ScreenHeader
        showBack
        eyebrow={`${trip.name} · Clothing`}
        title={category.name}
        trailing={
          <IconButton
            icon="pencil-outline"
            accessibilityLabel="Rename category"
            onPress={() => {
              setRenaming(category.name);
              setIcon(category.icon);
            }}
            testID="clothing-category-rename"
          />
        }
      />

      {renaming !== null ? (
        <Card>
          <View style={styles.group}>
            <TextField label="Category name" value={renaming} onChangeText={setRenaming} maxLength={40} testID="clothing-category-rename-input" />
            <View style={styles.chips}>
              {CATEGORY_ICONS.map((i) => (
                <OptionTile key={i} layout="chip" role="radio" label={i.replace(/-outline$/, "").replace(/-/g, " ")} icon={i} selected={icon === i} onPress={() => setIcon(i)} />
              ))}
            </View>
            <View style={styles.row}>
              <Button
                label="Save"
                size="sm"
                onPress={() => void run(() => useClothingStore.getState().updateCategory(tripId, category.id, renaming, icon), 'Could not rename it.').then((ok) => ok && setRenaming(null))}
                testID="clothing-category-rename-save"
              />
              <Button label="Delete category" icon="trash-can-outline" variant="ghost" size="sm" onPress={() => setDeleting(true)} testID="clothing-category-delete" />
              <Button label="Cancel" variant="ghost" size="sm" onPress={() => setRenaming(null)} />
            </View>
          </View>
        </Card>
      ) : null}

      <AppText variant="caption" tone="textMuted" testID="clothing-category-progress">
        {items.length === 0 ? 'Nothing here yet.' : `${items.length} ${items.length === 1 ? 'item' : 'items'} · ${packed} of ${units} packed`}
      </AppText>

      <View style={styles.grid} testID="clothing-items">
        {items.map((e) => (
          <Pressable
            key={e.id}
            accessibilityRole="button"
            accessibilityLabel={`${e.name}, ${e.quantity}, ${e.isPacked ? 'packed' : 'not packed'}${e.luggageId ? `, in ${bagName.get(e.luggageId) ?? 'a bag'}` : ''}`}
            onPress={() => setEditing(e.id === editing ? null : e.id)}
            style={({ pressed }) => [styles.card, e.isPacked && styles.cardPacked, editing === e.id && styles.cardEditing, pressed && styles.pressed]}
            testID={`clothing-item-${e.name}`}
          >
            <View style={styles.cardTop}>
              <Icon name={category.icon} size={26} tone={e.isPacked ? 'accent' : 'textSecondary'} />
              <IconButton
                icon={e.isPacked ? 'check-circle' : 'checkbox-blank-circle-outline'}
                tone={e.isPacked ? 'accent' : 'textMuted'}
                variant="plain"
                size="sm"
                accessibilityLabel={e.isPacked ? `Mark ${e.name} as not packed` : `Mark ${e.name} as packed`}
                onPress={() => void run(() => usePackingStore.getState().togglePacked(tripId, e.id), 'Could not change it.')}
                testID={`clothing-item-toggle-${e.name}`}
              />
            </View>
            <AppText variant="bodyStrong" numberOfLines={2}>
              {e.name}
            </AppText>
            <AppText variant="caption" tone="textMuted" numberOfLines={1}>
              ×{e.quantity}
              {e.inventoryItemId ? ' · Inventory' : ''}
            </AppText>
            <AppText variant="caption" tone={e.luggageId ? 'info' : 'textMuted'} numberOfLines={1}>
              {e.luggageId ? (bagName.get(e.luggageId) ?? 'Bag') : 'No bag'}
            </AppText>
          </Pressable>
        ))}
      </View>
      {editingEntry ? <ItemEditor key={editingEntry.id} tripId={tripId} entry={editingEntry} onClose={() => setEditing(null)} /> : null}

      <Card testID="clothing-add-item">
        <View style={styles.group}>
          <AppText variant="label" tone="textSecondary">
            Add to {category.name}
          </AppText>
          <TextField label="Name" placeholder="e.g. White linen shirt" value={name} onChangeText={setName} maxLength={PACKING_LIMITS.nameMax} testID="clothing-new-name" />
          <View style={styles.row}>
            <AppText variant="body" style={styles.flex}>
              Quantity
            </AppText>
            <MiniStepper label="Quantity" value={quantity} min={1} max={PACKING_LIMITS.quantityMax} onChange={setQuantity} testID="clothing-new-qty" />
          </View>
          <View style={styles.row}>
            <Button
              label="Add"
              icon="plus"
              size="sm"
              disabled={!name.trim()}
              onPress={() =>
                void run(() => useClothingStore.getState().addItem(tripId, category.id, { name: name.trim(), quantity, source: 'manual' }), 'Could not add it.').then((ok) => {
                  if (ok) {
                    setName('');
                    setQuantity(1);
                  }
                })
              }
              testID="clothing-new-add"
            />
            <Button label={picking ? 'Hide Inventory' : 'From Inventory'} icon="archive-outline" variant="secondary" size="sm" onPress={() => setPicking((v) => !v)} testID="clothing-from-inventory" />
          </View>
        </View>
      </Card>

      {picking ? (
        <View style={styles.group} testID="clothing-inventory">
          <SearchField value={query} onChangeText={setQuery} placeholder="Search your inventory" />
          <View style={styles.chips}>
            <OptionTile layout="chip" label="Clothing" icon="tshirt-crew-outline" selected={onlyClothing} onPress={() => setOnlyClothing(true)} />
            <OptionTile layout="chip" label="Everything" icon="archive-outline" selected={!onlyClothing} onPress={() => setOnlyClothing(false)} />
          </View>
          {choices.length === 0 ? (
            <AppText variant="caption" tone="textMuted">
              No matching inventory items.
            </AppText>
          ) : (
            choices.map((i) => {
              const already = onTrip.has(i.id);
              return (
                <View key={i.id} style={styles.pick}>
                  <View style={styles.flex}>
                    <AppText variant="bodyStrong" numberOfLines={1}>
                      {i.name}
                    </AppText>
                    <AppText variant="caption" tone="textMuted">
                      {already ? 'Already on this trip' : `You have ${i.quantity}`}
                    </AppText>
                  </View>
                  <Button
                    label={already ? 'Added' : 'Add'}
                    size="sm"
                    variant="secondary"
                    disabled={already}
                    onPress={() =>
                      void run(
                        () => useClothingStore.getState().addItem(tripId, category.id, { name: i.name, inventoryItemId: i.id, quantity: 1, source: 'inventory', categoryId: i.categoryId }),
                        'Could not add it from Inventory.',
                      )
                    }
                    testID={`clothing-inventory-add-${i.name}`}
                  />
                </View>
              );
            })
          )}
        </View>
      ) : null}

      {error ? <Notice tone="danger" title={error} testID="clothing-category-error" /> : null}

      <ActionSheet
        visible={deleting}
        title={`Delete ${category.name}?`}
        subtitle={items.length ? `Its ${items.length} ${items.length === 1 ? 'item stays' : 'items stay'} on the packing list. Where should ${items.length === 1 ? 'it' : 'they'} go?` : 'The category is empty.'}
        actions={[
          ...others.map((c) => ({
            key: c.id,
            label: items.length ? `Move to ${c.name}` : `Delete`,
            icon: c.icon,
            onPress: () => {
              setDeleting(false);
              void run(() => useClothingStore.getState().removeCategory(tripId, category.id, c.id), 'Could not delete it.').then((ok) => ok && goBackOrHome());
            },
          })).slice(0, items.length ? others.length : 0),
          {
            key: 'none',
            label: items.length ? 'Keep them without a category' : 'Delete category',
            icon: 'trash-can-outline' as const,
            destructive: true,
            onPress: () => {
              setDeleting(false);
              void run(() => useClothingStore.getState().removeCategory(tripId, category.id, null), 'Could not delete it.').then((ok) => ok && goBackOrHome());
            },
          },
        ]}
        onClose={() => setDeleting(false)}
        testID="clothing-category-delete-sheet"
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  group: { gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  flex: { flex: 1, minWidth: 0 },
  left: { alignSelf: 'flex-start' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  card: {
    width: '31%',
    flexGrow: 1,
    minWidth: 100,
    gap: spacing.xxs,
    padding: spacing.sm,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  cardPacked: { borderColor: colors.accentBorder },
  cardEditing: { borderColor: colors.info },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  pick: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  pressed: { backgroundColor: colors.surfacePressed },
});
