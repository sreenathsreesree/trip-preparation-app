import { StyleSheet, View } from 'react-native';

import { colors, radii, spacing, withAlpha } from '@/theme';
import type { IconName } from '@/theme/icons';

import { AppText } from './AppText';
import { Button } from './Button';
import { Icon } from './Icon';

type Tone = 'info' | 'warning' | 'danger' | 'success';

const TONES: Record<Tone, { color: string; icon: IconName }> = {
  info: { color: colors.info, icon: 'information-outline' },
  warning: { color: colors.warning, icon: 'alert-outline' },
  danger: { color: colors.danger, icon: 'alert-circle-outline' },
  success: { color: colors.accent, icon: 'check-circle-outline' },
};

export interface NoticeProps {
  tone?: Tone;
  title: string;
  message?: string;
  icon?: IconName;
  /** Optional real action; omit rather than showing a non-functional button. */
  action?: { label: string; onPress: () => void; icon?: IconName; loading?: boolean };
  testID?: string;
}

/** Inline status message (errors, results, suggestions). */
export function Notice({ tone = 'info', title, message, icon, action, testID }: NoticeProps) {
  const { color, icon: defaultIcon } = TONES[tone];
  return (
    <View
      testID={testID}
      accessibilityRole={tone === 'danger' ? 'alert' : undefined}
      accessibilityLiveRegion="polite"
      style={[styles.box, { borderColor: withAlpha(color, 0.5), backgroundColor: withAlpha(color, 0.1) }]}
    >
      <View style={styles.row}>
        <Icon name={icon ?? defaultIcon} color={color} />
        <View style={styles.text}>
          <AppText variant="bodyStrong" style={{ color }}>
            {title}
          </AppText>
          {message ? (
            <AppText variant="caption" tone="textSecondary">
              {message}
            </AppText>
          ) : null}
        </View>
      </View>
      {action ? (
        <Button
          label={action.label}
          icon={action.icon}
          size="sm"
          variant="secondary"
          loading={action.loading}
          onPress={action.onPress}
          style={styles.action}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  text: {
    flex: 1,
    gap: spacing.xxs,
  },
  action: {
    alignSelf: 'flex-start',
  },
});
