import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { Screen } from '@/components/layout/Screen';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { TopoBackdrop } from '@/components/layout/TopoBackdrop';
import {
  AppText,
  Button,
  EmptyState,
  ErrorState,
  IconButton,
  LoadingState,
  Notice,
  SectionHeader,
} from '@/components/ui';
import { formatDate, formatDateRange } from '@/lib/dates';
import { toErrorMessage } from '@/lib/errors';
import { colors, radii, spacing } from '@/theme';

import { PackingSummaryCard } from '../../packing/components/PackingSummaryCard';
import { useChecklistStore } from '../../preparation/checklistStore';
import { ReadinessPanel } from '../../preparation/components/ReadinessPanel';
import { SectionCard } from '../../preparation/components/SectionCard';
import { useOwner, useOwnerChecklist } from '../../preparation/hooks';
import { groupTasksBySection, type ChecklistTask } from '../../preparation/model';
import { buildStarterSection } from '../../preparation/starter';
import { useToday, useTrip } from '../hooks';
import {
  describeTripTiming,
  formatRoute,
  getTripLifecycle,
  getTripPhase,
  TRANSPORT_MODE_META,
  type TripSummary,
} from '../model';
import { useTripsStore } from '../tripsStore';
import { useTripActions } from './TripActions';
import { TripMetaTags } from './TripMetaTags';

function LifecycleNotice({ trip, today }: { trip: TripSummary; today: string }) {
  const lifecycle = getTripLifecycle(trip);
  const [error, setError] = useState<string | null>(null);
  const store = useTripsStore.getState;
  const act = (fn: () => Promise<void>) => () => {
    setError(null);
    fn().catch((err: unknown) => setError(toErrorMessage(err, 'That did not work. Please try again.')));
  };

  let notice = null;
  if (lifecycle === 'archived') {
    notice = (
      <Notice
        tone="info"
        icon="archive-outline"
        title="This trip is archived"
        message="It is hidden from active lists. Everything is kept and still editable."
        action={{ label: 'Restore trip', icon: 'archive-arrow-up-outline', onPress: act(() => store().setArchived(trip.id, false)) }}
        testID="archived-notice"
      />
    );
  } else if (lifecycle === 'completed' && trip.completedAt) {
    notice = (
      <Notice
        tone="success"
        icon="flag-checkered"
        title={`Completed on ${formatDate(trip.completedAt.slice(0, 10), { withYear: true })}`}
        action={{ label: 'Reopen trip', icon: 'restore', onPress: act(() => store().setCompleted(trip.id, false)) }}
        testID="completed-notice"
      />
    );
  } else if (getTripPhase(trip, today) === 'ended') {
    notice = (
      <Notice
        tone="warning"
        icon="calendar-check-outline"
        title="This trip has ended"
        message="Mark it as completed to move it out of your active trips."
        action={{ label: 'Mark as completed', icon: 'flag-checkered', onPress: act(() => store().setCompleted(trip.id, true)) }}
      />
    );
  }
  return (
    <>
      {notice}
      {error ? <Notice tone="danger" title="Could not update the trip" message={error} /> : null}
    </>
  );
}

function DashboardBody({ trip }: { trip: TripSummary }) {
  const today = useToday();
  const owner = useOwner('trip', trip.id);
  const checklist = useOwnerChecklist(owner);
  const { load, toggleTask, deleteTask, applyPlan } = useChecklistStore.getState();
  const [actionError, setActionError] = useState<string | null>(null);
  const [addingVehicle, setAddingVehicle] = useState(false);
  const { openActions, sheet, error: tripActionError } = useTripActions(trip, {
    onDeleted: () => router.replace('/trips'),
  });

  if (!owner) return null;
  const grouped = groupTasksBySection(checklist.tasks);
  const needsVehicle =
    TRANSPORT_MODE_META[trip.transportMode].needsVehicleReadiness &&
    checklist.status === 'ready' &&
    !checklist.sections.some((section) => section.kind === 'vehicle');

  const run = (fn: () => Promise<unknown>, fallback: string) => {
    setActionError(null);
    fn().catch((error: unknown) => setActionError(toErrorMessage(error, fallback)));
  };
  const onToggle = (task: ChecklistTask) => run(() => toggleTask(owner, task.id), 'Could not update the task.');
  const onDelete = (task: ChecklistTask) => run(() => deleteTask(owner, task.id), 'Could not delete the task.');

  return (
    <Screen testID="trip-dashboard" onRefresh={() => void load(owner)} bottomInset>
      <ScreenHeader
        showBack
        eyebrow={describeTripTiming(trip, today)}
        title={trip.name}
        subtitle={`${formatRoute(trip.destinations)} · ${formatDateRange(trip.startDate, trip.endDate)}`}
        trailing={
          <IconButton
            icon="dots-horizontal"
            accessibilityLabel="Trip actions"
            onPress={openActions}
            testID="trip-actions"
          />
        }
      />

      <LifecycleNotice trip={trip} today={today} />
      {tripActionError ? <Notice tone="danger" title="Action failed" message={tripActionError} /> : null}

      <View style={styles.hero}>
        <TopoBackdrop opacity={0.35} />
        <View style={styles.heroContent}>
          <TripMetaTags trip={trip} />
          {checklist.status === 'ready' ? (
            <ReadinessPanel
              tripId={trip.id}
              sections={checklist.sections}
              tasks={checklist.tasks}
              onToggle={onToggle}
              onDelete={onDelete}
            />
          ) : null}
        </View>
      </View>

      {actionError ? <Notice tone="danger" title="Something went wrong" message={actionError} /> : null}

      <PackingSummaryCard tripId={trip.id} />

      {needsVehicle ? (
        <Notice
          tone="warning"
          icon="car-wrench"
          title="Driving on this trip?"
          message="There is no vehicle readiness section yet. Add the recommended vehicle checks."
          action={{
            label: 'Add vehicle checks',
            icon: 'plus',
            loading: addingVehicle,
            onPress: () => {
              setAddingVehicle(true);
              run(
                () =>
                  applyPlan(owner, buildStarterSection('vehicle', trip)).finally(() => setAddingVehicle(false)),
                'Could not add vehicle checks.',
              );
            },
          }}
          testID="vehicle-suggestion"
        />
      ) : null}

      <SectionHeader
        eyebrow="Mission control"
        title="Preparation areas"
        trailing={
          <Button
            label="Manage"
            icon="tune-variant"
            variant="ghost"
            size="sm"
            onPress={() => router.push({ pathname: '/trips/[tripId]/sections', params: { tripId: trip.id } })}
            testID="manage-sections"
          />
        }
      />

      {checklist.status === 'error' ? (
        <ErrorState message={checklist.error ?? 'Could not load this checklist.'} onRetry={() => void load(owner)} />
      ) : checklist.status !== 'ready' ? (
        <LoadingState label="Loading checklist…" />
      ) : checklist.sections.length === 0 ? (
        <EmptyState
          icon="clipboard-plus-outline"
          title="No checklist sections"
          message="Add a section or copy tasks from a template."
          action={{
            label: 'Add a section',
            icon: 'plus',
            onPress: () => router.push({ pathname: '/trips/[tripId]/sections', params: { tripId: trip.id } }),
          }}
        />
      ) : (
        <View style={styles.sections}>
          {checklist.sections.map((section, index) => (
            <Animated.View key={section.id} entering={FadeInDown.delay(index * 40).duration(240)}>
              <SectionCard tripId={trip.id} section={section} tasks={grouped.get(section.id) ?? []} />
            </Animated.View>
          ))}
        </View>
      )}

      <View style={styles.tools}>
        <AppText variant="label" tone="textMuted">
          Checklist tools
        </AppText>
        <View style={styles.toolRow}>
          <Button
            label="Add from template"
            icon="playlist-plus"
            variant="secondary"
            size="sm"
            onPress={() => router.push({ pathname: '/trips/[tripId]/templates', params: { tripId: trip.id } })}
            testID="apply-templates"
          />
          <Button
            label="Save as template"
            icon="content-save-all-outline"
            variant="secondary"
            size="sm"
            disabled={checklist.tasks.length === 0}
            onPress={() => router.push({ pathname: '/trips/[tripId]/save-template', params: { tripId: trip.id } })}
            testID="save-as-template"
          />
        </View>
      </View>

      {sheet}
    </Screen>
  );
}

export function TripDashboard({ tripId }: { tripId: string | undefined }) {
  const { trip, status, error, reload } = useTrip(tripId);

  if (trip) return <DashboardBody trip={trip} />;

  return (
    <Screen bottomInset>
      <ScreenHeader showBack title="Trip" />
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
  hero: {
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.backgroundElevated,
    overflow: 'hidden',
  },
  heroContent: {
    padding: spacing.xl,
    gap: spacing.lg,
  },
  sections: {
    gap: spacing.md,
  },
  tools: {
    gap: spacing.sm,
    paddingTop: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  toolRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
});
