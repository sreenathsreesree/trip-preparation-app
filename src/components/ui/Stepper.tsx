import { StyleSheet, View } from 'react-native';

import { colors, radii, spacing } from '@/theme';

import { AppText } from './AppText';
import { IconButton } from './IconButton';

export interface StepperProps {
  label: string;
  description?: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  testID?: string;
}

/** Numeric +/- control, e.g. for traveller counts. */
export function Stepper({ label, description, value, min, max, onChange, testID }: StepperProps) {
  return (
    <View
      style={styles.row}
      testID={testID}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{ min, max, now: value }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === 'increment' && value < max) onChange(value + 1);
        if (event.nativeEvent.actionName === 'decrement' && value > min) onChange(value - 1);
      }}
    >
      <View style={styles.text}>
        <AppText variant="bodyStrong">{label}</AppText>
        {description ? (
          <AppText variant="caption" tone="textMuted">
            {description}
          </AppText>
        ) : null}
      </View>
      <View style={styles.controls}>
        <IconButton
          icon="minus"
          accessibilityLabel={`Fewer ${label.toLowerCase()}`}
          disabled={value <= min}
          onPress={() => onChange(value - 1)}
          testID={testID ? `${testID}-decrement` : undefined}
        />
        <AppText variant="h3" style={styles.value} testID={testID ? `${testID}-value` : undefined}>
          {value}
        </AppText>
        <IconButton
          icon="plus"
          accessibilityLabel={`More ${label.toLowerCase()}`}
          disabled={value >= max}
          onPress={() => onChange(value + 1)}
          testID={testID ? `${testID}-increment` : undefined}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  text: {
    flex: 1,
    gap: spacing.xxs,
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  value: {
    minWidth: 28,
    textAlign: 'center',
  },
});
