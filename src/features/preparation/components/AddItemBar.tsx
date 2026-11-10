import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { AppText, Icon, IconButton } from '@/components/ui';
import { toErrorMessage } from '@/lib/errors';
import { selectionFeedback } from '@/lib/haptics';
import { colors, fontFamilies, radii, sizes, spacing, withAlpha } from '@/theme';

import { CHECKLIST_LIMITS, normalizeTitle, PRIORITIES, PRIORITY_META, type Priority } from '../model';

export interface AddItemBarProps {
  placeholder: string;
  onAdd: (title: string, priority: Priority) => Promise<unknown>;
  /** Show a priority choice for the new task. */
  withPriority?: boolean;
  maxLength?: number;
  testID?: string;
}

/** Quick-add input. Details (description, notes) are edited afterwards. */
export function AddItemBar({
  placeholder,
  onAdd,
  withPriority = false,
  maxLength = CHECKLIST_LIMITS.taskTitleMax,
  testID = 'add-item',
}: AddItemBarProps) {
  const [value, setValue] = useState('');
  const [priority, setPriority] = useState<Priority>('recommended');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canAdd = normalizeTitle(value).length > 0 && !saving;

  async function submit() {
    if (!canAdd) return;
    setSaving(true);
    setError(null);
    try {
      await onAdd(value, priority);
      setValue('');
    } catch (err) {
      setError(toErrorMessage(err, 'Could not add it.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.bar}>
        <TextInput
          value={value}
          onChangeText={(text) => {
            setValue(text);
            if (error) setError(null);
          }}
          placeholder={placeholder}
          placeholderTextColor={colors.textMuted}
          selectionColor={colors.accent}
          cursorColor={colors.accent}
          maxLength={maxLength}
          returnKeyType="done"
          submitBehavior="submit"
          onSubmitEditing={() => void submit()}
          accessibilityLabel={placeholder}
          style={styles.input}
          testID={`${testID}-input`}
        />
        <IconButton
          icon="plus"
          tone={canAdd ? 'textOnAccent' : 'textMuted'}
          accessibilityLabel="Add"
          disabled={!canAdd}
          onPress={() => void submit()}
          testID={`${testID}-button`}
          variant={canAdd ? 'accent' : 'plain'}
        />
      </View>
      {withPriority ? (
        <View style={styles.priorities} accessibilityRole="radiogroup" accessibilityLabel="Priority for new task">
          {PRIORITIES.map((option) => {
            const selected = option === priority;
            const meta = PRIORITY_META[option];
            return (
              <Pressable
                key={option}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
                accessibilityLabel={`New task priority ${meta.label}`}
                hitSlop={6}
                onPress={() => {
                  selectionFeedback();
                  setPriority(option);
                }}
                style={[
                  styles.priority,
                  selected && { borderColor: meta.color, backgroundColor: withAlpha(meta.color.slice(0, 7), 0.12) },
                ]}
                testID={`${testID}-priority-${option}`}
              >
                <Icon name={meta.icon} size={14} color={selected ? meta.color : colors.textMuted} />
                <AppText variant="caption" style={{ color: selected ? meta.color : colors.textMuted }}>
                  {meta.label}
                </AppText>
              </Pressable>
            );
          })}
        </View>
      ) : null}
      {error ? (
        <AppText variant="caption" tone="danger" accessibilityLiveRegion="polite">
          {error}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.sm,
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingLeft: spacing.lg,
    paddingRight: spacing.xs,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
  },
  input: {
    flex: 1,
    minWidth: 0,
    minHeight: sizes.inputHeight,
    color: colors.textPrimary,
    fontFamily: fontFamilies.body,
    fontSize: 16,
  },
  priorities: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  priority: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
  },
});
