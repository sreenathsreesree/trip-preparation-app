import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Screen } from '@/components/layout/Screen';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { AppText, Button, Card, EmptyState, ErrorState, Icon, LoadingState, Notice, OptionTile, ProgressBar, SegmentedControl, TextField } from '@/components/ui';
import { toErrorMessage } from '@/lib/errors';
import { colors, radii, spacing } from '@/theme';

import { LUGGAGE_KINDS, LUGGAGE_META, type LuggageKind } from '../packing/model';
import { usePackingStore, useTripPacking } from '../packing/packingStore';
import { useTrip } from '../trips/hooks';
import { useClothingStore, useTripClothing } from './clothingStore';
import { CATEGORY_ICONS, summarise } from './model';

type View_ = 'grid' | 'list';

/**
 * The trip's Clothing & Luggage organizer: clothing categories as a grid (or
 * list), an overall packing summary, and every bag with its progress. Personal
 * — never part of a shared trip.
 */
export function ClothingScreen({ tripId }: { tripId: string | undefined }) {
  const { trip } = useTrip(tripId);
  const clothing = useTripClothing(tripId);
  const packing = useTripPacking(tripId);
  const [view, setView] = useState<View_>('grid');
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [icon, setIcon] = useState(CATEGORY_ICONS[0]!);
  const [bagKind, setBagKind] = useState<LuggageKind | null>(null);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (tripId) void useClothingStore.getState().load(tripId);
    }, [tripId]),
  );

  if (!tripId || !trip) {
    return (
      <Screen bottomInset>
        <ScreenHeader showBack title="Clothing" />
        <LoadingState label="Loading…" />
      </Screen>
    );
  }
  const summary = summarise(packing.entries, clothing.links, clothing.categories, packing.luggage);
  const run = (fn: () => Promise<unknown>, fallback: string) => {
    setError(null);
    return fn().catch((err: unknown) => {
      setError(toErrorMessage(err, fallback));
      throw err;
    });
  };
  const open = (categoryId: string) => router.push({ pathname: '/trips/[tripId]/clothing/[categoryId]', params: { tripId, categoryId } });

  return (
    <Screen testID="clothing-screen" bottomInset onRefresh={() => void useClothingStore.getState().load(tripId)}>
      <ScreenHeader showBack eyebrow={trip.name} title="Clothing & luggage" />

      {clothing.status === 'error' ? (
        <ErrorState message={clothing.error ?? 'Could not load clothing.'} onRetry={() => void useClothingStore.getState().load(tripId)} />
      ) : clothing.status !== 'ready' ? (
        <LoadingState label="Loading clothing…" />
      ) : (
        <>
          <Card testID="clothing-summary">
            <View style={styles.group}>
              <View style={styles.row}>
                <AppText variant="metric">{summary.total.units ? Math.round((summary.total.packed / summary.total.units) * 100) : 0}%</AppText>
                <AppText variant="label" tone="textMuted" style={styles.flex}>
                  Clothing packed
                </AppText>
              </View>
              <ProgressBar value={summary.total.units ? summary.total.packed / summary.total.units : 0} height={6} />
              <AppText variant="caption" tone="textMuted" testID="clothing-summary-text">
                {summary.total.units === 0 ? 'No clothing added yet — open a category to add items.' : `${summary.total.packed} of ${summary.total.units} pieces packed`}
                {summary.uncategorised ? ` · ${summary.uncategorised} without a category` : ''}
              </AppText>
            </View>
          </Card>

          <View style={styles.headRow}>
            <AppText variant="title" style={styles.flex}>
              Categories
            </AppText>
            <SegmentedControl<View_>
              accessibilityLabel="Show categories as"
              value={view}
              onChange={setView}
              options={[
                { value: 'grid', label: 'Grid' },
                { value: 'list', label: 'List' },
              ]}
            />
          </View>

          {clothing.categories.length === 0 ? (
            <EmptyState icon="hanger" title="No categories" message="Add a category such as T-shirts or Footwear." />
          ) : (
            <View style={view === 'grid' ? styles.grid : styles.list} testID="clothing-categories">
              {clothing.categories.map((c) => {
                const p = summary.byCategory[c.id] ?? { items: 0, units: 0, packed: 0 };
                return (
                  <Pressable
                    key={c.id}
                    accessibilityRole="button"
                    accessibilityLabel={`${c.name}, ${p.items} items, ${p.packed} of ${p.units} packed`}
                    onPress={() => open(c.id)}
                    style={({ pressed }) => [view === 'grid' ? styles.tile : styles.listRow, pressed && styles.pressed]}
                    testID={`clothing-category-${c.name}`}
                  >
                    <View style={styles.tileIcon}>
                      <Icon name={c.icon} size={view === 'grid' ? 28 : 22} tone="accent" />
                    </View>
                    <View style={view === 'grid' ? styles.tileText : styles.flex}>
                      <AppText variant="bodyStrong" numberOfLines={1}>
                        {c.name}
                      </AppText>
                      <AppText variant="caption" tone="textMuted" numberOfLines={1}>
                        {p.items === 0 ? 'Empty' : `${p.packed}/${p.units} packed`}
                      </AppText>
                    </View>
                    {view === 'list' ? <Icon name="chevron-right" tone="textMuted" /> : null}
                  </Pressable>
                );
              })}
            </View>
          )}

          {adding ? (
            <Card testID="clothing-add-category">
              <View style={styles.group}>
                <TextField label="Category name" placeholder="e.g. Swimwear" value={name} onChangeText={setName} maxLength={40} testID="clothing-category-name" />
                <View style={styles.chips}>
                  {CATEGORY_ICONS.map((i) => (
                    <OptionTile key={i} layout="chip" role="radio" label={i.replace(/-outline$/, "").replace(/-/g, " ")} icon={i} selected={icon === i} onPress={() => setIcon(i)} />
                  ))}
                </View>
                <View style={styles.row}>
                  <Button
                    label="Add category"
                    icon="plus"
                    size="sm"
                    onPress={() =>
                      void run(() => useClothingStore.getState().addCategory(tripId, name, icon), 'Could not add the category.').then(() => {
                        setAdding(false);
                        setName('');
                      }, () => undefined)
                    }
                    testID="clothing-category-save"
                  />
                  <Button label="Cancel" variant="ghost" size="sm" onPress={() => setAdding(false)} />
                </View>
              </View>
            </Card>
          ) : (
            <Button label="Add category" icon="plus" variant="secondary" size="sm" onPress={() => setAdding(true)} style={styles.left} testID="clothing-category-add" />
          )}

          <View style={styles.headRow}>
            <AppText variant="title" style={styles.flex}>
              Bags
            </AppText>
          </View>
          {summary.byBag.length === 0 ? (
            <AppText variant="caption" tone="textMuted">
              No bags yet. Create one to see what goes where.
            </AppText>
          ) : (
            <View style={styles.list} testID="clothing-bags">
              {summary.byBag.map((b) => (
                <Pressable
                  key={b.id ?? 'none'}
                  accessibilityRole={b.id ? 'button' : undefined}
                  disabled={!b.id}
                  onPress={() => b.id && router.push({ pathname: '/trips/[tripId]/packing/bag/[bagId]', params: { tripId, bagId: b.id } })}
                  style={({ pressed }) => [styles.bag, pressed && styles.pressed]}
                  testID={`clothing-bag-${b.name}`}
                >
                  <Icon name={b.id ? 'bag-suitcase-outline' : 'tray-full'} tone={b.id ? 'accent' : 'textMuted'} />
                  <View style={styles.flex}>
                    <AppText variant="bodyStrong" numberOfLines={1}>
                      {b.name}
                    </AppText>
                    <AppText variant="caption" tone="textMuted">
                      {b.items} {b.items === 1 ? 'item' : 'items'} · {b.progress.packed}/{b.progress.units} packed
                    </AppText>
                    <ProgressBar value={b.progress.units ? b.progress.packed / b.progress.units : 0} height={4} />
                  </View>
                  {b.id ? <Icon name="chevron-right" tone="textMuted" /> : null}
                </Pressable>
              ))}
            </View>
          )}
          {bagKind === null ? (
            <Button label="Create a bag" icon="bag-suitcase-outline" variant="secondary" size="sm" onPress={() => setBagKind('suitcase')} style={styles.left} testID="clothing-bag-add" />
          ) : (
            <Card>
              <View style={styles.group}>
                <AppText variant="label" tone="textSecondary">
                  New bag
                </AppText>
                <View style={styles.chips}>
                  {LUGGAGE_KINDS.map((k) => (
                    <OptionTile key={k} layout="chip" role="radio" label={LUGGAGE_META[k].label} icon={LUGGAGE_META[k].icon} selected={bagKind === k} onPress={() => setBagKind(k)} testID={`clothing-bag-kind-${k}`} />
                  ))}
                </View>
                <View style={styles.row}>
                  <Button
                    label="Create"
                    size="sm"
                    onPress={() => void run(() => usePackingStore.getState().addLuggage(tripId, bagKind), 'Could not create the bag.').then(() => setBagKind(null), () => undefined)}
                    testID="clothing-bag-create"
                  />
                  <Button label="Cancel" variant="ghost" size="sm" onPress={() => setBagKind(null)} />
                </View>
              </View>
            </Card>
          )}
          {error ? <Notice tone="danger" title={error} testID="clothing-error" /> : null}
          <AppText variant="caption" tone="textMuted">
            Clothing is personal: it stays on your packing list and is never shown in a Group Trip. Items picked from your Inventory stay in your Inventory.
          </AppText>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  group: { gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  flex: { flex: 1, minWidth: 0 },
  left: { alignSelf: 'flex-start' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  list: { gap: spacing.sm },
  tile: {
    width: '48%',
    flexGrow: 1,
    minHeight: 104,
    padding: spacing.md,
    gap: spacing.sm,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  tileText: { gap: spacing.xxs },
  tileIcon: {
    width: 44,
    height: 44,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentSoft,
  },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  bag: {
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
