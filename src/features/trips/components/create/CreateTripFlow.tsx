import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { BackHandler, StyleSheet, View } from 'react-native';
import Animated, { FadeInRight, FadeOutLeft } from 'react-native-reanimated';

import { Screen } from '@/components/layout/Screen';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { Button, Notice } from '@/components/ui';
import { todayISO } from '@/lib/dates';
import { toErrorMessage } from '@/lib/errors';
import { successFeedback } from '@/lib/haptics';
import { spacing } from '@/theme';

import { CREATE_TRIP_STEPS, useTripDraftStore } from '../../tripDraftStore';
import { useTripsStore } from '../../tripsStore';
import {
  draftToTripInput,
  hasErrors,
  pickErrors,
  validateTripDraft,
  type TripDraftField,
} from '../../validation';
import { BasicsStep } from './BasicsStep';
import { HowStep } from './HowStep';
import { WhenStep } from './WhenStep';
import { WizardProgress } from './WizardProgress';

export function CreateTripFlow() {
  const today = useMemo(() => todayISO(), []);
  const draft = useTripDraftStore((state) => state.draft);
  const step = useTripDraftStore((state) => state.step);
  const revealed = useTripDraftStore((state) => state.revealed);
  const minStartDate = useTripDraftStore((state) => state.minStartDate);
  const withStarterChecklist = useTripDraftStore((state) => state.withStarterChecklist);
  const templateIds = useTripDraftStore((state) => state.templateIds);
  const { reveal, goTo, startCreate } = useTripDraftStore.getState();
  const createTrip = useTripsStore((state) => state.create);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Every visit starts from a clean draft.
  useEffect(() => {
    startCreate(today);
  }, [startCreate, today]);

  // Android hardware/gesture back steps back through the wizard instead of
  // closing it and discarding the draft. (No-op on iOS and web.)
  useFocusEffect(
    useCallback(() => {
      const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
        if (submitting) return true;
        if (step > 0) {
          goTo(step - 1);
          return true;
        }
        return false;
      });
      return () => subscription.remove();
    }, [step, submitting, goTo]),
  );

  const current = CREATE_TRIP_STEPS[step] ?? CREATE_TRIP_STEPS[0];
  const isLast = step === CREATE_TRIP_STEPS.length - 1;
  const allErrors = useMemo(() => validateTripDraft(draft, { minStartDate }), [draft, minStartDate]);
  const visibleErrors = pickErrors(
    allErrors,
    (Object.keys(revealed) as TripDraftField[]).filter((field) => revealed[field]),
  );

  async function submit() {
    setSubmitError(null);
    setSubmitting(true);
    try {
      const input = draftToTripInput(draft, { minStartDate });
      const trip = await createTrip(input, { withStarterChecklist, templateIds });
      successFeedback();
      router.replace({ pathname: '/trips/[tripId]', params: { tripId: trip.id } });
    } catch (error) {
      setSubmitError(toErrorMessage(error, 'Could not save the trip. Please try again.'));
    } finally {
      setSubmitting(false);
    }
  }

  function next() {
    const fields = current.fields;
    reveal(fields);
    if (hasErrors(pickErrors(allErrors, fields))) return;
    if (isLast) {
      void submit();
    } else {
      goTo(step + 1);
    }
  }

  return (
    <Screen
      testID="create-trip-screen"
      footer={
        <View style={styles.footer}>
          {step > 0 ? (
            <Button
              label="Back"
              variant="secondary"
              icon="arrow-left"
              onPress={() => goTo(step - 1)}
              disabled={submitting}
              testID="wizard-back"
            />
          ) : null}
          <Button
            label={isLast ? 'Create trip' : 'Continue'}
            icon={isLast ? 'check' : 'arrow-right'}
            iconPosition={isLast ? 'leading' : 'trailing'}
            onPress={next}
            loading={submitting}
            style={styles.primary}
            testID={isLast ? 'wizard-create' : 'wizard-next'}
          />
        </View>
      }
    >
      <ScreenHeader
        showBack
        backIcon="close"
        eyebrow="New trip"
        title={current.title}
        subtitle={current.subtitle}
      />
      <WizardProgress step={step} total={CREATE_TRIP_STEPS.length} />

      <Animated.View key={current.key} entering={FadeInRight.duration(220)} exiting={FadeOutLeft.duration(120)}>
        {step === 0 && <BasicsStep errors={visibleErrors} />}
        {step === 1 && <WhenStep errors={visibleErrors} />}
        {step === 2 && <HowStep errors={visibleErrors} />}
      </Animated.View>

      {submitError ? <Notice tone="danger" title="Trip not saved" message={submitError} /> : null}
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
