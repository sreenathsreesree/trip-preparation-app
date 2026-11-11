import { StyleSheet, View } from 'react-native';

import { AppText, Card, Icon, Notice, OptionTile, ToggleRow } from '@/components/ui';
import { formatDateRange } from '@/lib/dates';
import { spacing } from '@/theme';

import { TemplatePicker } from '../../../preparation/components/TemplatePicker';
import { useEnsureTemplatesLoaded } from '../../../preparation/hooks';
import { getStandardSectionsFor, SECTION_META } from '../../../preparation/model';
import { useTemplatesStore } from '../../../preparation/templatesStore';
import {
  describeTravellers,
  formatRoute,
  isTransportMode,
  isTripCategory,
  TRANSPORT_MODES,
  TRANSPORT_MODE_META,
  TRIP_CATEGORY_META,
} from '../../model';
import { useTripDraftStore } from '../../tripDraftStore';
import { selectTripById, useTripsStore } from '../../tripsStore';
import type { TripDraftErrors } from '../../validation';

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.summaryRow}>
      <AppText variant="caption" tone="textMuted">
        {label}
      </AppText>
      <AppText variant="captionStrong" style={styles.summaryValue} numberOfLines={3}>
        {value}
      </AppText>
    </View>
  );
}

/** Transport picker, shared by the create wizard and the edit form. */
export function TransportPicker({ errors }: { errors: TripDraftErrors }) {
  const transportMode = useTripDraftStore((state) => state.draft.transportMode);
  const update = useTripDraftStore((state) => state.update);
  return (
    <View style={styles.group}>
      <View style={styles.grid} accessibilityRole="radiogroup" accessibilityLabel="Transport mode">
        {TRANSPORT_MODES.map((option) => (
          <OptionTile
            key={option}
            label={TRANSPORT_MODE_META[option].label}
            icon={TRANSPORT_MODE_META[option].icon}
            selected={transportMode === option}
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
    </View>
  );
}

/** Where the new trip's checklist comes from (create mode only). */
function ChecklistSources() {
  useEnsureTemplatesLoaded();
  const transportMode = useTripDraftStore((state) => state.draft.transportMode);
  const withStarterChecklist = useTripDraftStore((state) => state.withStarterChecklist);
  const templateIds = useTripDraftStore((state) => state.templateIds);
  const { setWithStarterChecklist, toggleTemplate } = useTripDraftStore.getState();
  const templates = useTemplatesStore((state) => state.templates);
  const mode = isTransportMode(transportMode) ? transportMode : null;

  return (
    <View style={styles.group}>
      <AppText variant="label" tone="textSecondary">
        Checklist
      </AppText>
      {mode ? (
        <View style={styles.sections}>
          <Icon name="radar" size={16} tone="accent" />
          <AppText variant="caption" tone="textSecondary" style={styles.flex}>
            Your dashboard will track{' '}
            {getStandardSectionsFor(mode)
              .map((kind) => SECTION_META[kind].title.toLowerCase())
              .join(', ')}
            .
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
      {templates.length > 0 ? (
        <View style={styles.group}>
          <AppText variant="caption" tone="textMuted">
            Add tasks from your templates (copied into this trip; later template edits won&apos;t change it):
          </AppText>
          <TemplatePicker templates={templates} selectedIds={templateIds} onToggle={toggleTemplate} />
        </View>
      ) : null}
    </View>
  );
}

export function HowStep({ errors }: { errors: TripDraftErrors }) {
  const draft = useTripDraftStore((state) => state.draft);
  const mode = useTripDraftStore((state) => state.mode);
  const tripId = useTripDraftStore((state) => state.tripId);
  const savedTrip = useTripsStore(selectTripById(tripId ?? undefined));

  return (
    <View style={styles.container}>
      <TransportPicker errors={errors} />
      {mode === 'create' ? <ChecklistSources /> : null}

      <Card variant="outline">
        <AppText variant="label" tone="accent" style={styles.summaryTitle}>
          Trip summary
        </AppText>
        <SummaryRow label="Trip" value={draft.name.trim() || '—'} />
        <SummaryRow
          label="Route"
          value={savedTrip ? formatRoute(savedTrip.destinations) : 'Planned next, in the planner'}
        />
        <SummaryRow
          label="Dates"
          value={draft.startDate && draft.endDate ? formatDateRange(draft.startDate, draft.endDate) : '—'}
        />
        <SummaryRow label="Travellers" value={describeTravellers(draft.travellers)} />
        <SummaryRow
          label="Category"
          value={isTripCategory(draft.category) ? TRIP_CATEGORY_META[draft.category].label : '—'}
        />
      </Card>
    </View>
  );
}

/** Reassurance shown when editing: details never touch the checklist. */
export function EditChecklistNote() {
  return (
    <Notice
      tone="info"
      title="Your checklist stays as it is"
      message="Changing details never adds, removes or unticks tasks. Manage sections and tasks from the trip dashboard."
    />
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.lg,
  },
  group: {
    gap: spacing.sm,
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
