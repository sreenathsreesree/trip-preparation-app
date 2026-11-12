import type { ReactNode, Ref } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  ScrollView,
  type ScrollViewInstance,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, sizes, spacing } from '@/theme';

export interface ScreenProps {
  children: ReactNode;
  /** Scrollable body (default) or a fixed, flex layout. */
  scroll?: boolean;
  /** Pinned content below the scroll area (e.g. primary actions). */
  footer?: ReactNode;
  /** Respect the bottom safe area; off for tab screens (the tab bar handles it). */
  bottomInset?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
  onRefresh?: () => void;
  refreshing?: boolean;
  testID?: string;
  /** Access to the scroll view (e.g. auto-scrolling while dragging). */
  scrollRef?: Ref<ScrollViewInstance>;
  onScroll?: (offsetY: number) => void;
  /** Turn scrolling off temporarily (e.g. while a row is being dragged). */
  scrollEnabled?: boolean;
}

/** Standard screen frame: safe areas, background, content width and keyboard handling. */
export function Screen({
  children,
  scroll = true,
  footer,
  bottomInset = false,
  contentStyle,
  onRefresh,
  refreshing = false,
  scrollRef,
  onScroll,
  scrollEnabled = true,
  testID,
}: ScreenProps) {
  const insets = useSafeAreaInsets();
  const bottomPadding = bottomInset && !footer ? insets.bottom : 0;

  const body = scroll ? (
    <ScrollView
      ref={scrollRef}
      scrollEnabled={scrollEnabled}
      onScroll={onScroll ? (event) => onScroll(event.nativeEvent.contentOffset.y) : undefined}
      scrollEventThrottle={onScroll ? 16 : undefined}
      style={styles.flex}
      contentContainerStyle={[styles.content, { paddingBottom: spacing.huge + bottomPadding }, contentStyle]}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      refreshControl={
        onRefresh ? (
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.accent}
            colors={[colors.accent]}
            progressBackgroundColor={colors.surface}
          />
        ) : undefined
      }
    >
      <View style={styles.column}>{children}</View>
    </ScrollView>
  ) : (
    <View style={[styles.flex, styles.content, { paddingBottom: bottomPadding }, contentStyle]}>
      <View style={[styles.column, styles.flex]}>{children}</View>
    </View>
  );

  return (
    <KeyboardAvoidingView
      testID={testID}
      style={[styles.root, { paddingTop: insets.top }]}
      // Android is always edge-to-edge (SDK 54+), so the window no longer resizes for
      // the keyboard; padding keeps pinned footers and inputs above it on both platforms.
      behavior={Platform.OS === 'web' ? undefined : 'padding'}
    >
      {body}
      {footer ? (
        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}>
          <View style={styles.column}>{footer}</View>
        </View>
      ) : null}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  flex: {
    flex: 1,
  },
  content: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
  },
  column: {
    width: '100%',
    maxWidth: sizes.maxContentWidth,
    alignSelf: 'center',
    gap: spacing.xxl,
  },
  footer: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.backgroundElevated,
  },
});
