import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { AppText, Button, Icon, IconButton } from '@/components/ui';
import { selectionFeedback } from '@/lib/haptics';
import { colors, fontFamilies, radii, sizes, spacing } from '@/theme';

import { describeTravellers, TRAVELLER_KIND_META } from '../../model';
import { useTripDraftStore } from '../../tripDraftStore';
import { TRIP_LIMITS, type TripDraftErrors } from '../../validation';

function RowInput({
  value,
  onChangeText,
  placeholder,
  accessibilityLabel,
  invalid,
  maxLength,
  testID,
}: {
  value: string;
  onChangeText: (text: string) => void;
  placeholder: string;
  accessibilityLabel: string;
  invalid: boolean;
  maxLength: number;
  testID: string;
}) {
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={colors.textMuted}
      selectionColor={colors.accent}
      cursorColor={colors.accent}
      accessibilityLabel={accessibilityLabel}
      aria-invalid={invalid}
      maxLength={maxLength}
      autoCapitalize="words"
      style={[styles.input, invalid && styles.inputInvalid]}
      testID={testID}
    />
  );
}

/** Named travellers with an adult/child type: add, rename, switch type and remove. */
export function TravellersEditor({ errors }: { errors: TripDraftErrors }) {
  const travellers = useTripDraftStore((state) => state.draft.travellers);
  const { addTraveller, updateTraveller, removeTraveller } = useTripDraftStore.getState();

  return (
    <View style={styles.group}>
      <View style={styles.header}>
        <AppText variant="label" tone="textSecondary">
          Travellers
        </AppText>
        <AppText variant="caption" tone="textMuted">
          {describeTravellers(travellers)}
        </AppText>
      </View>
      {travellers.map((traveller, index) => {
        const error = errors.travellerItems?.[traveller.key];
        const kind = TRAVELLER_KIND_META[traveller.kind];
        const other = traveller.kind === 'adult' ? 'child' : 'adult';
        return (
          <View key={traveller.key} style={styles.item}>
            <View style={styles.row}>
              <RowInput
                value={traveller.name}
                onChangeText={(name) => updateTraveller(traveller.key, { name })}
                placeholder="Name"
                accessibilityLabel={`Traveller ${index + 1} name`}
                invalid={Boolean(error)}
                maxLength={TRIP_LIMITS.travellerNameMax}
                testID={`traveller-name-${index}`}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${traveller.name || `Traveller ${index + 1}`} is ${kind.label.toLowerCase()}. Change to ${TRAVELLER_KIND_META[other].label.toLowerCase()}`}
                onPress={() => {
                  selectionFeedback();
                  updateTraveller(traveller.key, { kind: other });
                }}
                style={({ pressed }) => [styles.kindChip, pressed && styles.kindChipPressed]}
                testID={`traveller-kind-${index}`}
              >
                <Icon name={kind.icon} size={16} tone={traveller.kind === 'child' ? 'warning' : 'info'} />
                <AppText variant="captionStrong" tone="textSecondary">
                  {kind.label}
                </AppText>
              </Pressable>
              {travellers.length > 1 ? (
                <IconButton
                  icon="close"
                  variant="plain"
                  size="sm"
                  tone="textMuted"
                  accessibilityLabel={`Remove ${traveller.name || `traveller ${index + 1}`}`}
                  onPress={() => removeTraveller(traveller.key)}
                  testID={`traveller-remove-${index}`}
                />
              ) : null}
            </View>
            {error ? (
              <AppText variant="caption" tone="danger" accessibilityLiveRegion="polite">
                {error}
              </AppText>
            ) : null}
          </View>
        );
      })}
      {errors.travellers && !errors.travellerItems ? (
        <AppText variant="caption" tone="danger">
          {errors.travellers}
        </AppText>
      ) : null}
      <AppText variant="caption" tone="textMuted">
        Tap Adult/Child to switch. Children are under 12.
      </AppText>
      <Button
        label="Add traveller"
        icon="account-plus-outline"
        variant="ghost"
        size="sm"
        disabled={travellers.length >= TRIP_LIMITS.travellersMax}
        onPress={addTraveller}
        style={styles.addButton}
        testID="traveller-add"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  group: {
    gap: spacing.sm,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.md,
  },
  item: {
    gap: spacing.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  stopBadge: {
    width: 28,
    height: 28,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.accentBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  input: {
    flex: 1,
    minWidth: 0,
    minHeight: sizes.buttonHeightSmall + 4,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    color: colors.textPrimary,
    fontFamily: fontFamilies.body,
    fontSize: 16,
  },
  inputInvalid: {
    borderColor: colors.danger,
  },
  kindChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: sizes.buttonHeightSmall + 4,
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  kindChipPressed: {
    backgroundColor: colors.surfacePressed,
  },
  addButton: {
    alignSelf: 'flex-start',
  },
});
