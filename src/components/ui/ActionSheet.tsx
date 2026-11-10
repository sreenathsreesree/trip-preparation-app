import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { selectionFeedback } from '@/lib/haptics';
import { colors, radii, sizes, spacing } from '@/theme';
import type { IconName } from '@/theme/icons';

import { AppText } from './AppText';
import { Icon } from './Icon';

export interface SheetAction {
  key: string;
  label: string;
  icon: IconName;
  onPress: () => void;
  description?: string;
  destructive?: boolean;
  disabled?: boolean;
}

export interface ActionSheetProps {
  visible: boolean;
  title: string;
  subtitle?: string;
  actions: SheetAction[];
  onClose: () => void;
  testID?: string;
}

/** Bottom sheet of actions. Closes on backdrop tap, Android back, or after an action. */
export function ActionSheet({ visible, title, subtitle, actions, onClose, testID }: ActionSheetProps) {
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.root}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close menu"
        >
          <View style={styles.backdrop} />
        </Pressable>
        <View
          style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}
          testID={testID}
          accessibilityViewIsModal
        >
          <View style={styles.handle} />
          <View style={styles.header}>
            <AppText variant="title" numberOfLines={2}>
              {title}
            </AppText>
            {subtitle ? (
              <AppText variant="caption" tone="textMuted" numberOfLines={2}>
                {subtitle}
              </AppText>
            ) : null}
          </View>
          <ScrollView style={styles.list} bounces={false}>
            {actions.map((action) => (
              <Pressable
                key={action.key}
                testID={`sheet-action-${action.key}`}
                accessibilityRole="button"
                accessibilityLabel={action.label}
                accessibilityHint={action.description}
                accessibilityState={{ disabled: action.disabled }}
                disabled={action.disabled}
                onPress={() => {
                  selectionFeedback();
                  onClose();
                  action.onPress();
                }}
                style={({ pressed }) => [styles.action, pressed && styles.pressed, action.disabled && styles.disabled]}
              >
                <Icon name={action.icon} tone={action.destructive ? 'danger' : 'textSecondary'} />
                <View style={styles.actionText}>
                  <AppText variant="bodyStrong" tone={action.destructive ? 'danger' : 'textPrimary'}>
                    {action.label}
                  </AppText>
                  {action.description ? (
                    <AppText variant="caption" tone="textMuted">
                      {action.description}
                    </AppText>
                  ) : null}
                </View>
              </Pressable>
            ))}
          </ScrollView>
          <Pressable
            accessibilityRole="button"
            onPress={onClose}
            style={({ pressed }) => [styles.cancel, pressed && styles.pressed]}
            testID="sheet-cancel"
          >
            <AppText variant="bodyStrong" tone="textSecondary">
              Cancel
            </AppText>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    flex: 1,
    backgroundColor: colors.overlay,
  },
  sheet: {
    width: '100%',
    maxWidth: sizes.maxContentWidth,
    maxHeight: '85%',
    alignSelf: 'center',
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.backgroundElevated,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: radii.pill,
    backgroundColor: colors.borderStrong,
    marginBottom: spacing.md,
  },
  header: {
    gap: spacing.xxs,
    paddingHorizontal: spacing.sm,
    paddingBottom: spacing.md,
  },
  list: {
    flexGrow: 0,
  },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 52,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
  },
  actionText: {
    flex: 1,
    gap: spacing.xxs,
  },
  pressed: {
    backgroundColor: colors.surface,
  },
  disabled: {
    opacity: 0.4,
  },
  cancel: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
    marginTop: spacing.sm,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
  },
});
