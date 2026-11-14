import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Screen } from '@/components/layout/Screen';
import { goBackOrHome, ScreenHeader } from '@/components/layout/ScreenHeader';
import { AppText, Button, EmptyState, LoadingState, Notice, OptionTile } from '@/components/ui';
import { todayISO } from '@/lib/dates';
import { toErrorMessage } from '@/lib/errors';
import { successFeedback } from '@/lib/haptics';
import { spacing } from '@/theme';

import { PlacePicker, PlaceRow } from '../places/components/PlacePicker';
import { placesProvider } from '../places/config';
import { toPlaceInput } from '../places/placeInput';
import type { PlaceDetails } from '../places/provider';
import { findSamePlace, resolveShare, type ResolvedShare } from '../places/sharedLocation';
import { usePlannerStore, useTripPlan } from '../planner/plannerStore';
import { getTripLifecycle, getTripPhase } from '../trips/model';
import { useTripsStore } from '../trips/tripsStore';

export type ShareTarget = 'route' | 'main' | 'child';

const TARGETS: { value: ShareTarget; label: string; icon: 'map-marker-path' | 'map-marker-radius' | 'subdirectory-arrow-right' }[] = [
  { value: 'route', label: 'Route stop', icon: 'map-marker-path' },
  { value: 'main', label: 'Main destination', icon: 'map-marker-radius' },
  { value: 'child', label: 'Place inside a destination', icon: 'subdirectory-arrow-right' },
];

/**
 * "Add to a trip" for a place shared from Google Maps (or any app). Shows what
 * was understood, lets the user pick the trip and how to add it, warns about
 * duplicates, and saves only when the user taps Add.
 */
export function ShareToTripScreen({ text, subject }: { text: string; subject: string | null }) {
  const [resolved, setResolved] = useState<ResolvedShare | null>(null);
  const [place, setPlace] = useState<PlaceDetails | null>(null);
  const trips = useTripsStore((s) => s.trips);
  const tripsStatus = useTripsStore((s) => s.status);
  const [tripId, setTripId] = useState<string | null>(null);
  const [target, setTarget] = useState<ShareTarget>('route');
  const [parentId, setParentId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (tripsStatus === 'idle') void useTripsStore.getState().load();
  }, [tripsStatus]);

  useEffect(() => {
    const controller = new AbortController();
    resolveShare(text, { provider: placesProvider, signal: controller.signal }, subject)
      .then((r) => {
        if (controller.signal.aborted) return;
        setResolved(r);
        if (r.status === 'located') setPlace(r.place);
      })
      .catch(() => !controller.signal.aborted && setResolved({ status: 'unresolved', reason: 'Something went wrong reading the shared place.' }));
    return () => controller.abort();
  }, [text, subject]);

  const today = todayISO();
  const choices = useMemo(
    () =>
      trips
        .filter((t) => getTripLifecycle(t) === 'active')
        .sort((a, b) => Number(getTripPhase(a, today) === 'ended') - Number(getTripPhase(b, today) === 'ended') || a.startDate.localeCompare(b.startDate)),
    [trips, today],
  );
  const selectedTrip = tripId ?? choices[0]?.id ?? null;
  const planState = useTripPlan(selectedTrip ?? undefined);
  useEffect(() => {
    if (selectedTrip && planState.status === 'idle') void usePlannerStore.getState().load(selectedTrip);
  }, [selectedTrip, planState.status]);

  const nodes = planState.plan?.nodes ?? [];
  const mains = nodes.filter((n) => n.parentId === null);
  const duplicate = place ? findSamePlace(nodes, place) : null;
  const effectiveParent = target === 'child' ? (parentId ?? mains[0]?.id ?? null) : null;

  async function save() {
    if (!place || !selectedTrip) return;
    setSaving(true);
    setError(null);
    try {
      const result = await usePlannerStore.getState().addNode(selectedTrip, {
        parentId: effectiveParent,
        name: place.name,
        notes: '',
        addToRoute: target === 'route',
        place: toPlaceInput(place),
      });
      const nodeId = result.node.id;
      if (result.status === 'added') successFeedback();
      router.replace({ pathname: '/trips/[tripId]/plan/place/[nodeId]', params: { tripId: selectedTrip, nodeId } });
    } catch (err) {
      setError(toErrorMessage(err, 'Could not add the place.'));
      setSaving(false);
    }
  }

  return (
    <Screen
      testID="share-place"
      footer={
        <View style={styles.footer}>
          <Button label="Cancel" variant="secondary" onPress={goBackOrHome} disabled={saving} />
          <Button
            label="Add to trip"
            icon="plus"
            onPress={() => void save()}
            loading={saving}
            disabled={!place || !selectedTrip || !!duplicate || (target === 'child' && !effectiveParent)}
            style={styles.primary}
            testID="share-place-save"
          />
        </View>
      }
    >
      <ScreenHeader showBack backIcon="close" eyebrow="Shared to Trip Prep" title="Add to a trip" />

      <View style={styles.group}>
        <AppText variant="label" tone="textSecondary">
          Place
        </AppText>
        {resolved === null ? <LoadingState label="Reading the shared place…" /> : null}
        {place ? (
          <View style={styles.group} testID="share-place-preview">
            <PlaceRow place={place} />
            {place.location ? (
              <AppText variant="caption" tone="textMuted" selectable>
                {place.location.latitude.toFixed(5)}, {place.location.longitude.toFixed(5)}
              </AppText>
            ) : null}
            {resolved?.status !== 'located' ? <Button label="Choose another" variant="ghost" size="sm" onPress={() => setPlace(null)} style={styles.left} /> : null}
          </View>
        ) : resolved?.status === 'choose' ? (
          <View style={styles.group} testID="share-place-choose">
            <AppText variant="caption" tone="textMuted">
              Which “{resolved.query}” did you mean?
            </AppText>
            {resolved.candidates.map((c) => (
              <PlaceRow key={c.providerPlaceId} place={c} onPress={() => setPlace(c)} trailing="Choose" testID="share-place-candidate" />
            ))}
          </View>
        ) : resolved?.status === 'unresolved' ? (
          <View style={styles.group}>
            <Notice tone="warning" title="Couldn’t find the place in what was shared" message={resolved.reason} testID="share-place-unresolved" />
            <PlacePicker onPick={setPlace} testID="share-place-picker" />
          </View>
        ) : null}
        <AppText variant="caption" tone="textMuted" numberOfLines={3} selectable>
          Shared: {text}
        </AppText>
      </View>

      <View style={styles.group}>
        <AppText variant="label" tone="textSecondary">
          Trip
        </AppText>
        {tripsStatus !== 'ready' ? (
          <LoadingState label="Loading trips…" />
        ) : choices.length === 0 ? (
          <EmptyState icon="bag-suitcase-outline" title="No active trips" message="Create a trip first, then share the place again." />
        ) : (
          <View style={styles.chips}>
            {choices.map((t) => (
              <OptionTile key={t.id} layout="chip" role="radio" label={t.name} icon="bag-suitcase-outline" selected={selectedTrip === t.id} onPress={() => setTripId(t.id)} testID="share-place-trip" />
            ))}
          </View>
        )}
      </View>

      <View style={styles.group}>
        <AppText variant="label" tone="textSecondary">
          Add as
        </AppText>
        <View style={styles.chips}>
          {TARGETS.map((t) => (
            <OptionTile key={t.value} layout="chip" role="radio" label={t.label} icon={t.icon} selected={target === t.value} onPress={() => setTarget(t.value)} testID={`share-place-as-${t.value}`} />
          ))}
        </View>
        {target === 'child' ? (
          mains.length === 0 ? (
            <AppText variant="caption" tone="warning">
              This trip has no destinations yet. Add it as a main destination instead.
            </AppText>
          ) : (
            <View style={styles.chips}>
              {mains.map((m) => (
                <OptionTile key={m.id} layout="chip" role="radio" label={`Inside ${m.name}`} icon="subdirectory-arrow-right" selected={effectiveParent === m.id} onPress={() => setParentId(m.id)} />
              ))}
            </View>
          )
        ) : (
          <AppText variant="caption" tone="textMuted">
            {target === 'route' ? 'A main destination, added as the last stop of the route.' : 'A main destination, kept off the route for now.'}
          </AppText>
        )}
      </View>

      {duplicate && selectedTrip ? (
        <Notice
          tone="warning"
          title="Already in this trip"
          message={`“${duplicate.name}” is already planned here, so it won’t be added twice.`}
          action={{ label: 'Open it', onPress: () => router.replace({ pathname: '/trips/[tripId]/plan/place/[nodeId]', params: { tripId: selectedTrip, nodeId: duplicate.id } }) }}
          testID="share-place-duplicate"
        />
      ) : null}
      {error ? <Notice tone="danger" title="Not added" message={error} /> : null}
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
  left: {
    alignSelf: 'flex-start',
  },
  group: {
    gap: spacing.sm,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
});
