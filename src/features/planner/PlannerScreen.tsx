import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { StyleSheet, View, type ScrollViewInstance } from 'react-native';

import { Screen } from '@/components/layout/Screen';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { AppText, Button, EmptyState, ErrorState, LoadingState, Notice, SegmentedControl, type SegmentOption } from '@/components/ui';
import { toErrorMessage } from '@/lib/errors';
import { spacing } from '@/theme';

import { useTrip } from '../trips/hooks';
import type { TripSummary } from '../trips/model';
import type { ScrollBinding } from './components/DraggableList';
import { useNodeActions } from './components/NodeActions';
import { PlanTree } from './components/PlanTree';
import { NavigationTab } from './components/NavigationTab';
import { RouteTab } from './components/RouteTab';
import { buildTree, type TripPlan } from './model';
import { usePlannerStore, useTripPlan } from './plannerStore';

export type PlannerTab = 'destinations' | 'route' | 'navigation';
export const isPlannerTab = (v: unknown): v is PlannerTab => v === 'destinations' || v === 'route' || v === 'navigation';

function PlannerBody({ trip, initialTab }: { trip: TripSummary; initialTab: PlannerTab }) {
  const state = useTripPlan(trip.id);
  const plan = state.plan;
  const [tab, setTab] = useState<PlannerTab>(initialTab);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [toggled, setToggled] = useState<ReadonlyMap<string, boolean>>(() => new Map());
  const actions = useNodeActions(trip.id, plan);
  const scrollRef = useRef<ScrollViewInstance | null>(null);
  const scrollOffset = useRef(0);
  const scroll = useMemo<ScrollBinding>(() => ({ ref: scrollRef, offset: scrollOffset }), []);

  useFocusEffect(
    useCallback(() => {
      void usePlannerStore.getState().load(trip.id);
      void usePlannerStore.getState().markOpened(trip.id);
    }, [trip.id]),
  );

  const mains = useMemo(() => buildTree(plan?.nodes ?? []).length, [plan]);
  const total = plan?.nodes.length ?? 0;
  const routeNumber = useMemo(() => new Map((plan?.route ?? []).map((stop, index) => [stop.nodeId, index + 1])), [plan]);
  const visited = useMemo(
    () => new Set((state.companion?.profiles ?? []).filter((p) => p.visitStatus === 'visited').map((p) => p.nodeId)),
    [state.companion],
  );
  const inNavigation = useMemo(() => new Set((state.companion?.navigation ?? []).map((i) => i.nodeId)), [state.companion]);
  // "Collapse all" when any place with children is open, otherwise "Expand all".
  const allCollapsed = useMemo(
    () =>
      (plan?.nodes ?? []).every(
        (n) => !(plan?.nodes ?? []).some((c) => c.parentId === n.id) || toggled.get(n.id) === false,
      ),
    [plan, toggled],
  );

  const move = (id: string, target: { parentId: string | null; index: number }) => {
    setError(null);
    usePlannerStore
      .getState()
      .moveNode(trip.id, id, target)
      .catch((err: unknown) => setError(toErrorMessage(err, 'Could not move it.')));
  };

  const addDestination = () => router.push({ pathname: '/trips/[tripId]/plan/add', params: { tripId: trip.id } });

  const tabs: SegmentOption<PlannerTab>[] = [
    { value: 'destinations', label: 'Destinations' },
    { value: 'route', label: `Route${plan && plan.route.length ? ` ${plan.route.length}` : ''}` },
    { value: 'navigation', label: 'Navigation' },
  ];

  const destinations = (current: TripPlan) => (
    <>
      <Button label="Add destination" icon="map-marker-plus-outline" onPress={addDestination} fullWidth testID="planner-add" />
      <Button
        label="Import plan from PDF"
        icon="file-pdf-box"
        variant="secondary"
        onPress={() => router.push({ pathname: '/trips/[tripId]/plan/import', params: { tripId: trip.id } })}
        fullWidth
        testID="planner-import-pdf"
      />
      {error || actions.error ? <Notice tone="danger" title="Not changed" message={error ?? actions.error ?? ''} /> : null}
      {actions.notice ? <Notice tone="success" title={actions.notice} testID="planner-notice" /> : null}
      {total === 0 ? (
        <EmptyState
          icon="map-marker-plus-outline"
          title="No destinations yet"
          message="Add the main places of this trip — a city, a region, a national park. Then add attractions, viewpoints or stays inside them, and choose which ones make up your route."
          action={{ label: 'Add destination', icon: 'plus', onPress: addDestination }}
          testID="planner-empty"
        />
      ) : (
        <>
          <View style={styles.listHeader}>
            <AppText variant="label" tone="textMuted" style={styles.grow}>
              Your plan
            </AppText>
            <Button
              label="Saved & compare"
              icon="compare-horizontal"
              variant="ghost"
              size="sm"
              onPress={() => router.push({ pathname: '/trips/[tripId]/plan/compare', params: { tripId: trip.id } })}
              testID="planner-compare"
            />
            {total > mains ? (
              <Button
                label={allCollapsed ? 'Expand all' : 'Collapse all'}
                variant="ghost"
                size="sm"
                onPress={() =>
                  setToggled(
                    new Map(
                      current.nodes.filter((n) => current.nodes.some((c) => c.parentId === n.id)).map((n) => [n.id, allCollapsed]),
                    ),
                  )
                }
                testID="planner-expand-all"
              />
            ) : null}
          </View>
          <PlanTree
            tripId={trip.id}
            plan={current}
            routeNumber={routeNumber}
            visited={visited}
            inNavigation={inNavigation}
            scroll={scroll}
            onDragActiveChange={setDragging}
            onMove={move}
            onMore={(id) => actions.open(id)}
            expansion={[toggled, (update) => setToggled((value) => update(value))]}
            testID="planner-tree"
          />
          <AppText variant="caption" tone="textMuted">
            Drag the handle to reorder, drop onto a place to put it inside, or next to a main destination to make it
            one. Expand a place to add places inside it. Organising here never changes your route or Navigation.
          </AppText>
        </>
      )}
    </>
  );

  return (
    <Screen
      testID="planner-screen"
      bottomInset
      onRefresh={() => void usePlannerStore.getState().load(trip.id)}
      scrollRef={scrollRef}
      onScroll={(y) => {
        scrollOffset.current = y;
      }}
      scrollEnabled={!dragging}
    >
      <ScreenHeader
        showBack
        eyebrow={trip.name}
        title="Destination planner"
        subtitle={
          plan
            ? total === 0
              ? 'Nothing planned yet'
              : `${mains} main ${mains === 1 ? 'destination' : 'destinations'} · ${total} ${total === 1 ? 'place' : 'places'} · ${plan.route.length} route ${plan.route.length === 1 ? 'stop' : 'stops'}`
            : undefined
        }
      />

      {state.status === 'error' && !plan ? (
        <ErrorState message={state.error ?? 'Could not load the plan.'} onRetry={() => void usePlannerStore.getState().load(trip.id)} />
      ) : !plan ? (
        <LoadingState label="Loading plan…" />
      ) : (
        <>
          <SegmentedControl options={tabs} value={tab} onChange={setTab} accessibilityLabel="Planner sections" />
          {tab === 'route' ? (
            <RouteTab tripId={trip.id} plan={plan} visited={visited} scroll={scroll} onDragActiveChange={setDragging} />
          ) : tab === 'navigation' ? (
            <NavigationTab
              tripId={trip.id}
              plan={plan}
              companion={state.companion}
              visited={visited}
              scroll={scroll}
              onDragActiveChange={setDragging}
            />
          ) : (
            destinations(plan)
          )}
        </>
      )}
      {actions.sheet}
    </Screen>
  );
}

export function PlannerScreen({ tripId, initialTab }: { tripId: string | undefined; initialTab?: string }) {
  const { trip, status, error, reload } = useTrip(tripId);
  if (trip) return <PlannerBody trip={trip} initialTab={isPlannerTab(initialTab) ? initialTab : 'destinations'} />;
  return (
    <Screen bottomInset>
      <ScreenHeader showBack title="Destination planner" />
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
  listHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  grow: {
    flex: 1,
  },
});
