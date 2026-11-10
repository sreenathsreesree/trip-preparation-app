import type { ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { colors, radii, spacing } from '@/theme';
import type { IconName } from '@/theme/icons';

import { AppText } from './AppText';
import { Button } from './Button';
import { Icon } from './Icon';

interface StateFrameProps {
  icon: IconName;
  iconTone?: 'accent' | 'info' | 'warning' | 'danger';
  title: string;
  message?: string;
  children?: ReactNode;
  testID?: string;
}

function StateFrame({ icon, iconTone = 'accent', title, message, children, testID }: StateFrameProps) {
  return (
    <View style={styles.frame} testID={testID}>
      <View style={[styles.badge, { borderColor: colors[iconTone] }]}>
        <Icon name={icon} size={28} tone={iconTone} />
      </View>
      <AppText variant="h3" align="center">
        {title}
      </AppText>
      {message ? (
        <AppText variant="body" tone="textSecondary" align="center" style={styles.message}>
          {message}
        </AppText>
      ) : null}
      {children ? <View style={styles.actions}>{children}</View> : null}
    </View>
  );
}

export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return (
    <View style={styles.frame} accessibilityRole="progressbar" accessibilityLabel={label}>
      <ActivityIndicator color={colors.accent} size="large" />
      <AppText variant="caption" tone="textMuted">
        {label}
      </AppText>
    </View>
  );
}

export interface EmptyStateProps {
  icon: IconName;
  title: string;
  message?: string;
  /** Optional real action; omit rather than showing a non-functional button. */
  action?: { label: string; onPress: () => void; icon?: IconName };
  testID?: string;
}

export function EmptyState({ icon, title, message, action, testID }: EmptyStateProps) {
  return (
    <StateFrame icon={icon} title={title} message={message} testID={testID}>
      {action ? <Button label={action.label} icon={action.icon} onPress={action.onPress} /> : null}
    </StateFrame>
  );
}

export interface ErrorStateProps {
  title?: string;
  message: string;
  onRetry?: () => void;
}

export function ErrorState({ title = 'Something went wrong', message, onRetry }: ErrorStateProps) {
  return (
    <StateFrame icon="alert-circle-outline" iconTone="danger" title={title} message={message}>
      {onRetry ? (
        <Button label="Try again" icon="refresh" variant="secondary" onPress={onRetry} />
      ) : null}
    </StateFrame>
  );
}

const styles = StyleSheet.create({
  frame: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    paddingVertical: spacing.huge,
    paddingHorizontal: spacing.xxl,
  },
  badge: {
    width: 64,
    height: 64,
    borderRadius: radii.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    marginBottom: spacing.xs,
  },
  message: {
    maxWidth: 360,
  },
  actions: {
    marginTop: spacing.md,
    alignItems: 'center',
    gap: spacing.sm,
  },
});
