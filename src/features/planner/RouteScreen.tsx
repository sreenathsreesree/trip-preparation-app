import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Screen } from '@/components/layout/Screen';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { AppText, Button, EmptyState, IconButton, LoadingState, Notice, ReorderControls } from '@/components/ui';
import { toErrorMessage } from '@/lib/errors';
import { colors, radii, spacing } from '@/theme';

import { useTrip } from '../trips/hooks';
import { ancestorIds, buildTree, routeNodes, visibleRows, type PlanNode, type TripPlan } from './model';
import { usePlannerStore, useTripPlan } from './plannerStore';

const trail = (plan: TripPlan, node: PlanNode) =>
  ancestorIds(plan.nodes, node.id)
    .reverse()
    .map((id) => plan.nodes.find((n) => n.id === id)?.name)
    .filter(Boolean)
    .join(' › ');

/**
 * The route: an explicit, ordered list of stops chosen from the plan. It is
 * never derived from how places are nested.
 */
export function RouteScreen({ tripId }: { tripId: string | undefined }) {
  const { trip } = useTrip(tripId);
  const state = useTripPlan(tripId);
  const [error, setError] = useState<string | null>(null);
  useFocusEffect(
    useCallback(() => {
      if (tripId) void usePlannerStore.getState().load(tripId);
    }, [tripId]),
  );

  const plan = state.plan;
  if (!tripId || !plan) {
    return (
      <Screen bottomInset>
        <ScreenHeader showBack title="Route" />
        <LoadingState label="Loading route…" />
      </Screen>
    );
  }
  const stops = routeNodes(plan);
  const onRoute = new Set(stops.map((n) => n.id));
  const candidates = visibleRows(buildTree(plan.nodes), new Set(plan.nodes.map((n) => n.id))).filter(
    (row) => !onRoute.has(row.node.id),
  );
  const run = (fn: () => Promise<unknown>) => {
    setError(null);
    fn().catch((err: unknown) => setError(toErrorMessage(err, 'Could not change the route.')));
  };
  const store = usePlannerStore.getState;

  return (
    <Screen testID="plan-route" bottomInset>
      <ScreenHeader
        showBack
        eyebrow={trip?.name}
        title="Route"
        subtitle={stops.length === 0 ? 'No stops yet' : `${stops.length} ${stops.length === 1 ? 'stop' : 'stops'}, in travel order`}
      />
      <AppText variant="caption" tone="textMuted">
        Your route is separate from how places are organised. Only the stops below, in this order, are your route —
        nesting, moving or promoting places never changes it.
      </AppText>
      {error ? <Notice tone="danger" title="Not changed" message={error} /> : null}

      {stops.length === 0 ? (
        <EmptyState
          icon="map-marker-path"
          title="No route stops"
          message={plan.nodes.length === 0 ? 'Add destinations to your plan first.' : 'Add stops from your plan below.'}
          testID="route-empty"
        />
      ) : (
        <View style={styles.list}>
          {stops.map((node, index) => (
            <View key={node.id} style={styles.stop} testID={`route-stop-${node.name}`}>
              <View style={styles.number}>
                <AppText variant="captionStrong" tone="textOnAccent">
                  {index + 1}
                </AppText>
              </View>
              <View style={styles.flex}>
                <AppText variant="bodyStrong" numberOfLines={1}>
                  {node.name}
                </AppText>
                {node.parentId ? (
                  <AppText variant="caption" tone="textMuted" numberOfLines={1}>
                    In {trail(plan, node)}
                  </AppText>
                ) : null}
              </View>
              <ReorderControls
                label={node.name}
                canMoveUp={index > 0}
                canMoveDown={index < stops.length - 1}
                onMove={(direction) => run(() => store().moveRouteStop(tripId, node.id, index + direction))}
                testID={`route-move-${node.name}`}
              />
              <IconButton
                icon="close"
                accessibilityLabel={`Remove ${node.name} from the route`}
                onPress={() => run(() => store().removeRouteStop(tripId, node.id))}
                testID={`route-remove-${node.name}`}
              />
            </View>
          ))}
        </View>
      )}

      {candidates.length > 0 ? (
        <View style={styles.list}>
          <AppText variant="label" tone="textMuted">
            Add stops from your plan
          </AppText>
          {candidates.map((row) => (
            <View key={row.node.id} style={[styles.candidate, { marginLeft: Math.min(row.depth, 5) * 16 }]}>
              <AppText variant={row.depth === 0 ? 'bodyStrong' : 'body'} style={styles.flex} numberOfLines={1}>
                {row.node.name}
              </AppText>
              <Button
                label="Add"
                icon="plus"
                size="sm"
                variant="ghost"
                onPress={() => run(() => store().addRouteStop(tripId, row.node.id))}
                testID={`route-add-${row.node.name}`}
              />
            </View>
          ))}
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: spacing.sm,
  },
  stop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 56,
    paddingLeft: spacing.md,
    paddingRight: spacing.xs,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.accentBorder,
    backgroundColor: colors.surface,
  },
  number: {
    width: 26,
    height: 26,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
  },
  candidate: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 48,
    paddingLeft: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  flex: {
    flex: 1,
    minWidth: 0,
  },
});
