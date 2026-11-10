import { Platform, StyleSheet, Switch, View } from 'react-native';

import { colors, radii, spacing } from '@/theme';
import type { IconName } from '@/theme/icons';

import { AppText } from './AppText';
import { Icon } from './Icon';

export interface ToggleRowProps {
  label: string;
  description?: string;
  icon?: IconName;
  value: boolean;
  onChange: (value: boolean) => void;
  testID?: string;
}

export function ToggleRow({ label, description, icon, value, onChange, testID }: ToggleRowProps) {
  return (
    <View style={styles.row}>
      {icon ? <Icon name={icon} tone={value ? 'accent' : 'textMuted'} /> : null}
      <View style={styles.text}>
        <AppText variant="bodyStrong">{label}</AppText>
        {description ? (
          <AppText variant="caption" tone="textMuted">
            {description}
          </AppText>
        ) : null}
      </View>
      <Switch
        testID={testID}
        accessibilityLabel={label}
        value={value}
        onValueChange={onChange}
        trackColor={{ false: colors.surfacePressed, true: colors.accentBorder }}
        thumbColor={value ? colors.accent : colors.textSecondary}
        ios_backgroundColor={colors.surfacePressed}
        // react-native-web ignores thumbColor and uses its own prop for the "on" thumb.
        {...(Platform.OS === 'web' ? ({ activeThumbColor: colors.accent } as object) : null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
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
});
