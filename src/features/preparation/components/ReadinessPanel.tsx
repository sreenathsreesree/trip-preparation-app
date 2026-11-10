import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { AppText, Icon } from '@/components/ui';
import { colors, radii, spacing } from '@/theme';
import type { IconName } from '@/theme/icons';

import { DEPARTURE_COLORS } from '../../trips/components/ReadinessMeter';
import { PRIORITIES, PRIORITY_META, SECTION_META, type ChecklistSection, type ChecklistTask } from '../model';
import {
  completionPercent,
  computeStats,
  describeDeparture,
  getDepartureStatus,
  readinessPercent,
  type DepartureStatus,
} from '../readiness';
import { TaskRow } from './TaskRow';

const STATUS_ICON: Record<DepartureStatus, IconName> = {
  empty: 'clipboard-outline',
  blocked: 'alert-octagon-outline',
  ready: 'check-circle-outline',
  complete: 'check-decagram',
};

const ESSENTIALS_SHOWN = 5;

export interface ReadinessPanelProps {
  tripId: string;
  sections: ChecklistSection[];
  tasks: ChecklistTask[];
  onToggle: (task: ChecklistTask) => void;
  onDelete: (task: ChecklistTask) => void;
}

/**
 * Departure readiness vs task completion, the per-priority breakdown, and the
 * essential tasks still blocking departure (tickable in place).
 */
export function ReadinessPanel({ tripId, sections, tasks, onToggle, onDelete }: ReadinessPanelProps) {
  const stats = computeStats(tasks);
  const status = getDepartureStatus(stats);
  const color = DEPARTURE_COLORS[status];
  const { title, detail } = describeDeparture(stats);
  const sectionById = new Map(sections.map((s) => [s.id, s]));
  const openEssentials = tasks.filter((t) => t.priority === 'essential' && !t.isDone);

  return (
    <View style={styles.container} testID="readiness-panel">
      <View style={styles.status}>
        <Icon name={STATUS_ICON[status]} color={color} size={28} />
        <View style={styles.flex}>
          <AppText variant="h3" style={{ color }} testID="departure-status">
            {title}
          </AppText>
          <AppText variant="caption" tone="textSecondary">
            {detail}
          </AppText>
        </View>
      </View>

      <View style={styles.metrics}>
        <View style={styles.metric}>
          <AppText variant="metric" style={{ color }} testID="readiness-percent">
            {readinessPercent(stats)}%
          </AppText>
          <AppText variant="label" tone="textMuted">
            Departure readiness
          </AppText>
          <AppText variant="caption" tone="textMuted">
            Essential + recommended
          </AppText>
        </View>
        <View style={styles.divider} />
        <View style={styles.metric}>
          <AppText variant="metric" tone="textPrimary" testID="completion-percent">
            {completionPercent(stats)}%
          </AppText>
          <AppText variant="label" tone="textMuted">
            Tasks completed
          </AppText>
          <AppText variant="caption" tone="textMuted">
            {stats.done} of {stats.total}, optional included
          </AppText>
        </View>
      </View>

      <View style={styles.breakdown}>
        {PRIORITIES.map((priority) => (
          <View key={priority} style={styles.breakdownItem}>
            <Icon name={PRIORITY_META[priority].icon} size={14} color={PRIORITY_META[priority].color} />
            <AppText variant="caption" tone="textSecondary">
              {PRIORITY_META[priority].label} {stats[priority].done}/{stats[priority].total}
            </AppText>
          </View>
        ))}
      </View>

      {openEssentials.length > 0 ? (
        <View style={styles.essentials}>
          <AppText variant="label" tone="danger">
            Essentials still open · {openEssentials.length}
          </AppText>
          {openEssentials.slice(0, ESSENTIALS_SHOWN).map((task) => {
            const section = sectionById.get(task.sectionId);
            return (
              <TaskRow
                key={task.id}
                task={task}
                tint={section ? SECTION_META[section.kind].tint : colors.accent}
                context={section?.title}
                hidePriority
                onToggle={onToggle}
                onDelete={onDelete}
                onOpen={(t) =>
                  router.push({ pathname: '/trips/[tripId]/tasks/[taskId]', params: { tripId, taskId: t.id } })
                }
              />
            );
          })}
          {openEssentials.length > ESSENTIALS_SHOWN ? (
            <AppText variant="caption" tone="textMuted">
              +{openEssentials.length - ESSENTIALS_SHOWN} more — open a section below to see them all.
            </AppText>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.lg,
  },
  status: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  flex: {
    flex: 1,
  },
  metrics: {
    flexDirection: 'row',
    alignItems: 'stretch',
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.overlay,
  },
  metric: {
    flex: 1,
    gap: spacing.xxs,
  },
  divider: {
    width: 1,
    marginHorizontal: spacing.md,
    backgroundColor: colors.border,
  },
  breakdown: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  breakdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  essentials: {
    gap: spacing.sm,
  },
});
