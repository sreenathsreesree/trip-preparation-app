import { router } from 'expo-router';
import { useState } from 'react';

import { ActionSheet, type SheetAction } from '@/components/ui';
import { confirmAction } from '@/lib/confirm';
import { toErrorMessage } from '@/lib/errors';
import { successFeedback } from '@/lib/haptics';

import { useChecklistStore } from '../../preparation/checklistStore';
import { tripOwner } from '../../preparation/model';
import { formatRoute, getTripLifecycle, type TripSummary } from '../model';
import { useTripsStore } from '../tripsStore';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export interface TripActionsOptions {
  /** Called after the trip has been deleted (e.g. to leave its dashboard). */
  onDeleted?: () => void;
}

/**
 * Trip management actions in a bottom sheet: edit, duplicate, complete/reopen,
 * archive/restore and delete (with an explicit confirmation listing what is lost).
 * Returns the sheet element to render plus any error from the last action.
 */
export function useTripActions(trip: TripSummary | undefined, options: TripActionsOptions = {}) {
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const store = useTripsStore.getState;

  async function run(action: () => Promise<void>, fallback: string) {
    setError(null);
    setBusy(true);
    try {
      await action();
    } catch (err) {
      setError(toErrorMessage(err, fallback));
    } finally {
      setBusy(false);
    }
  }

  async function deleteTrip(target: TripSummary) {
    const impact = await store().deletionImpact(target.id);
    const confirmed = await confirmAction({
      title: `Delete "${target.name}"?`,
      message:
        `This permanently removes the trip from this device, including ${plural(impact.destinations, 'destination')}, ` +
        `${plural(impact.travellers, 'traveller')} and ${plural(impact.tasks, 'checklist task')}. ` +
        'This cannot be undone. Archive the trip instead if you might need it again.',
      confirmLabel: 'Delete permanently',
      destructive: true,
    });
    if (!confirmed) return;
    await store().remove(target.id);
    useChecklistStore.getState().forget(tripOwner(target.id));
    options.onDeleted?.();
  }

  const actions: SheetAction[] = [];
  if (trip) {
    const lifecycle = getTripLifecycle(trip);
    actions.push(
      {
        key: 'edit',
        label: 'Edit trip details',
        icon: 'pencil-outline',
        description: 'Name, destinations, dates, travellers, transport',
        onPress: () => router.push({ pathname: '/trips/[tripId]/edit', params: { tripId: trip.id } }),
      },
      {
        key: 'duplicate',
        label: 'Duplicate trip',
        icon: 'content-copy',
        description: 'Copies details and checklist, with nothing ticked',
        onPress: () =>
          void run(async () => {
            const copy = await store().duplicate(trip.id);
            successFeedback();
            router.push({ pathname: '/trips/[tripId]', params: { tripId: copy.id } });
          }, 'Could not duplicate the trip.'),
      },
      lifecycle === 'completed' || trip.completedAt
        ? {
            key: 'reopen',
            label: 'Reopen trip',
            icon: 'restore',
            description: 'Move it back to active trips',
            onPress: () => void run(() => store().setCompleted(trip.id, false), 'Could not reopen the trip.'),
          }
        : {
            key: 'complete',
            label: 'Mark as completed',
            icon: 'flag-checkered',
            description: 'Moves it to completed trips; you can reopen it',
            onPress: () =>
              void run(async () => {
                await store().setCompleted(trip.id, true);
                successFeedback();
              }, 'Could not complete the trip.'),
          },
      trip.archivedAt
        ? {
            key: 'restore',
            label: 'Restore from archive',
            icon: 'archive-arrow-up-outline',
            onPress: () => void run(() => store().setArchived(trip.id, false), 'Could not restore the trip.'),
          }
        : {
            key: 'archive',
            label: 'Archive trip',
            icon: 'archive-arrow-down-outline',
            description: 'Hides it from active lists; restore any time',
            onPress: () => void run(() => store().setArchived(trip.id, true), 'Could not archive the trip.'),
          },
      {
        key: 'delete',
        label: 'Delete trip…',
        icon: 'trash-can-outline',
        description: 'Asks for confirmation first',
        destructive: true,
        onPress: () => void run(() => deleteTrip(trip), 'Could not delete the trip.'),
      },
    );
  }

  const sheet = trip ? (
    <ActionSheet
      visible={visible}
      title={trip.name}
      subtitle={formatRoute(trip.destinations)}
      actions={actions}
      onClose={() => setVisible(false)}
      testID="trip-actions-sheet"
    />
  ) : null;

  return {
    openActions: () => {
      setError(null);
      setVisible(true);
    },
    sheet,
    error,
    busy,
    clearError: () => setError(null),
  };
}
