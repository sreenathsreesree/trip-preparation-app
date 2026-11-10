import { StyleSheet, View } from 'react-native';

import { colors, radii, spacing } from '@/theme';

import { AppText } from './AppText';
import { IconButton } from './IconButton';

export interface MiniStepperProps {
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  /** Used in accessibility labels, e.g. "T-shirts". */
  label: string;
  disabled?: boolean;
  testID?: string;
}

/** Compact quantity control for list rows. */
export function MiniStepper({ value, min, max, onChange, label, disabled = false, testID }: MiniStepperProps) {
  return (
    <View
      style={styles.row}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={`${label} quantity`}
      accessibilityValue={{ min, max, now: value }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(event) => {
        if (disabled) return;
        if (event.nativeEvent.actionName === 'increment' && value < max) onChange(value + 1);
        if (event.nativeEvent.actionName === 'decrement' && value > min) onChange(value - 1);
      }}
    >
      <IconButton
        icon="minus"
        variant="plain"
        size="sm"
        accessibilityLabel={`Fewer ${label}`}
        disabled={disabled || value <= min}
        onPress={() => onChange(value - 1)}
        testID={testID ? `${testID}-minus` : undefined}
      />
      <AppText variant="captionStrong" style={styles.value} testID={testID ? `${testID}-value` : undefined}>
        {value}
      </AppText>
      <IconButton
        icon="plus"
        variant="plain"
        size="sm"
        accessibilityLabel={`More ${label}`}
        disabled={disabled || value >= max}
        onPress={() => onChange(value + 1)}
        testID={testID ? `${testID}-plus` : undefined}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.xxs,
  },
  value: {
    minWidth: 22,
    textAlign: 'center',
  },
});
