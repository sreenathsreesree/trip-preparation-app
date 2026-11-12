import * as Location from 'expo-location';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { ActionSheet } from '@/components/ui';

import type { ArrivalTarget } from '../arrival';
import { useArrivalStore } from '../arrivalStore';
import { routeNodes } from '../model';
import { usePlannerStore, useTripPlan } from '../plannerStore';

const RECHECK_MS = 60_000;
/** A fix older than this is not reused for the dwell timer. */
const FIX_MAX_AGE_MS = 10 * 60_000;

/**
 * Optional arrival prompts for the trip being planned (the one whose planner
 * was opened last). Watches location only while the feature is on, permission
 * was given, the app is in the foreground and there are upcoming places with
 * known coordinates; otherwise nothing runs. Asks before completing — it never
 * marks a place visited by itself. Background tracking is intentionally not
 * used (Android limits it and it costs battery); this is best effort.
 */
export function ArrivalWatcher() {
  const enabled = useArrivalStore((s) => s.settings.enabled);
  const loaded = useArrivalStore((s) => s.loaded);
  const permission = useArrivalStore((s) => s.permission);
  const prompt = useArrivalStore((s) => s.prompt);
  const tripId = usePlannerStore((s) => s.lastOpenedTripId);
  const state = useTripPlan(tripId ?? undefined);
  const [active, setActive] = useState(AppState.currentState === 'active');

  useEffect(() => {
    void useArrivalStore.getState().load();
    void usePlannerStore.getState().loadLastOpened();
    const subscription = AppState.addEventListener('change', (next) => setActive(next === 'active'));
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (enabled && tripId && state.status === 'idle') void usePlannerStore.getState().load(tripId);
  }, [enabled, tripId, state.status]);

  // Upcoming places on the route or in Navigation that have coordinates.
  const targets = useMemo<ArrivalTarget[]>(() => {
    const plan = state.plan;
    if (!plan) return [];
    const visited = new Set((state.companion?.profiles ?? []).filter((p) => p.visitStatus === 'visited').map((p) => p.nodeId));
    const ids = new Set([...routeNodes(plan).map((n) => n.id), ...(state.companion?.navigation ?? []).map((i) => i.nodeId)]);
    return plan.nodes.flatMap((node) =>
      ids.has(node.id) && !visited.has(node.id) && node.place?.location
        ? [{ nodeId: node.id, name: node.name, location: node.place.location }]
        : [],
    );
  }, [state.plan, state.companion]);

  const targetsRef = useRef(targets);
  useEffect(() => {
    targetsRef.current = targets;
  }, [targets]);

  const watching = loaded && enabled && permission === 'granted' && active && !!tripId && targets.length > 0;

  useEffect(() => {
    if (!watching || !tripId) return;
    let cancelled = false;
    let subscription: Location.LocationSubscription | null = null;
    const handle = (location: Location.LocationObject) => {
      useArrivalStore.getState().onFix(
        tripId,
        {
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
          accuracy: location.coords.accuracy ?? null,
          timestamp: location.timestamp,
        },
        targetsRef.current,
      );
    };
    Location.watchPositionAsync({ accuracy: Location.Accuracy.Balanced, distanceInterval: 20, timeInterval: RECHECK_MS }, handle)
      .then((sub) => {
        if (cancelled) sub.remove();
        else subscription = sub;
      })
      .catch(() => undefined);
    // Standing still produces no new fixes: re-check the last one so the dwell time can pass.
    const timer = setInterval(() => {
      const last = useArrivalStore.getState().lastFix;
      if (last && Date.now() - last.timestamp < FIX_MAX_AGE_MS) {
        useArrivalStore.getState().onFix(tripId, { ...last, timestamp: Date.now() }, targetsRef.current);
      }
    }, RECHECK_MS);
    return () => {
      cancelled = true;
      subscription?.remove();
      clearInterval(timer);
    };
  }, [watching, tripId]);

  return (
    <ActionSheet
      visible={prompt !== null}
      title={prompt ? `You've reached ${prompt.name}. Mark as visited?` : ''}
      subtitle="Arrival prompt · nothing changes unless you say yes"
      actions={[
        { key: 'arrival-yes', label: 'Yes, mark as visited', icon: 'check-circle', onPress: () => void useArrivalStore.getState().answer(true) },
        { key: 'arrival-no', label: 'Not yet', icon: 'clock-outline', onPress: () => void useArrivalStore.getState().answer(false) },
      ]}
      // The sheet closes before running a tapped action; dismissing (backdrop / back) is
      // deferred so an explicit "Yes" is never overridden by the close.
      onClose={() => setTimeout(() => void useArrivalStore.getState().answer(false), 0)}
      testID="arrival-prompt"
    />
  );
}
