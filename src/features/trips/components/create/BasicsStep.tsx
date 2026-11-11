import { StyleSheet, View } from 'react-native';

import { AppText, OptionTile, TextField } from '@/components/ui';
import { spacing } from '@/theme';

import { TRIP_CATEGORIES, TRIP_CATEGORY_META } from '../../model';
import { useTripDraftStore } from '../../tripDraftStore';
import { TRIP_LIMITS, type TripDraftErrors } from '../../validation';
import { DestinationsPlannerLink } from './DestinationsPlannerLink';

export function BasicsStep({ errors }: { errors: TripDraftErrors }) {
  const name = useTripDraftStore((state) => state.draft.name);
  const category = useTripDraftStore((state) => state.draft.category);
  const { update, reveal } = useTripDraftStore.getState();

  return (
    <View style={styles.container}>
      <TextField
        label="Trip name"
        placeholder="e.g. Diwali at Nani's"
        icon="flag-variant-outline"
        value={name}
        onChangeText={(value) => update({ name: value })}
        onBlur={() => reveal(['name'])}
        error={errors.name}
        maxLength={TRIP_LIMITS.nameMax}
        showCount
        autoCapitalize="words"
        returnKeyType="next"
        testID="trip-name-input"
      />

      <DestinationsPlannerLink />

      <View style={styles.group}>
        <AppText variant="label" tone="textSecondary">
          Trip category
        </AppText>
        <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel="Trip category">
          {TRIP_CATEGORIES.map((option) => (
            <OptionTile
              key={option}
              layout="chip"
              label={TRIP_CATEGORY_META[option].label}
              icon={TRIP_CATEGORY_META[option].icon}
              selected={category === option}
              onPress={() => update({ category: option })}
              testID={`category-${option}`}
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
