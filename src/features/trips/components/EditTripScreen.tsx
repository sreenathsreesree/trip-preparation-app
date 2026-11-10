import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Screen } from '@/components/layout/Screen';
import { goBackOrHome, ScreenHeader } from '@/components/layout/ScreenHeader';
import { Button, EmptyState, ErrorState, LoadingState, Notice, SectionHeader } from '@/components/ui';
import { todayISO } from '@/lib/dates';
import { toErrorMessage } from '@/lib/errors';
import { successFeedback } from '@/lib/haptics';
import { spacing } from '@/theme';

import { useTrip } from '../hooks';
import type { TripSummary } from '../model';
import { ALL_TRIP_FIELDS, useTripDraftStore } from '../tripDraftStore';
import { useTripsStore } from '../tripsStore';
import { draftToTripInput, hasErrors, pickErrors, validateTripDraft, type TripDraftField } from '../validation';
import { BasicsStep } from './create/BasicsStep';
import { EditChecklistNote, TransportPicker } from './create/HowStep';
import { WhenStep } from './create/WhenStep';

function EditForm({ trip }: { trip: TripSummary }) {
  const today = useMemo(() => todayISO(), []);
  const tripId = useTripDraftStore((state) => state.tripId);
  const mode = useTripDraftStore((state) => state.mode);
  const draft = useTripDraftStore((state) => state.draft);
  const revealed = useTripDraftStore((state) => state.revealed);
  const minStartDate = useTripDraftStore((state) => state.minStartDate);
  const { startEdit, reveal } = useTripDraftStore.getState();
  const updateTrip = useTripsStore((state) => state.update);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Prefill once per trip; later store updates (e.g. after saving) must not reset the form.
  useEffect(() => {
    startEdit(trip, today);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trip.id]);

  const ready = mode === 'edit' && tripId === trip.id;
  const allErrors = useMemo(() => validateTripDraft(draft, { minStartDate }), [draft, minStartDate]);
  const visibleErrors = pickErrors(
    allErrors,
    (Object.keys(revealed) as TripDraftField[]).filter((field) => revealed[field]),
  );
  const showErrors = hasErrors(visibleErrors);

  async function save() {
    reveal(ALL_TRIP_FIELDS);
    if (hasErrors(allErrors)) return;
    setSaving(true);
    setSaveError(null);
    try {
      await updateTrip(trip.id, draftToTripInput(draft, { minStartDate }));
      successFeedback();
      goBackOrHome();
    } catch (error) {
      setSaveError(toErrorMessage(error, 'Could not save your changes.'));
    } finally {
      setSaving(false);
    }
  }

  if (!ready) return <LoadingState label="Loading trip…" />;

  return (
    <Screen
      testID="edit-trip-screen"
      footer={
        <View style={styles.footer}>
          <Button label="Cancel" variant="secondary" onPress={goBackOrHome} disabled={saving} />
          <Button
            label="Save changes"
            icon="content-save-outline"
            onPress={() => void save()}
            loading={saving}
            style={styles.primary}
            testID="edit-trip-save"
          />
        </View>
      }
    >
      <ScreenHeader showBack backIcon="close" eyebrow="Edit trip" title={trip.name} />
      <EditChecklistNote />

      <SectionHeader title="Basics" />
      <BasicsStep errors={visibleErrors} />

      <SectionHeader title="Dates and travellers" />
      <WhenStep errors={visibleErrors} />

      <SectionHeader title="Transport" />
      <TransportPicker errors={visibleErrors} />

      {showErrors ? (
        <Notice tone="warning" title="Check the highlighted fields" message="Some details need fixing before saving." />
      ) : null}
      {saveError ? <Notice tone="danger" title="Changes not saved" message={saveError} /> : null}
    </Screen>
  );
}

export function EditTripScreen({ tripId }: { tripId: string | undefined }) {
  const { trip, status, error, reload } = useTrip(tripId);
  if (trip) return <EditForm trip={trip} />;
  return (
    <Screen bottomInset>
      <ScreenHeader showBack backIcon="close" title="Edit trip" />
      {status === 'error' ? (
        <ErrorState message={error ?? 'Could not load your trips.'} onRetry={() => void reload()} />
      ) : status === 'ready' ? (
        <EmptyState
          icon="map-marker-question-outline"
          title="Trip not found"
          message="It may have been deleted from this device."
          action={{ label: 'View all trips', onPress: () => router.replace('/trips') }}
        />
      ) : (
        <LoadingState label="Loading trip…" />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  footer: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  primary: {
    flex: 1,
  },
});
