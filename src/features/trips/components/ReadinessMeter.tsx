import { StyleSheet, View } from 'react-native';

import { AppText, ProgressBar } from '@/components/ui';
import { colors, spacing } from '@/theme';

import {
  describeDeparture,
  getDepartureStatus,
  readinessPercent,
  type DepartureStatus,
  type ReadinessStats,
} from '../../preparation/readiness';

export const DEPARTURE_COLORS: Record<DepartureStatus, string> = {
  empty: colors.textMuted,
  blocked: colors.warning,
  ready: colors.info,
  complete: colors.accent,
};

export interface ReadinessMeterProps {
  readiness: ReadinessStats;
  size?: 'compact' | 'large';
}

/** Departure-readiness read-out: status, percentage (optional tasks excluded) and a bar. */
export function ReadinessMeter({ readiness, size = 'compact' }: ReadinessMeterProps) {
  const status = getDepartureStatus(readiness);
  const percent = readinessPercent(readiness);
  const color = DEPARTURE_COLORS[status];
  const { title, detail } = describeDeparture(readiness);

  return (
    <View style={styles.container}>
      <View style={styles.row}>
        <View style={styles.label}>
          <AppText variant="label" style={{ color }}>
            {title}
          </AppText>
          <AppText variant="caption" tone="textSecondary" numberOfLines={2}>
            {detail}
          </AppText>
        </View>
        <AppText variant={size === 'large' ? 'metric' : 'h3'} style={{ color }}>
          {percent}%
        </AppText>
      </View>
      <ProgressBar
        value={percent / 100}
        color={color}
        height={size === 'large' ? 8 : 6}
        accessibilityLabel={`Readiness ${percent} percent. ${title}. ${detail}`}
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
    gap: spacing.md,
  },
  label: {
    flex: 1,
    gap: spacing.xxs,
  },
});
