import { StyleSheet, View } from 'react-native';

import { AppText, OptionTile, Tag } from '@/components/ui';
import { spacing } from '@/theme';

import { PRIORITIES, PRIORITY_META, type Priority } from '../model';

/**
 * Compact priority marker. Recommended is the default and is not badged, so
 * essential tasks stand out.
 */
export function PriorityBadge({ priority, always = false }: { priority: Priority; always?: boolean }) {
  if (priority === 'recommended' && !always) return null;
  const meta = PRIORITY_META[priority];
  return <Tag label={meta.label} icon={meta.icon} color={meta.color} />;
}

export function PrioritySelector({
  value,
  onChange,
}: {
  value: Priority;
  onChange: (priority: Priority) => void;
}) {
  return (
    <View style={styles.group}>
      <AppText variant="label" tone="textSecondary">
        Priority
      </AppText>
      <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel="Priority">
        {PRIORITIES.map((priority) => (
          <OptionTile
            key={priority}
            layout="chip"
            label={PRIORITY_META[priority].label}
            icon={PRIORITY_META[priority].icon}
            selected={value === priority}
            onPress={() => onChange(priority)}
            testID={`priority-${priority}`}
          />
        ))}
      </View>
      <AppText variant="caption" tone="textMuted">
        {PRIORITY_META[value].description}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  group: {
    gap: spacing.sm,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
});
