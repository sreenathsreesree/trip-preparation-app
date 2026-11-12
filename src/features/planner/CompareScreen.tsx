import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Screen } from '@/components/layout/Screen';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { AppText, Card, EmptyState, Icon, LoadingState, OptionTile } from '@/components/ui';
import { colors, radii, spacing } from '@/theme';

import { useTrip } from '../trips/hooks';
import { COMPARE_MAX, compareRows, filterPlaces, profileFor, tagsInUse, trailOf, type PlaceFilter } from './compare';
import { usePlannerStore, useTripPlan } from './plannerStore';

/** Saved-for-later places, tag filters, and a side-by-side comparison of up to three places. */
export function CompareScreen({ tripId }: { tripId: string | undefined }) {
  const { trip } = useTrip(tripId);
  const state = useTripPlan(tripId);
  const [filter, setFilter] = useState<PlaceFilter>({ kind: 'all' });
  const [picked, setPicked] = useState<string[]>([]);
  useFocusEffect(
    useCallback(() => {
      if (tripId) void usePlannerStore.getState().load(tripId);
    }, [tripId]),
  );

  const plan = state.plan;
  const companion = state.companion;
  if (!trip || !plan || !companion) {
    return (
      <Screen bottomInset>
        <ScreenHeader showBack title="Saved and compare" />
        <LoadingState label="Loading…" />
      </Screen>
    );
  }

  const profiles = companion.profiles;
  const places = filterPlaces(plan, profiles, filter);
  const savedCount = filterPlaces(plan, profiles, { kind: 'saved' }).length;
  const tags = tagsInUse(profiles);
  const chosen = picked.map((id) => plan.nodes.find((n) => n.id === id)).filter((n): n is NonNullable<typeof n> => !!n);
  const rows = chosen.length >= 2 ? compareRows(plan, profiles, companion.taskCounts, chosen) : [];
  const toggle = (id: string) =>
    setPicked((current) => (current.includes(id) ? current.filter((x) => x !== id) : current.length >= COMPARE_MAX ? current : [...current, id]));
  const isFilter = (f: PlaceFilter) => f.kind === filter.kind && (f.kind !== 'tag' || (filter.kind === 'tag' && filter.tag === f.tag));

  return (
    <Screen testID="plan-compare" bottomInset>
      <ScreenHeader showBack eyebrow={trip.name} title="Saved and compare" subtitle={`${savedCount} saved for later`} />

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        <OptionTile layout="chip" label="All places" icon="map-marker-multiple-outline" selected={isFilter({ kind: 'all' })} onPress={() => setFilter({ kind: 'all' })} testID="compare-filter-all" />
        <OptionTile layout="chip" label={`Saved (${savedCount})`} icon="heart-outline" selected={isFilter({ kind: 'saved' })} onPress={() => setFilter({ kind: 'saved' })} testID="compare-filter-saved" />
        {tags.map((tag) => (
          <OptionTile key={tag} layout="chip" label={tag} icon="tag-outline" selected={isFilter({ kind: 'tag', tag })} onPress={() => setFilter({ kind: 'tag', tag })} testID={`compare-filter-tag-${tag}`} />
        ))}
      </ScrollView>

      <AppText variant="caption" tone="textMuted">
        Tick up to {COMPARE_MAX} places to compare them side by side.
      </AppText>

      {places.length === 0 ? (
        <EmptyState
          icon={filter.kind === 'saved' ? 'heart-outline' : 'map-marker-question-outline'}
          title={filter.kind === 'saved' ? 'Nothing saved yet' : 'No places here'}
          message={filter.kind === 'saved' ? 'Tap the heart on a destination page to save it for later.' : 'Try another filter.'}
          testID="compare-empty"
        />
      ) : (
        <Card padding="xs">
          {places.map((node) => {
            const selected = picked.includes(node.id);
            const profile = profileFor(profiles, node);
            const trail = trailOf(plan, node.id);
            const full = !selected && picked.length >= COMPARE_MAX;
            return (
              <View key={node.id} style={styles.row}>
                <Pressable
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: selected, disabled: full }}
                  accessibilityLabel={`Compare ${node.name}`}
                  disabled={full}
                  onPress={() => toggle(node.id)}
                  style={({ pressed }) => [styles.pick, pressed && styles.pressed, full && styles.disabled]}
                  testID={`compare-pick-${node.name}`}
                >
                  <Icon name={selected ? 'checkbox-marked' : 'checkbox-blank-outline'} size={22} color={selected ? colors.accent : colors.textMuted} />
                  <View style={styles.flex}>
                    <AppText variant="bodyStrong" numberOfLines={1}>
                      {node.name}
                    </AppText>
                    {trail ? (
                      <AppText variant="caption" tone="textMuted" numberOfLines={1}>
                        {trail}
                      </AppText>
                    ) : null}
                  </View>
                  {profile.saved ? <Icon name="heart" size={16} color={colors.danger} /> : null}
                  {profile.visitStatus === 'visited' ? <Icon name="check-circle" size={16} color={colors.accent} /> : null}
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${node.name}`}
                  onPress={() => router.push({ pathname: '/trips/[tripId]/plan/place/[nodeId]', params: { tripId: trip.id, nodeId: node.id } })}
                  style={({ pressed }) => [styles.open, pressed && styles.pressed]}
                  testID={`compare-open-${node.name}`}
                >
                  <Icon name="chevron-right" size={22} color={colors.textMuted} />
                </Pressable>
              </View>
            );
          })}
        </Card>
      )}

      {rows.length > 0 ? (
        <View style={styles.table} testID="compare-table">
          <View style={styles.tableRow}>
            <View style={styles.labelCell} />
            {chosen.map((node) => (
              <AppText key={node.id} variant="captionStrong" style={styles.cell} numberOfLines={2}>
                {node.name}
              </AppText>
            ))}
          </View>
          {rows.map((row) => (
            <View key={row.key} style={styles.tableRow} testID={`compare-row-${row.key}`}>
              <AppText variant="caption" tone="textMuted" style={styles.labelCell}>
                {row.label}
              </AppText>
              {row.values.map((value, i) => (
                <AppText key={i} variant="caption" tone={value === '—' ? 'textMuted' : 'textPrimary'} style={styles.cell}>
                  {value}
                </AppText>
              ))}
            </View>
          ))}
          <AppText variant="caption" tone="textMuted" style={styles.footnote}>
            Only what you’ve added is compared. “—” means not filled in yet.
          </AppText>
        </View>
      ) : picked.length === 1 ? (
        <AppText variant="caption" tone="textMuted">
          Tick one more place to compare.
        </AppText>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  chips: {
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  pick: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 52,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.sm,
  },
  open: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.sm,
  },
  pressed: {
    backgroundColor: colors.surfacePressed,
  },
  disabled: {
    opacity: 0.45,
  },
  flex: {
    flex: 1,
  },
  table: {
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  tableRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  labelCell: {
    width: 76,
  },
  cell: {
    flex: 1,
  },
  footnote: {
    padding: spacing.md,
  },
});
