import { useRef } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import ReanimatedSwipeable, {
  type SwipeableMethods,
} from 'react-native-gesture-handler/ReanimatedSwipeable';
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';

import { AppText, Icon, IconButton } from '@/components/ui';
import { selectionFeedback } from '@/lib/haptics';
import { colors, radii, spacing } from '@/theme';

import type { PrepItem } from '../model';

export interface PrepItemRowProps {
  item: PrepItem;
  tint: string;
  onToggle: (item: PrepItem) => void;
  onDelete: (item: PrepItem) => void;
}

function DeleteAction({ onPress }: { onPress: () => void }) {
  return (
    <View style={styles.deleteAction}>
      <IconButton icon="trash-can-outline" tone="danger" accessibilityLabel="Delete item" onPress={onPress} variant="plain" />
    </View>
  );
}

/** Checklist row: tap to toggle, swipe left (or use the delete control) to remove. */
export function PrepItemRow({ item, tint, onToggle, onDelete }: PrepItemRowProps) {
  const swipeable = useRef<SwipeableMethods>(null);

  return (
    <Animated.View entering={FadeIn.duration(180)} exiting={FadeOut.duration(150)} layout={LinearTransition}>
      <ReanimatedSwipeable
        ref={swipeable}
        friction={2}
        rightThreshold={40}
        overshootRight={false}
        renderRightActions={() => (
          <DeleteAction
            onPress={() => {
              swipeable.current?.close();
              onDelete(item);
            }}
          />
        )}
      >
        <View style={styles.row}>
          <Pressable
            testID={`prep-item-${item.id}`}
            accessibilityRole="checkbox"
            accessibilityLabel={item.title}
            accessibilityState={{ checked: item.isDone }}
            accessibilityActions={[{ name: 'delete', label: 'Delete item' }]}
            onAccessibilityAction={(event) => {
              if (event.nativeEvent.actionName === 'delete') onDelete(item);
            }}
            onPress={() => {
              selectionFeedback();
              onToggle(item);
            }}
            style={({ pressed }) => [styles.toggleArea, pressed && styles.pressed]}
          >
            <View
              style={[
                styles.checkbox,
                { borderColor: item.isDone ? tint : colors.borderStrong },
                item.isDone && { backgroundColor: tint },
              ]}
            >
              {item.isDone ? <Icon name="check-bold" size={14} tone="textOnAccent" /> : null}
            </View>
            <AppText
              variant="body"
              tone={item.isDone ? 'textMuted' : 'textPrimary'}
              style={[styles.title, item.isDone && styles.done]}
            >
              {item.title}
            </AppText>
          </Pressable>
          <IconButton
            icon="close"
            tone="textMuted"
            variant="plain"
            accessibilityLabel={`Delete ${item.title}`}
            onPress={() => onDelete(item)}
            testID={`delete-item-${item.id}`}
          />
        </View>
      </ReanimatedSwipeable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: spacing.xs,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  toggleArea: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingLeft: spacing.lg,
    minHeight: 52,
  },
  pressed: {
    opacity: 0.7,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: radii.xs,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    flex: 1,
  },
  done: {
    textDecorationLine: 'line-through',
  },
  deleteAction: {
    justifyContent: 'center',
    alignItems: 'center',
    width: 72,
    marginLeft: spacing.sm,
    borderRadius: radii.md,
    backgroundColor: colors.dangerSoft,
  },
});
