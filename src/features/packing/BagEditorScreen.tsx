import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Screen } from '@/components/layout/Screen';
import { goBackOrHome, ScreenHeader } from '@/components/layout/ScreenHeader';
import {
  AppText,
  Button,
  EmptyState,
  Icon,
  LoadingState,
  Notice,
  OptionTile,
  TextField,
} from '@/components/ui';
import { confirmAction } from '@/lib/confirm';
import { toErrorMessage } from '@/lib/errors';
import { successFeedback } from '@/lib/haptics';
import { colors, radii, spacing } from '@/theme';

import { useTrip } from '../trips/hooks';
import type { TripSummary } from '../trips/model';
import { LUGGAGE_META, PACKING_LIMITS, type Luggage } from './model';
import { usePackingStore, useTripPacking } from './packingStore';

function Form({ trip, bag }: { trip: TripSummary; bag: Luggage }) {
  const packing = useTripPacking(trip.id);
  const [name, setName] = useState(bag.name);
  const [travellerId, setTravellerId] = useState<string | null>(bag.travellerId);
  const [contents, setContents] = useState<Set<string>>(
    () => new Set(packing.entries.filter((e) => e.luggageId === bag.id).map((e) => e.id)),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bagNames = new Map(packing.luggage.map((b) => [b.id, b.name]));
  const nameError = name.trim() ? undefined : 'Give the bag a name.';

  const toggle = (entryId: string) =>
    setContents((current) => {
      const next = new Set(current);
      if (next.has(entryId)) next.delete(entryId);
      else next.add(entryId);
      return next;
    });

  async function save() {
    if (nameError) return;
    setSaving(true);
    setError(null);
    try {
      await usePackingStore.getState().saveBag(trip.id, bag.id, { name, travellerId }, [...contents]);
      successFeedback();
      goBackOrHome();
    } catch (err) {
      setError(toErrorMessage(err, 'Could not save the bag.'));
      setSaving(false);
    }
  }

  async function remove() {
    const ok = await confirmAction({
      title: `Delete "${bag.name}"?`,
      message: 'Everything in it stays on the packing list, just without a bag.',
      confirmLabel: 'Delete bag',
      destructive: true,
    });
    if (!ok) return;
    setSaving(true);
    try {
      await usePackingStore.getState().removeLuggage(trip.id, bag.id);
      goBackOrHome();
    } catch (err) {
      setError(toErrorMessage(err, 'Could not delete the bag.'));
      setSaving(false);
    }
  }

  return (
    <Screen
      testID="bag-editor"
      footer={
        <View style={styles.footer}>
          <Button label="Cancel" variant="secondary" onPress={goBackOrHome} disabled={saving} />
          <Button label="Save bag" icon="content-save-outline" onPress={() => void save()} loading={saving} style={styles.primary} testID="bag-save" />
        </View>
      }
    >
      <ScreenHeader showBack backIcon="close" eyebrow={`${trip.name} · ${LUGGAGE_META[bag.kind].label}`} title="Bag" />
      <TextField
        label="Name"
        value={name}
        onChangeText={setName}
        error={nameError}
        maxLength={PACKING_LIMITS.luggageNameMax}
        testID="bag-name-input"
      />
      {trip.travellers.length > 1 ? (
        <View style={styles.group}>
          <AppText variant="label" tone="textSecondary">
            Whose bag
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

      <View style={styles.group}>
        <AppText variant="label" tone="textSecondary">
          In this bag ({contents.size})
        </AppText>
        {packing.entries.length === 0 ? (
          <AppText variant="caption" tone="textMuted">
            The packing list is empty. Add items first, then put them in bags.
          </AppText>
        ) : (
          packing.entries.map((entry) => {
            const inBag = contents.has(entry.id);
            const elsewhere = entry.luggageId && entry.luggageId !== bag.id ? bagNames.get(entry.luggageId) : undefined;
            return (
              <Pressable
                key={entry.id}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: inBag }}
                accessibilityLabel={`${entry.name} in ${name || 'this bag'}`}
                onPress={() => toggle(entry.id)}
                style={({ pressed }) => [styles.row, inBag && styles.rowOn, pressed && styles.pressed]}
                testID={`bag-entry-${entry.name}`}
              >
                <Icon name={inBag ? 'checkbox-marked' : 'checkbox-blank-outline'} tone={inBag ? 'accent' : 'textMuted'} />
                <View style={styles.flex}>
                  <AppText variant="body" numberOfLines={1}>
                    {entry.name} <AppText variant="caption" tone="textMuted">×{entry.quantity}</AppText>
                  </AppText>
                  {elsewhere && !inBag ? (
                    <AppText variant="caption" tone="textMuted">
                      In {elsewhere}
                    </AppText>
                  ) : elsewhere && inBag ? (
                    <AppText variant="caption" tone="warning">
                      Moves out of {elsewhere}
                    </AppText>
                  ) : null}
                </View>
              </Pressable>
            );
          })
        )}
      </View>

      {error ? <Notice tone="danger" title="Not saved" message={error} /> : null}
      <Button label="Delete bag" icon="trash-can-outline" variant="danger" onPress={() => void remove()} disabled={saving} testID="bag-delete" />
    </Screen>
  );
}

export function BagEditorScreen({ tripId, bagId }: { tripId: string | undefined; bagId: string | undefined }) {
  const { trip } = useTrip(tripId);
  const packing = useTripPacking(tripId);
  const bag = packing.luggage.find((b) => b.id === bagId);
  useEffect(() => {
    if (tripId && packing.status === 'idle') void usePackingStore.getState().load(tripId);
  }, [tripId, packing.status]);

  if (trip && bag) return <Form key={bag.id} trip={trip} bag={bag} />;
  return (
    <Screen bottomInset>
      <ScreenHeader showBack backIcon="close" title="Bag" />
      {packing.status === 'ready' && trip ? (
        <EmptyState icon="bag-suitcase-off-outline" title="Bag not found" message="It may have been deleted." />
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
    paddingRight: spacing.lg,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 52,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  rowOn: {
    borderColor: colors.accentBorder,
  },
  pressed: {
    opacity: 0.8,
  },
  flex: {
    flex: 1,
    minWidth: 0,
  },
});
