import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Screen } from '@/components/layout/Screen';
import { goBackOrHome, ScreenHeader } from '@/components/layout/ScreenHeader';
import {
  AppText,
  Button,
  Card,
  EmptyState,
  LoadingState,
  Notice,
  OptionTile,
  Stepper,
  TextField,
  ToggleRow,
} from '@/components/ui';
import { confirmAction } from '@/lib/confirm';
import { toErrorMessage } from '@/lib/errors';
import { successFeedback } from '@/lib/haptics';
import { spacing } from '@/theme';

import { useCategoryMaps, useEnsureInventoryLoaded } from '../inventory/hooks';
import { useInventoryStore } from '../inventory/inventoryStore';
import { useTrip } from '../trips/hooks';
import type { TripSummary } from '../trips/model';
import { LUGGAGE_META, PACKING_LIMITS, type EntryPatch, type PackingEntry } from './model';
import { usePackingStore, useTripPacking } from './packingStore';

function ChipRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.group}>
      <AppText variant="label" tone="textSecondary">
        {label}
      </AppText>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {children}
      </ScrollView>
    </View>
  );
}

function Form({ trip, entry }: { trip: TripSummary; entry: PackingEntry }) {
  const packing = useTripPacking(trip.id);
  const maps = useCategoryMaps();
  const item = useInventoryStore((state) => state.items.find((i) => i.id === entry.inventoryItemId));
  const [draft, setDraft] = useState<Required<EntryPatch>>({
    name: entry.name,
    categoryId: entry.categoryId,
    quantity: entry.quantity,
    travellerId: entry.travellerId,
    luggageId: entry.luggageId,
    isPacked: entry.isPacked,
    notes: entry.notes,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const patch = (value: Partial<EntryPatch>) => setDraft((current) => ({ ...current, ...value }));
  const nameError = draft.name.trim() ? undefined : 'Give the item a name.';

  async function save() {
    if (nameError) return;
    setSaving(true);
    setError(null);
    try {
      await usePackingStore.getState().updateEntry(trip.id, entry.id, { ...draft, name: draft.name.trim() });
      successFeedback();
      goBackOrHome();
    } catch (err) {
      setError(toErrorMessage(err, 'Could not save.'));
      setSaving(false);
    }
  }

  async function remove() {
    const ok = await confirmAction({
      title: `Remove "${entry.name}" from this trip?`,
      message: entry.inventoryItemId
        ? 'Only this packing entry is removed. The item stays in your inventory, and any reservation for this trip is released.'
        : 'This one-time item is removed from the packing list.',
      confirmLabel: 'Remove from trip',
      destructive: true,
    });
    if (!ok) return;
    setSaving(true);
    try {
      await usePackingStore.getState().removeEntry(trip.id, entry.id);
      goBackOrHome();
    } catch (err) {
      setError(toErrorMessage(err, 'Could not remove it.'));
      setSaving(false);
    }
  }

  return (
    <Screen
      testID="entry-editor"
      footer={
        <View style={styles.footer}>
          <Button label="Cancel" variant="secondary" onPress={goBackOrHome} disabled={saving} />
          <Button label="Save" icon="content-save-outline" onPress={() => void save()} loading={saving} style={styles.primary} testID="entry-save" />
        </View>
      }
    >
      <ScreenHeader showBack backIcon="close" eyebrow={trip.name} title="Packing entry" />

      <Card>
        {entry.inventoryItemId && item ? (
          <>
            <AppText variant="caption" tone="textMuted">
              From your inventory: {item.name} ({item.quantity} owned)
            </AppText>
            <AppText variant="caption" tone="textMuted">
              Changes here only affect this trip.
            </AppText>
            <Button
              label="Open inventory item"
              icon="open-in-new"
              variant="ghost"
              size="sm"
              onPress={() => router.push({ pathname: '/inventory/item/[itemId]', params: { itemId: item.id } })}
              style={styles.left}
            />
          </>
        ) : (
          <AppText variant="caption" tone="textMuted">
            One-time item for this trip only — not part of your inventory.
          </AppText>
        )}
      </Card>

      <TextField
        label="Name on this list"
        value={draft.name}
        onChangeText={(name) => patch({ name })}
        error={nameError}
        maxLength={PACKING_LIMITS.nameMax}
        testID="entry-name-input"
      />
      <Stepper
        label="Quantity"
        description={packing.state?.confirmedAt && entry.inventoryItemId ? 'Reserved for this trip' : 'For this trip'}
        value={draft.quantity}
        min={1}
        max={PACKING_LIMITS.quantityMax}
        onChange={(quantity) => patch({ quantity })}
        testID="entry-quantity"
      />
      <ToggleRow icon="bag-checked" label="Packed" value={draft.isPacked} onChange={(isPacked) => patch({ isPacked })} testID="entry-packed" />

      <ChipRow label="Who is it for">
        <OptionTile layout="chip" label="Shared" icon="share-variant-outline" selected={draft.travellerId === null} onPress={() => patch({ travellerId: null })} />
        {trip.travellers.map((t) => (
          <OptionTile
            key={t.id}
            layout="chip"
            label={t.name}
            icon={t.kind === 'child' ? 'human-child' : 'account'}
            selected={draft.travellerId === t.id}
            onPress={() => patch({ travellerId: t.id })}
            testID={`entry-traveller-${t.name}`}
          />
        ))}
      </ChipRow>

      <ChipRow label="Bag">
        <OptionTile layout="chip" label="No bag" icon="minus-circle-outline" selected={draft.luggageId === null} onPress={() => patch({ luggageId: null })} />
        {packing.luggage.map((bag) => (
          <OptionTile
            key={bag.id}
            layout="chip"
            label={bag.name}
            icon={LUGGAGE_META[bag.kind].icon}
            selected={draft.luggageId === bag.id}
            onPress={() => patch({ luggageId: bag.id })}
            testID={`entry-bag-${bag.name}`}
          />
        ))}
      </ChipRow>
      {packing.luggage.length === 0 ? (
        <AppText variant="caption" tone="textMuted">
          Add bags in the Bags tab to choose one here.
        </AppText>
      ) : null}

      <ChipRow label="Category on this list">
        <OptionTile layout="chip" label="None" icon="minus-circle-outline" selected={draft.categoryId === null} onPress={() => patch({ categoryId: null })} />
        {maps.topLevel.map((category) => (
          <OptionTile
            key={category.id}
            layout="chip"
            label={category.name}
            icon={category.icon}
            selected={draft.categoryId === category.id || maps.byId.get(draft.categoryId ?? '')?.parentId === category.id}
            onPress={() => patch({ categoryId: category.id })}
          />
        ))}
      </ChipRow>

      <TextField
        label="Notes (optional)"
        value={draft.notes}
        onChangeText={(notes) => patch({ notes })}
        maxLength={PACKING_LIMITS.notesMax}
        multiline
        testID="entry-notes-input"
      />

      {error ? <Notice tone="danger" title="Not saved" message={error} /> : null}

      <Button
        label="Remove from this trip"
        icon="minus-circle-outline"
        variant="danger"
        onPress={() => void remove()}
        disabled={saving}
        testID="entry-remove"
      />
    </Screen>
  );
}

export function EntryEditorScreen({ tripId, entryId }: { tripId: string | undefined; entryId: string | undefined }) {
  useEnsureInventoryLoaded();
  const { trip } = useTrip(tripId);
  const packing = useTripPacking(tripId);
  const entry = packing.entries.find((e) => e.id === entryId);
  useEffect(() => {
    if (tripId && packing.status === 'idle') void usePackingStore.getState().load(tripId);
  }, [tripId, packing.status]);

  if (trip && entry) return <Form key={entry.id} trip={trip} entry={entry} />;
  return (
    <Screen bottomInset>
      <ScreenHeader showBack backIcon="close" title="Packing entry" />
      {packing.status === 'ready' && trip ? (
        <EmptyState icon="file-question-outline" title="Entry not found" message="It may have been removed." />
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
  left: {
    alignSelf: 'flex-start',
  },
  group: {
    gap: spacing.sm,
  },
  chips: {
    gap: spacing.sm,
    paddingRight: spacing.lg,
  },
});
