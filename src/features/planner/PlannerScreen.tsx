import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Screen } from '@/components/layout/Screen';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { AppText, Button, EmptyState, ErrorState, LoadingState, Notice } from '@/components/ui';
import { toErrorMessage } from '@/lib/errors';
import { spacing } from '@/theme';

import { useTrip } from '../trips/hooks';
import type { TripSummary } from '../trips/model';
import { useNodeActions } from './components/NodeActions';
import { PlanRow } from './components/PlanRow';
import { buildTree, childrenOf, rowInfo, visibleRows } from './model';
import { usePlannerStore, useTripPlan } from './plannerStore';

function PlannerBody({ trip }: { trip: TripSummary }) {
  const state = useTripPlan(trip.id);
  const plan = state.plan;
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [reorder, setReorder] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const actions = useNodeActions(trip.id, plan);

  useFocusEffect(
    useCallback(() => {
      void usePlannerStore.getState().load(trip.id);
      void usePlannerStore.getState().markOpened(trip.id);
    }, [trip.id]),
  );

  const tree = useMemo(() => buildTree(plan?.nodes ?? []), [plan]);
  // Everything with children starts expanded; the user collapses what they don't need.
  const expanded = useMemo(
    () => new Set((plan?.nodes ?? []).filter((n) => !collapsed.has(n.id)).map((n) => n.id)),
    [plan, collapsed],
  );
  const rows = visibleRows(tree, expanded);
  const info = useMemo(() => rowInfo(tree), [tree]);
  const routeNumber = new Map((plan?.route ?? []).map((stop, index) => [stop.nodeId, index + 1]));
  const mains = tree.length;
  const total = plan?.nodes.length ?? 0;
  const hasNested = total > mains;

  const toggle = (id: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const move = (id: string, direction: -1 | 1) => {
    if (!plan) return;
    const node = plan.nodes.find((n) => n.id === id);
    if (!node) return;
    const siblings = childrenOf(plan.nodes, node.parentId);
    const index = siblings.findIndex((n) => n.id === id);
    setError(null);
    usePlannerStore
      .getState()
      .moveNode(trip.id, id, { parentId: node.parentId, index: index + direction })
      .catch((err: unknown) => setError(toErrorMessage(err, 'Could not move it.')));
  };

  const addDestination = () => router.push({ pathname: '/trips/[tripId]/plan/add', params: { tripId: trip.id } });

  return (
    <Screen testID="planner-screen" bottomInset onRefresh={() => void usePlannerStore.getState().load(trip.id)}>
      <ScreenHeader
        showBack
        eyebrow={trip.name}
        title="Destinations"
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
          <View style={styles.toolbar}>
            <Button label="Add destination" icon="map-marker-plus-outline" onPress={addDestination} fullWidth testID="planner-add" />
            <Button
              label={
                plan.route.length === 0
                  ? 'Choose route stops'
                  : `Route · ${plan.route.length} ${plan.route.length === 1 ? 'stop' : 'stops'}`
              }
              icon="map-marker-path"
              variant="secondary"
              size="sm"
              onPress={() => router.push({ pathname: '/trips/[tripId]/plan/route', params: { tripId: trip.id } })}
              fullWidth
              testID="planner-route"
            />
          </View>

          {error || actions.error ? <Notice tone="danger" title="Not changed" message={error ?? actions.error ?? ''} /> : null}

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
                {hasNested ? (
                  <Button
                    label={collapsed.size > 0 ? 'Expand all' : 'Collapse all'}
                    variant="ghost"
                    size="sm"
                    onPress={() =>
                      setCollapsed(collapsed.size > 0 ? new Set() : new Set(plan.nodes.map((n) => n.id)))
                    }
                    testID="planner-expand-all"
                  />
                ) : null}
                <Button
                  label={reorder ? 'Done' : 'Reorder'}
                  icon={reorder ? 'check' : 'swap-vertical'}
                  variant="ghost"
                  size="sm"
                  onPress={() => setReorder((v) => !v)}
                  testID="planner-reorder"
                />
              </View>
              <View style={styles.list}>
                {rows.map((item) => {
                  const { index, siblings, descendants } = info.get(item.node.id) ?? { index: 0, siblings: 1, descendants: 0 };
                  return (
                    <PlanRow
                      key={item.node.id}
                      item={item}
                      descendants={descendants}
                      expanded={expanded.has(item.node.id)}
                      routeNumber={routeNumber.get(item.node.id) ?? null}
                      reorder={reorder}
                      canMoveUp={index > 0}
                      canMoveDown={index < siblings - 1}
                      onToggle={() => toggle(item.node.id)}
                      onOpen={() =>
                        router.push({
                          pathname: '/trips/[tripId]/plan/place/[nodeId]',
                          params: { tripId: trip.id, nodeId: item.node.id },
                        })
                      }
                      onMore={() => actions.open(item.node.id)}
                      onMove={(direction) => move(item.node.id, direction)}
                    />
                  );
                })}
              </View>
              <AppText variant="caption" tone="textMuted">
                Main destinations are this trip’s destinations everywhere in the app. Places inside them are for
                organising only — numbered badges show your route stops, which you choose separately.
              </AppText>
            </>
          )}
        </>
      )}
      {actions.sheet}
    </Screen>
  );
}

export function PlannerScreen({ tripId }: { tripId: string | undefined }) {
  const { trip, status, error, reload } = useTrip(tripId);
  if (trip) return <PlannerBody trip={trip} />;
  return (
    <Screen bottomInset>
      <ScreenHeader showBack title="Destinations" />
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
  toolbar: {
    gap: spacing.sm,
  },
  grow: {
    flex: 1,
  },
  listHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  list: {
    gap: spacing.sm,
  },
});
