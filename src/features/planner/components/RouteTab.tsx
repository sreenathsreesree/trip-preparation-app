import { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText, Button, EmptyState, Icon, IconButton, Notice } from '@/components/ui';
import { toErrorMessage } from '@/lib/errors';
import { colors, radii, spacing } from '@/theme';

import { routeIndexForUpcoming } from '../companion';
import { siblingMap } from '../dragDrop';
import { ancestorIds, buildTree, routeNodes, visibleRows, type PlanNode, type TripPlan } from '../model';
import { usePlannerStore } from '../plannerStore';
import { DestinationThumb } from '../../covers/DestinationThumb';
import { legText, RouteOverview, useRouteLegs } from '../../route/RouteOverview';
import { DraggableList, type DraggableItem, type ScrollBinding } from './DraggableList';

const trail = (plan: TripPlan, node: PlanNode) =>
  ancestorIds(plan.nodes, node.id)
    .reverse()
    .map((id) => plan.nodes.find((n) => n.id === id)?.name)
    .filter(Boolean)
    .join(' › ');

type StopRow = DraggableItem & { node: PlanNode; number: number };

/**
 * The route: the order in which the traveller visits the main destinations.
 * Only main destinations are listed and dragged here; places inside a
 * destination stay with it (shown on its card), even if an older version put
 * them on the route — nothing is removed. Road distance and driving time are
 * shown between consecutive stops, never estimated when unavailable. The
 * order is saved on the device and is separate from how places are nested.
 */
export function RouteTab({
  tripId,
  plan,
  visited,
  scroll,
  onDragActiveChange,
}: {
  tripId: string;
  plan: TripPlan;
  visited: ReadonlySet<string>;
  scroll?: ScrollBinding;
  onDragActiveChange?: (active: boolean) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [undo, setUndo] = useState<{ id: string; name: string } | null>(null);
  const [showCompleted, setShowCompleted] = useState(false);
  const store = usePlannerStore.getState;
  const allStops = useMemo(() => routeNodes(plan), [plan]);
  // Main destinations only; places inside one are shown on their destination's card.
  const stops = useMemo(() => allStops.filter((n) => n.parentId === null), [allStops]);
  const insideStops = useMemo(() => allStops.filter((n) => n.parentId !== null), [allStops]);
  const insideOf = (mainId: string) => insideStops.filter((c) => ancestorIds(plan.nodes, c.id).includes(mainId));
  const strays = insideStops.filter((c) => !stops.some((m) => ancestorIds(plan.nodes, c.id).includes(m.id)));
  const childCount = (id: string) => plan.nodes.filter((n) => n.parentId === id).length;
  const numbered = useMemo(() => stops.map((node, index) => ({ node, number: index + 1 })), [stops]);
  // Upcoming stops are dragged into order; visited ones wait in "Completed stops" and keep their places.
  const rows = useMemo<StopRow[]>(
    () =>
      numbered
        .filter(({ node }) => !visited.has(node.id))
        .map(({ node, number }) => ({
          id: node.id,
          parentId: null,
          depth: 0,
          expanded: false,
          hasChildren: false,
          draggable: true,
          node,
          number,
        })),
    [numbered, visited],
  );
  const completed = numbered.filter(({ node }) => visited.has(node.id));
  const upcoming = useMemo(() => rows.map((r) => r.node), [rows]);
  const legs = useRouteLegs(upcoming);
  const legFor = (index: number) => (legs.status === 'ready' ? legs.result.legs[index] : undefined);
  // The full saved order (including any places inside destinations, which keep their positions).
  const order = allStops.map((n) => n.id);
  const hidden = useMemo(() => new Set([...visited, ...insideStops.map((n) => n.id)]), [visited, insideStops]);
  const moveTo = (id: string, upcomingIndex: number) =>
    run(() => store().moveRouteStop(tripId, id, routeIndexForUpcoming(order, hidden, id, upcomingIndex)));
  const setVisited = (node: PlanNode, value: boolean) =>
    run(async () => {
      await store().setVisited(tripId, node.id, value);
      setUndo(value ? { id: node.id, name: node.name } : null);
    });
  const siblings = useMemo(() => siblingMap(rows), [rows]);
  const onRoute = new Set(stops.map((n) => n.id));
  const candidates = visibleRows(buildTree(plan.nodes), new Set<string>()).filter((row) => row.depth === 0 && !onRoute.has(row.node.id));

  function run(fn: () => Promise<unknown>) {
    setError(null);
    fn().catch((err: unknown) => setError(toErrorMessage(err, 'Could not change the route.')));
  }
  const subtreeOf = useCallback((id: string) => [id], []);
  const canPlaceIn = useCallback((_: string, parentId: string | null) => parentId === null, []);

  return (
    <View style={styles.container} testID="plan-route">
      <AppText variant="caption" tone="textMuted">
        The order you’ll visit your main destinations. Drag to reorder — places inside a destination travel with it.
      </AppText>
      {stops.length > 0 ? <RouteOverview tripId={tripId} order={order} upcoming={upcoming} visited={hidden} legs={legs} /> : null}
      {error ? <Notice tone="danger" title="Not changed" message={error} /> : null}
      {undo ? (
        <Notice
          tone="success"
          title={`${undo.name} marked as visited`}
          action={{ label: 'Undo', icon: 'undo', onPress: () => run(async () => {
            await store().setVisited(tripId, undo.id, false);
            setUndo(null);
          }) }}
          testID="route-undo-notice"
        />
      ) : null}
      {stops.length > 0 ? (
        <AppText variant="bodyStrong" testID="route-progress">
          {completed.length} of {stops.length} {stops.length === 1 ? 'stop' : 'stops'} visited
        </AppText>
      ) : null}

      {stops.length === 0 ? (
        <EmptyState
          icon="map-marker-path"
          title="No route stops"
          message={plan.nodes.length === 0 ? 'Add destinations to your plan first.' : 'Add your main destinations to the route below.'}
          testID="route-empty"
        />
      ) : (
        <DraggableList
          items={rows}
          allowNest={false}
          siblings={siblings}
          subtreeOf={subtreeOf}
          canPlaceIn={canPlaceIn}
          onDrop={(id, target) => moveTo(id, target.index)}
          onAccessibleMove={(id, action) => {
            const index = rows.findIndex((r) => r.id === id);
            if (action === 'up' && index > 0) moveTo(id, index - 1);
            if (action === 'down' && index < rows.length - 1) moveTo(id, index + 1);
          }}
          indent={0}
          scroll={scroll}
          onDragActiveChange={onDragActiveChange}
          testID="route-stops"
          renderItem={(row, context) => {
            const done = visited.has(row.node.id);
            const i = rows.findIndex((r) => r.id === row.id);
            const next = rows[i + 1];
            const leg = next ? legText(legFor(i), next.node.name) : null;
            const inside = insideOf(row.node.id);
            const region = [row.node.place?.district, row.node.place?.state].filter(Boolean).join(', ');
            const children = childCount(row.node.id);
            return (
              <View style={styles.stopWrap}>
              <View style={[styles.stop, done && styles.stopDone]} testID={`route-stop-${row.node.name}`}>
                <View style={[styles.number, done && styles.numberDone]}>
                  <AppText variant="captionStrong" tone="textOnAccent" testID={`route-number-${row.node.name}`}>
                    {row.number}
                  </AppText>
                </View>
                <DestinationThumb tripId={tripId} node={row.node} size={48} />
                <View style={styles.flex}>
                  <AppText variant="bodyStrong" tone={done ? 'textSecondary' : 'textPrimary'} numberOfLines={1}>
                    {row.node.name}
                  </AppText>
                  <AppText variant="caption" tone={row.node.place?.location ? 'textMuted' : 'warning'} numberOfLines={1}>
                    {[row.node.place?.location ? region : 'No location — set one to measure roads', children ? `${children} ${children === 1 ? 'place' : 'places'} inside` : ''].filter(Boolean).join(' · ') || ' '}
                  </AppText>
                  {inside.length ? (
                    <AppText variant="caption" tone="textMuted" numberOfLines={1}>
                      Also visiting: {inside.map((c) => c.name).join(', ')}
                    </AppText>
                  ) : null}
                </View>
                <IconButton
                  icon="check-circle-outline"
                  variant="plain"
                  size="sm"
                  tone="accent"
                  accessibilityLabel={`Mark ${row.node.name} as visited`}
                  onPress={() => setVisited(row.node, true)}
                  testID={`route-visit-${row.node.name}`}
                />
                <IconButton
                  icon="close"
                  variant="plain"
                  size="sm"
                  accessibilityLabel={`Remove ${row.node.name} from the route`}
                  onPress={() => run(() => store().removeRouteStop(tripId, row.node.id))}
                  testID={`route-remove-${row.node.name}`}
                />
                {context.handle}
              </View>
              {leg ? (
                <View style={styles.leg}>
                  <View style={styles.legLine} />
                  <Icon name={leg.tone === 'textSecondary' ? 'car-outline' : 'help-circle-outline'} size={16} tone={leg.tone === 'textSecondary' ? 'accent' : leg.tone} />
                  <AppText variant="caption" tone={leg.tone} numberOfLines={2} style={styles.flex} testID={`route-leg-${row.node.name}`}>
                    {leg.text}
                  </AppText>
                </View>
              ) : null}
              </View>
            );
          }}
        />
      )}

      {strays.length > 0 ? (
        <AppText variant="caption" tone="textMuted" testID="route-inside-strays">
          Also on your route from inside other destinations: {strays.map((c) => `${c.name} (in ${trail(plan, c)})`).join(', ')}. Add their destination to the route to see them in order.
        </AppText>
      ) : null}

      {completed.length > 0 ? (
        <View style={styles.list} testID="route-completed">
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: showCompleted }}
            onPress={() => setShowCompleted((v) => !v)}
            style={styles.completedHeader}
            testID="route-completed-toggle"
          >
            <Icon name="check-circle" tone="accent" size={18} />
            <AppText variant="label" tone="textSecondary" style={styles.flex}>
              Completed stops ({completed.length})
            </AppText>
            <Icon name={showCompleted ? 'chevron-up' : 'chevron-down'} tone="textMuted" />
          </Pressable>
          {showCompleted
            ? completed.map(({ node, number }) => (
                <View key={node.id} style={[styles.stop, styles.stopDone]} testID={`route-done-${node.name}`}>
                  <View style={[styles.number, styles.numberDone]}>
                    <Icon name="check-bold" size={14} tone="textOnAccent" />
                  </View>
                  <View style={styles.flex}>
                    <AppText variant="body" tone="textSecondary" numberOfLines={1}>
                      {node.name}
                    </AppText>
                    <AppText variant="caption" tone="textMuted">
                      Stop {number} · Visited
                    </AppText>
                  </View>
                  <Button
                    label="Upcoming"
                    icon="undo"
                    size="sm"
                    variant="ghost"
                    accessibilityHint={`Mark ${node.name} as upcoming again`}
                    onPress={() => setVisited(node, false)}
                    testID={`route-undo-${node.name}`}
                  />
                </View>
              ))
            : null}
        </View>
      ) : null}

      {candidates.length > 0 ? (
        <View style={styles.list}>
          <AppText variant="label" tone="textMuted">
            Main destinations not on the route
          </AppText>
          {candidates.map((row) => (
            <View key={row.node.id} style={styles.candidate}>
              <DestinationThumb tripId={tripId} node={row.node} size={36} />
              <AppText variant="bodyStrong" style={styles.flex} numberOfLines={1}>
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.lg,
  },
  list: {
    gap: spacing.sm,
  },
  stopWrap: {
    gap: spacing.xs,
  },
  leg: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingLeft: spacing.md + 6,
  },
  legLine: {
    width: 2,
    height: 22,
    borderRadius: 1,
    backgroundColor: colors.accentBorder,
  },
  stop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 64,
    paddingVertical: spacing.sm,
    paddingLeft: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.accentBorder,
    backgroundColor: colors.surface,
  },
  stopDone: {
    borderColor: colors.border,
    opacity: 0.8,
  },
  number: {
    width: 26,
    height: 26,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
  },
  numberDone: {
    backgroundColor: colors.neutral,
  },
  completedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 44,
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
