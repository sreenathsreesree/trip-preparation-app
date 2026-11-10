import { StyleSheet, View } from 'react-native';

import { AppText, Card, Icon, OptionTile, ToggleRow } from '@/components/ui';
import { formatDateRange } from '@/lib/dates';
import { spacing } from '@/theme';

import { PREP_SECTION_META, getApplicableSections } from '../../../preparation/model';
import {
  describeTravellers,
  isTransportMode,
  isTripCategory,
  TRANSPORT_MODES,
  TRANSPORT_MODE_META,
  TRIP_CATEGORY_META,
} from '../../model';
import { useTripDraftStore } from '../../tripDraftStore';
import type { TripDraftErrors } from '../../validation';

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.summaryRow}>
      <AppText variant="caption" tone="textMuted">
        {label}
      </AppText>
      <AppText variant="captionStrong" style={styles.summaryValue} numberOfLines={2}>
        {value}
      </AppText>
    </View>
  );
}

export function HowStep({ errors }: { errors: TripDraftErrors }) {
  const draft = useTripDraftStore((state) => state.draft);
  const update = useTripDraftStore((state) => state.update);
  const withStarterChecklist = useTripDraftStore((state) => state.withStarterChecklist);
  const setWithStarterChecklist = useTripDraftStore((state) => state.setWithStarterChecklist);

  const mode = isTransportMode(draft.transportMode) ? draft.transportMode : null;
  const sections = mode ? getApplicableSections(mode) : [];

  return (
    <View style={styles.container}>
      <View style={styles.grid} accessibilityRole="radiogroup" accessibilityLabel="Transport mode">
        {TRANSPORT_MODES.map((option) => (
          <OptionTile
            key={option}
            label={TRANSPORT_MODE_META[option].label}
            icon={TRANSPORT_MODE_META[option].icon}
            selected={draft.transportMode === option}
            onPress={() => update({ transportMode: option })}
            style={styles.tile}
            testID={`transport-${option}`}
          />
        ))}
      </View>
      {errors.transportMode ? (
        <AppText variant="caption" tone="danger" accessibilityLiveRegion="polite">
          {errors.transportMode}
        </AppText>
      ) : null}

      {mode ? (
        <View style={styles.sections}>
          <Icon name="radar" size={16} tone="accent" />
          <AppText variant="caption" tone="textSecondary" style={styles.flex}>
            Your dashboard will track {sections.map((s) => PREP_SECTION_META[s].title.toLowerCase()).join(', ')}.
          </AppText>
        </View>
      ) : null}

      <ToggleRow
        icon="playlist-check"
        label="Start with a recommended checklist"
        description="Pre-fills each section with essentials for this kind of trip. You can edit everything later."
        value={withStarterChecklist}
        onChange={setWithStarterChecklist}
        testID="starter-checklist-toggle"
      />

      <Card variant="outline">
        <AppText variant="label" tone="accent" style={styles.summaryTitle}>
          Trip summary
        </AppText>
        <SummaryRow label="Trip" value={draft.name.trim() || '—'} />
        <SummaryRow label="Destination" value={draft.destination.trim() || '—'} />
        <SummaryRow
          label="Dates"
          value={draft.startDate && draft.endDate ? formatDateRange(draft.startDate, draft.endDate) : '—'}
        />
        <SummaryRow
          label="Travellers"
          value={describeTravellers({ adults: draft.adults, children: draft.children })}
        />
        <SummaryRow
          label="Category"
          value={isTripCategory(draft.category) ? TRIP_CATEGORY_META[draft.category].label : '—'}
        />
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.lg,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  tile: {
    flexBasis: '31%',
    flexGrow: 1,
  },
  sections: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  flex: {
    flex: 1,
  },
  summaryTitle: {
    marginBottom: spacing.sm,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.lg,
    paddingVertical: spacing.xs,
  },
  summaryValue: {
    flex: 1,
    textAlign: 'right',
  },
});
