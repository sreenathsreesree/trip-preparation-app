import { Pressable, StyleSheet, View } from 'react-native';

import { AppText, Icon } from '@/components/ui';
import { selectionFeedback } from '@/lib/haptics';
import { colors, radii, spacing } from '@/theme';

import type { TemplateSummary } from '../templateRepository';

export interface TemplatePickerProps {
  templates: TemplateSummary[];
  selectedIds: readonly string[];
  onToggle: (templateId: string) => void;
}

/** Multi-select list of checklist templates. */
export function TemplatePicker({ templates, selectedIds, onToggle }: TemplatePickerProps) {
  return (
    <View style={styles.list} accessibilityLabel="Checklist templates">
      {templates.map((template) => {
        const selected = selectedIds.includes(template.id);
        return (
          <Pressable
            key={template.id}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: selected }}
            accessibilityLabel={`${template.name}, ${template.taskCount} tasks`}
            onPress={() => {
              selectionFeedback();
              onToggle(template.id);
            }}
            style={({ pressed }) => [styles.row, selected && styles.selected, pressed && styles.pressed]}
            testID={`template-option-${template.id}`}
          >
            <View style={[styles.checkbox, selected && styles.checkboxSelected]}>
              {selected ? <Icon name="check-bold" size={14} tone="textOnAccent" /> : null}
            </View>
            <View style={styles.text}>
              <AppText variant="bodyStrong" numberOfLines={1}>
                {template.name}
              </AppText>
              <AppText variant="caption" tone="textMuted" numberOfLines={2}>
                {template.taskCount} {template.taskCount === 1 ? 'task' : 'tasks'} in {template.sectionCount}{' '}
                {template.sectionCount === 1 ? 'section' : 'sections'}
                {template.description ? ` · ${template.description}` : ''}
              </AppText>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  selected: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  pressed: {
    opacity: 0.8,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: radii.xs,
    borderWidth: 2,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxSelected: {
    borderColor: colors.accent,
    backgroundColor: colors.accent,
  },
  text: {
    flex: 1,
    gap: spacing.xxs,
  },
});
