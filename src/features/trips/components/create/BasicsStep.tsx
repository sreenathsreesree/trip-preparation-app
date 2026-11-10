import { StyleSheet, View } from 'react-native';

import { AppText, OptionTile, TextField } from '@/components/ui';
import { spacing } from '@/theme';

import { TRIP_CATEGORIES, TRIP_CATEGORY_META } from '../../model';
import { useTripDraftStore } from '../../tripDraftStore';
import { TRIP_LIMITS, type TripDraftErrors } from '../../validation';

export function BasicsStep({ errors }: { errors: TripDraftErrors }) {
  const draft = useTripDraftStore((state) => state.draft);
  const update = useTripDraftStore((state) => state.update);
  const reveal = useTripDraftStore((state) => state.reveal);

  return (
    <View style={styles.container}>
      <TextField
        label="Trip name"
        placeholder="e.g. Diwali at Nani's"
        icon="flag-variant-outline"
        value={draft.name}
        onChangeText={(name) => update({ name })}
        onBlur={() => reveal(['name'])}
        error={errors.name}
        maxLength={TRIP_LIMITS.nameMax}
        showCount
        autoCapitalize="words"
        returnKeyType="next"
        testID="trip-name-input"
      />
      <TextField
        label="Destination"
        placeholder="City, region or route — e.g. Manali"
        icon="map-marker-outline"
        value={draft.destination}
        onChangeText={(destination) => update({ destination })}
        onBlur={() => reveal(['destination'])}
        error={errors.destination}
        maxLength={TRIP_LIMITS.destinationMax}
        autoCapitalize="words"
        returnKeyType="done"
        testID="trip-destination-input"
      />

      <View style={styles.group}>
        <AppText variant="label" tone="textSecondary">
          Trip category
        </AppText>
        <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel="Trip category">
          {TRIP_CATEGORIES.map((category) => (
            <OptionTile
              key={category}
              layout="chip"
              label={TRIP_CATEGORY_META[category].label}
              icon={TRIP_CATEGORY_META[category].icon}
              selected={draft.category === category}
              onPress={() => update({ category })}
              testID={`category-${category}`}
            />
          ))}
        </View>
        {errors.category ? (
          <AppText variant="caption" tone="danger" accessibilityLiveRegion="polite">
            {errors.category}
          </AppText>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.xl,
  },
  group: {
    gap: spacing.sm,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
});
