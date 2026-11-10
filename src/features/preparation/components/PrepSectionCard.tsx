import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { AppText, Card, Icon, ProgressBar } from '@/components/ui';
import { radii, spacing, withAlpha } from '@/theme';

import { PREP_SECTION_META, summarizeItems, type PrepItem, type PrepSectionId } from '../model';

export interface PrepSectionCardProps {
  tripId: string;
  section: PrepSectionId;
  items: PrepItem[];
}

export function PrepSectionCard({ tripId, section, items }: PrepSectionCardProps) {
  const meta = PREP_SECTION_META[section];
  const { total, done } = summarizeItems(items);
  const complete = total > 0 && done === total;
  const nextOpen = items.find((item) => !item.isDone);
  const status =
    total === 0 ? 'Nothing added yet' : complete ? 'All ready' : `${total - done} left`;

  return (
    <Card
      onPress={() =>
        router.push({ pathname: '/trips/[tripId]/[section]', params: { tripId, section } })
      }
      accessibilityLabel={`${meta.title}: ${done} of ${total} ready`}
      accessibilityHint={`Opens the ${meta.title.toLowerCase()} checklist`}
      testID={`section-card-${section}`}
      variant={complete ? 'accent' : 'default'}
    >
      <View style={styles.header}>
        <View style={[styles.iconBadge, { backgroundColor: withAlpha(meta.tint, 0.14) }]}>
          <Icon name={meta.icon} color={meta.tint} size={22} />
        </View>
        <View style={styles.titles}>
          <AppText variant="title">{meta.title}</AppText>
          <AppText variant="caption" tone={complete ? 'accent' : 'textMuted'}>
            {status}
          </AppText>
        </View>
        <AppText variant="h3" style={{ color: meta.tint }}>
          {done}
          <AppText variant="caption" tone="textMuted">
            /{total}
          </AppText>
        </AppText>
        <Icon name="chevron-right" tone="textMuted" />
      </View>
      <View style={styles.progress}>
        <ProgressBar value={total === 0 ? 0 : done / total} color={meta.tint} height={4} />
      </View>
      {nextOpen ? (
        <View style={styles.next}>
          <View style={[styles.dot, { borderColor: meta.tint }]} />
          <AppText variant="caption" tone="textSecondary" numberOfLines={1} style={styles.flex}>
            Next: {nextOpen.title}
          </AppText>
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
  next: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
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
