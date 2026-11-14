import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText, Icon, ProgressBar } from '@/components/ui';
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
import type { PackingProgress } from '../../packing/model';
import { combinedPreparation } from '../progress';
import { TaskRow } from './TaskRow';

const STATUS_ICON: Record<DepartureStatus, IconName> = {
  empty: 'clipboard-outline',
  blocked: 'alert-octagon-outline',
  ready: 'check-circle-outline',
  complete: 'check-decagram',
};

const ESSENTIALS_SHOWN = 3;

export interface ReadinessPanelProps {
  tripId: string;
  sections: ChecklistSection[];
  tasks: ChecklistTask[];
  onToggle: (task: ChecklistTask) => void;
  onDelete: (task: ChecklistTask) => void;
  /** Packing list progress, when loaded: folded into the one preparation number. */
  packing?: PackingProgress | null;
}

/**
 * One combined preparation number (checklist readiness and packing, see
 * progress.ts) with its parts underneath, the per-priority breakdown, and the
 * essential tasks still blocking departure (tickable in place).
 */
export function ReadinessPanel({ tripId, sections, tasks, onToggle, onDelete, packing = null }: ReadinessPanelProps) {
  const stats = computeStats(tasks);
  const status = getDepartureStatus(stats);
  const color = DEPARTURE_COLORS[status];
  const { title, detail } = describeDeparture(stats);
  const sectionById = new Map(sections.map((s) => [s.id, s]));
  const openEssentials = tasks.filter((t) => t.priority === 'essential' && !t.isDone);
  const combined = combinedPreparation(stats, packing ?? { units: 0, packedUnits: 0 });
  const openPacking = () => router.push({ pathname: '/trips/[tripId]/packing', params: { tripId } });

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

      <View style={styles.overall}>
        <View style={styles.overallRow}>
          <AppText variant="metric" style={{ color }} testID="preparation-percent">
            {combined.percent}%
          </AppText>
          <AppText variant="label" tone="textMuted" style={styles.flex}>
            Prepared overall
          </AppText>
        </View>
        <ProgressBar value={combined.percent / 100} color={color} height={6} />
      </View>
      <View style={styles.parts}>
        <View style={styles.part}>
          <Icon name="clipboard-check-outline" size={18} tone="textSecondary" />
          <AppText variant="body" style={styles.flex}>
            Checklist
          </AppText>
          <AppText variant="bodyStrong" testID="readiness-percent">
            {readinessPercent(stats)}%
          </AppText>
          <AppText variant="caption" tone="textMuted">
            ready ·{' '}
          </AppText>
          <AppText variant="caption" tone="textMuted" testID="completion-percent">
            {completionPercent(stats)}%
          </AppText>
          <AppText variant="caption" tone="textMuted">
            {' '}done ({stats.done}/{stats.total})
          </AppText>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Open packing list" onPress={openPacking} style={styles.part} testID="packing-summary">
          <Icon name="bag-personal-outline" size={18} tone="textSecondary" />
          <AppText variant="body" style={styles.flex}>
            Packing
          </AppText>
          <AppText variant="caption" tone="textMuted">
            {packing === null ? 'Loading…' : packing.units === 0 ? 'Nothing to pack yet' : `${packing.packedUnits} of ${packing.units} packed`}
          </AppText>
          <Icon name="chevron-right" size={18} tone="textMuted" />
        </Pressable>
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
  overall: {
    gap: spacing.sm,
  },
  overallRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.sm,
  },
  parts: {
    borderRadius: radii.md,
    backgroundColor: colors.overlay,
  },
  part: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: 44,
    paddingHorizontal: spacing.md,
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
