import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { IconButton } from '@/components/ui/IconButton';
import { spacing } from '@/theme';

export interface ScreenHeaderProps {
  title: string;
  eyebrow?: string;
  subtitle?: string;
  /** Shows a back control; falls back to Home when there is no history (e.g. deep links). */
  showBack?: boolean;
  backIcon?: 'arrow-left' | 'close';
  trailing?: ReactNode;
}

export function goBackOrHome() {
  if (router.canGoBack()) {
    router.back();
  } else {
    router.replace('/');
  }
}

export function ScreenHeader({
  title,
  eyebrow,
  subtitle,
  showBack = false,
  backIcon = 'arrow-left',
  trailing,
}: ScreenHeaderProps) {
  return (
    <View style={styles.container}>
      {showBack || trailing ? (
        <View style={styles.toolbar}>
          {showBack ? (
            <IconButton
              icon={backIcon}
              accessibilityLabel={backIcon === 'close' ? 'Close' : 'Go back'}
              onPress={goBackOrHome}
              testID="header-back"
            />
          ) : (
            <View />
          )}
          {trailing}
        </View>
      ) : null}
      <View style={styles.titles}>
        {eyebrow ? (
          <AppText variant="label" tone="accent">
            {eyebrow}
          </AppText>
        ) : null}
        <AppText variant="h1" accessibilityRole="header">
          {title}
        </AppText>
        {subtitle ? (
          <AppText variant="body" tone="textSecondary">
            {subtitle}
          </AppText>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.lg,
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  titles: {
    gap: spacing.xs,
  },
});
