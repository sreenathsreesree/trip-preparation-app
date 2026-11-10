import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { AppText, Card, Icon, ProgressBar, Tag } from '@/components/ui';
import { colors, radii, spacing, withAlpha } from '@/theme';

import { SECTION_META, type ChecklistSection, type ChecklistTask } from '../model';
import { completionPercent, computeStats, openCount } from '../readiness';

export interface SectionCardProps {
  tripId: string;
  section: ChecklistSection;
  tasks: ChecklistTask[];
}

/** Dashboard card for one checklist section, with section-level progress. */
export function SectionCard({ tripId, section, tasks }: SectionCardProps) {
  const meta = SECTION_META[section.kind];
  const stats = computeStats(tasks);
  const essentialsOpen = openCount(stats.essential);
  const complete = stats.total > 0 && stats.done === stats.total;
  const nextOpen = tasks.find((t) => !t.isDone && t.priority === 'essential') ?? tasks.find((t) => !t.isDone);
  const status =
    stats.total === 0 ? 'Nothing added yet' : complete ? 'All done' : `${stats.total - stats.done} left`;

  return (
    <Card
      onPress={() =>
        router.push({
          pathname: '/trips/[tripId]/sections/[sectionId]',
          params: { tripId, sectionId: section.id },
        })
      }
      accessibilityLabel={`${section.title}: ${stats.done} of ${stats.total} done${
        essentialsOpen > 0 ? `, ${essentialsOpen} essential open` : ''
      }`}
      accessibilityHint={`Opens the ${section.title} checklist`}
      testID={`section-card-${section.kind === 'custom' ? section.title.toLowerCase().replace(/\s+/g, '-') : section.kind}`}
      variant={complete ? 'accent' : 'default'}
    >
      <View style={styles.header}>
        <View style={[styles.iconBadge, { backgroundColor: withAlpha(meta.tint, 0.14) }]}>
          <Icon name={meta.icon} color={meta.tint} size={22} />
        </View>
        <View style={styles.titles}>
          <AppText variant="title" numberOfLines={1}>
            {section.title}
          </AppText>
          <AppText variant="caption" tone={complete ? 'accent' : 'textMuted'}>
            {status}
          </AppText>
        </View>
        <AppText variant="h3" style={{ color: meta.tint }}>
          {stats.done}
          <AppText variant="caption" tone="textMuted">
            /{stats.total}
          </AppText>
        </AppText>
        <Icon name="chevron-right" tone="textMuted" />
      </View>
      <View style={styles.progress}>
        <ProgressBar value={completionPercent(stats) / 100} color={meta.tint} height={4} />
      </View>
      {essentialsOpen > 0 || nextOpen ? (
        <View style={styles.footer}>
          {essentialsOpen > 0 ? (
            <Tag
              icon="alert-decagram"
              label={`${essentialsOpen} essential open`}
              color={colors.danger}
            />
          ) : null}
          {nextOpen ? (
            <View style={styles.next}>
              <View style={[styles.dot, { borderColor: meta.tint }]} />
              <AppText variant="caption" tone="textSecondary" numberOfLines={1} style={styles.flex}>
                Next: {nextOpen.title}
              </AppText>
            </View>
          ) : null}
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  iconBadge: {
    width: 44,
    height: 44,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titles: {
    flex: 1,
    gap: spacing.xxs,
  },
  progress: {
    marginTop: spacing.md,
  },
  footer: {
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  next: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: radii.pill,
    borderWidth: 1.5,
  },
  flex: {
    flex: 1,
  },
});
