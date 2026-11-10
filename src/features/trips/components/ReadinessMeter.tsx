import { StyleSheet, View } from 'react-native';

import { AppText, ProgressBar } from '@/components/ui';
import { colors, spacing } from '@/theme';

import { progressRatio, type PrepProgress } from '../model';

export interface ReadinessMeterProps {
  progress: PrepProgress;
  size?: 'compact' | 'large';
}

/** "Readiness" read-out: percentage plus done/total and a bar. */
export function ReadinessMeter({ progress, size = 'compact' }: ReadinessMeterProps) {
  const ratio = progressRatio(progress);
  const percent = Math.round(ratio * 100);
  const color = ratio >= 1 ? colors.accent : ratio >= 0.5 ? colors.info : colors.warning;
  const summary =
    progress.total === 0
      ? 'No checklist items yet'
      : `${progress.done} of ${progress.total} ready`;

  return (
    <View style={styles.container}>
      <View style={styles.row}>
        <View style={styles.label}>
          <AppText variant="label" tone="textMuted">
            Readiness
          </AppText>
          <AppText variant="caption" tone="textSecondary">
            {summary}
          </AppText>
        </View>
        <AppText variant={size === 'large' ? 'metric' : 'h3'} style={{ color }}>
          {percent}%
        </AppText>
      </View>
      <ProgressBar
        value={ratio}
        color={color}
        height={size === 'large' ? 8 : 6}
        accessibilityLabel={`Readiness ${percent} percent, ${summary}`}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  label: {
    gap: spacing.xxs,
  },
});
