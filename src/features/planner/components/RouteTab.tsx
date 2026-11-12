import { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText, Button, EmptyState, Icon, IconButton, Notice } from '@/components/ui';
import { toErrorMessage } from '@/lib/errors';
import { colors, radii, spacing } from '@/theme';

import { routeIndexForUpcoming } from '../companion';
import { siblingMap } from '../dragDrop';
import { ancestorIds, buildTree, routeNodes, visibleRows, type PlanNode, type TripPlan } from '../model';
import { usePlannerStore } from '../plannerStore';
import { DraggableList, type DraggableItem, type ScrollBinding } from './DraggableList';

const trail = (plan: TripPlan, node: PlanNode) =>
  ancestorIds(plan.nodes, node.id)
    .reverse()
    .map((id) => plan.nodes.find((n) => n.id === id)?.name)
    .filter(Boolean)
    .join(' › ');

type StopRow = DraggableItem & { node: PlanNode; number: number };

/**
 * The route: an explicit, ordered list of stops chosen from the plan, reordered
 * by dragging. Stops renumber after every move and the order is saved on the
 * device. It is never derived from — and never changes — how places are nested
 * or the Navigation list.
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
  const stops = useMemo(() => routeNodes(plan), [plan]);
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
  const order = stops.map((n) => n.id);
  const moveTo = (id: string, upcomingIndex: number) =>
    run(() => store().moveRouteStop(tripId, id, routeIndexForUpcoming(order, visited, id, upcomingIndex)));
  const setVisited = (node: PlanNode, value: boolean) =>
    run(async () => {
      await store().setVisited(tripId, node.id, value);
      setUndo(value ? { id: node.id, name: node.name } : null);
    });
  const siblings = useMemo(() => siblingMap(rows), [rows]);
  const onRoute = new Set(stops.map((n) => n.id));
  const candidates = visibleRows(buildTree(plan.nodes), new Set(plan.nodes.map((n) => n.id))).filter(
    (row) => !onRoute.has(row.node.id),
  );

  function run(fn: () => Promise<unknown>) {
    setError(null);
    fn().catch((err: unknown) => setError(toErrorMessage(err, 'Could not change the route.')));
  }
  const subtreeOf = useCallback((id: string) => [id], []);
  const canPlaceIn = useCallback((_: string, parentId: string | null) => parentId === null, []);

  return (
    <View style={styles.container} testID="plan-route">
      <AppText variant="caption" tone="textMuted">
        Your route is separate from how places are organised. Drag stops into travel order — nesting, moving or
        promoting places never changes it.
      </AppText>
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
          message={plan.nodes.length === 0 ? 'Add destinations to your plan first.' : 'Add stops from your plan below.'}
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
            return (
              <View style={[styles.stop, done && styles.stopDone]} testID={`route-stop-${row.node.name}`}>
                <View style={[styles.number, done && styles.numberDone]}>
                  <AppText variant="captionStrong" tone={done ? 'textOnAccent' : 'textOnAccent'} testID={`route-number-${row.node.name}`}>
                    {row.number}
                  </AppText>
                </View>
                <View style={styles.flex}>
                  <AppText variant="bodyStrong" tone={done ? 'textSecondary' : 'textPrimary'} numberOfLines={1}>
                    {row.node.name}
                  </AppText>
                  {row.node.parentId || done ? (
                    <AppText variant="caption" tone="textMuted" numberOfLines={1}>
                      {[done ? 'Visited' : '', row.node.parentId ? `In ${trail(plan, row.node)}` : ''].filter(Boolean).join(' · ')}
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
            );
          }}
        />
      )}

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
  stop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 56,
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
