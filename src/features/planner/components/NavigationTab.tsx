import { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText, Button, Card, EmptyState, Icon, IconButton, Notice, ProgressBar, ToggleRow } from '@/components/ui';
import { toErrorMessage } from '@/lib/errors';
import { colors, radii, spacing } from '@/theme';

import { journeyLegs, MAPS_LIMITS, navigateLink, type JourneyLeg, type MapsTarget } from '../../places/mapsLinks';
import { canTargetMapsApp, openInMapsApp, openMapsUrl } from '../../places/openMaps';
import { useArrivalStore } from '../arrivalStore';
import type { NavItem } from '../companion';
import type { TripCompanion } from '../companionRepository';
import { siblingMap } from '../dragDrop';
import { journeyStops, navigationOrder } from '../journey';
import { buildTree, canMove, subtreeIds, visibleRows, type PlanNode, type TreeNode, type TripPlan } from '../model';
import { usePlannerStore } from '../plannerStore';
import { DraggableList, type DraggableItem, type MoveAction, type ScrollBinding } from './DraggableList';
import { indentFor, PLAN_INDENT } from './PlanRow';

/** Every place a leg covers, start to destination. */
function legLabel(leg: JourneyLeg<PlanNode>): string {
  return [leg.from ? leg.from.name : 'Your location', ...leg.stops.map((s) => s.name)].join(' → ');
}

type NavRow = DraggableItem & { item: TreeNode<NavItem>; node: PlanNode };

const open = openMapsUrl;

/**
 * Navigation: the places the user wants Google Maps directions to. Its own
 * nesting and order (independent of the plan and the route); each place can be
 * navigated to on its own, or the whole journey (places not yet visited, in
 * this order) can be handed to Google Maps. Long journeys are split into legs
 * so no stop is ever dropped.
 */
export function NavigationTab({
  tripId,
  plan,
  companion,
  visited,
  scroll,
  onDragActiveChange,
}: {
  tripId: string;
  plan: TripPlan;
  companion: TripCompanion | null;
  visited: ReadonlySet<string>;
  scroll?: ScrollBinding;
  onDragActiveChange?: (active: boolean) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [showLegs, setShowLegs] = useState(false);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const [undo, setUndo] = useState<{ id: string; name: string } | null>(null);
  const arrival = useArrivalStore((s) => s.settings);
  const arrivalError = useArrivalStore((s) => s.error);
  const store = usePlannerStore.getState;
  const items = useMemo(() => companion?.navigation ?? [], [companion]);
  const nodes = useMemo(() => new Map(plan.nodes.map((n) => [n.id, n])), [plan.nodes]);
  const tree = useMemo(() => buildTree(items), [items]);

  // Journey order: depth-first through the Navigation list; visited places are left out.
  const ordered = useMemo(() => navigationOrder(items), [items]);
  const siblings = useMemo(() => siblingMap(ordered), [ordered]);
  const journey = journeyStops(ordered, nodes, visited);
  // The Google Maps app takes 10 named locations per link; browsers only 5 (see mapsLinks.ts).
  const [target, setTarget] = useState<MapsTarget>(canTargetMapsApp ? 'app' : 'browser');
  const [fellBack, setFellBack] = useState(false);
  const legs = journeyLegs(journey, target);
  const total = ordered.length;
  const done = ordered.filter((item) => visited.has(item.nodeId)).length;

  const expanded = useMemo(() => new Set(items.filter((i) => !collapsed.has(i.id)).map((i) => i.id)), [items, collapsed]);
  const rows = useMemo<NavRow[]>(
    () =>
      visibleRows(tree, expanded).flatMap((item) => {
        const node = nodes.get(item.node.nodeId);
        return node
          ? [
              {
                id: item.node.id,
                parentId: item.node.parentId,
                depth: item.depth,
                expanded: expanded.has(item.node.id),
                hasChildren: item.children.length > 0,
                draggable: true,
                item,
                node,
              },
            ]
          : [];
      }),
    [tree, expanded, nodes],
  );

  const inNavigation = new Set(items.map((i) => i.nodeId));
  const candidates = visibleRows(buildTree(plan.nodes), new Set(plan.nodes.map((n) => n.id))).filter((row) => !inNavigation.has(row.node.id));

  const run = (fn: () => Promise<unknown>, fallback: string) => {
    setError(null);
    fn().catch((err: unknown) => setError(toErrorMessage(err, fallback)));
  };
  const subtreeOf = useCallback((id: string) => subtreeIds(items, id), [items]);
  const canPlaceIn = useCallback((id: string, parentId: string | null) => canMove(items, id, parentId).ok, [items]);

  const accessibleMove = (id: string, action: MoveAction) => {
    const item = items.find((i) => i.id === id);
    if (!item) return;
    const list = siblings.get(item.parentId) ?? [];
    const index = list.indexOf(id);
    if (action === 'up' && index > 0) run(() => store().moveNavigation(tripId, id, { parentId: item.parentId, index: index - 1 }), 'Could not move it.');
    if (action === 'down' && index < list.length - 1)
      run(() => store().moveNavigation(tripId, id, { parentId: item.parentId, index: index + 1 }), 'Could not move it.');
    if (action === 'out' && item.parentId) {
      const parent = items.find((i) => i.id === item.parentId);
      if (!parent) return;
      const parentSiblings = siblings.get(parent.parentId) ?? [];
      run(
        () => store().moveNavigation(tripId, id, { parentId: parent.parentId, index: parentSiblings.indexOf(parent.id) + 1 }),
        'Could not move it.',
      );
    }
  };

  const toggleVisited = (node: PlanNode, value: boolean) =>
    run(async () => {
      await store().setVisited(tripId, node.id, value);
      setUndo(value ? { id: node.id, name: node.name } : null);
    }, 'Could not update the place.');
  const withoutLocation = ordered.filter((item) => {
    const node = nodes.get(item.nodeId);
    return node && !visited.has(node.id) && !node.place?.location;
  }).length;

  const openLeg = (leg: JourneyLeg<PlanNode>) =>
    run(async () => {
      if (target === 'browser') return open(leg.url);
      if (await openInMapsApp(leg.url)) return;
      // No Google Maps app: a browser keeps only 3 waypoints, so re-plan the
      // journey into browser-sized legs and let the user open them in order.
      setTarget('browser');
      setFellBack(true);
      const browserLegs = journeyLegs(journey, 'browser');
      if (browserLegs.length === 1 && browserLegs[0]) await open(browserLegs[0].url);
      else setShowLegs(true);
    }, 'Could not open Google Maps.');

  const navigateJourney = () => {
    if (legs.length === 1 && legs[0]) openLeg(legs[0]);
    else setShowLegs((v) => !v);
  };

  return (
    <View style={styles.container} testID="plan-navigation">
      <AppText variant="caption" tone="textMuted">
        Places you want directions to, in your order. Separate from your plan and route — removing a place here keeps it
        everywhere else. Google Maps does the turn-by-turn navigation.
      </AppText>
      {error ? <Notice tone="danger" title="Not changed" message={error} /> : null}
      {undo ? (
        <Notice
          tone="success"
          title={`${undo.name} marked as visited`}
          action={{
            label: 'Undo',
            icon: 'undo',
            onPress: () =>
              run(async () => {
                await store().setVisited(tripId, undo.id, false);
                setUndo(null);
              }, 'Could not update the place.'),
          }}
          testID="nav-undo-notice"
        />
      ) : null}

      {total === 0 ? (
        <EmptyState
          icon="navigation-variant-outline"
          title="Nothing to navigate to yet"
          message="Add places below, or choose “Add to Navigation” in a place’s menu."
          testID="nav-empty"
        />
      ) : (
        <>
          <Card variant="accent" style={styles.journey} testID="nav-journey">
            <View style={styles.progressRow}>
              <AppText variant="bodyStrong" style={styles.flex} testID="nav-progress">
                {done} of {total} {total === 1 ? 'place' : 'places'} visited
              </AppText>
              <AppText variant="caption" tone="textSecondary">
                {journey.length} to go
              </AppText>
            </View>
            <ProgressBar value={total === 0 ? 0 : done / total} accessibilityLabel="Navigation progress" />
            <Button
              label={journey.length === 0 ? 'Everything visited' : legs.length > 1 ? `Navigate journey · ${legs.length} legs` : 'Navigate whole journey'}
              icon="navigation-variant"
              onPress={navigateJourney}
              disabled={journey.length === 0}
              fullWidth
              testID="nav-journey-go"
            />
            {showLegs && legs.length > 1 ? (
              <View style={styles.legs} testID="nav-legs">
                {fellBack ? (
                  <Notice
                    tone="info"
                    title="Google Maps app not found"
                    message="Your journey opens in the browser instead, which takes fewer stops per route."
                    testID="nav-legs-fallback"
                  />
                ) : null}
                <AppText variant="caption" tone="textSecondary" testID="nav-legs-explainer">
                  {target === 'app' ? 'The Google Maps app' : 'Google Maps in a browser'} takes {MAPS_LIMITS[target].maxWaypoints + 2}{' '}
                  places per route, so your {journey.length} places are split into {legs.length} legs. Open them in order; each
                  leg starts where the last one ended. No place is left out.
                </AppText>
                {legs.map((leg) => (
                  <Pressable
                    key={leg.number}
                    accessibilityRole="link"
                    accessibilityLabel={`Open leg ${leg.number} of ${legs.length} in Google Maps: ${legLabel(leg)}`}
                    onPress={() => openLeg(leg)}
                    style={({ pressed }) => [styles.leg, pressed && styles.pressed]}
                    testID={`nav-leg-${leg.number}`}
                  >
                    <View style={styles.legNumber}>
                      <AppText variant="captionStrong" tone="textOnAccent">
                        {leg.number}
                      </AppText>
                    </View>
                    <View style={styles.flex}>
                      <AppText variant="captionStrong" testID={`nav-leg-${leg.number}-title`}>
                        Leg {leg.number} of {legs.length} · places {leg.firstPosition}–{leg.lastPosition}
                      </AppText>
                      <AppText variant="caption" testID={`nav-leg-${leg.number}-stops`}>
                        {legLabel(leg)}
                      </AppText>
                    </View>
                    <Icon name="open-in-new" size={18} tone="accent" />
                  </Pressable>
                ))}
              </View>
            ) : null}
          </Card>

          <DraggableList
            items={rows}
            allowNest
            siblings={siblings}
            subtreeOf={subtreeOf}
            canPlaceIn={canPlaceIn}
            onDrop={(id, target) => run(() => store().moveNavigation(tripId, id, target), 'Could not move it.')}
            onAccessibleMove={accessibleMove}
            indent={PLAN_INDENT}
            scroll={scroll}
            onDragActiveChange={onDragActiveChange}
            testID="nav-list"
            renderItem={(row, context) => {
              const isVisited = visited.has(row.node.id);
              return (
                <View
                  style={[
                    styles.row,
                    { marginLeft: indentFor(row.depth) },
                    isVisited && styles.rowVisited,
                    context.isDropInside && styles.highlight,
                  ]}
                  testID={`nav-row-${row.node.name}`}
                >
                  {row.hasChildren ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`${row.expanded ? 'Collapse' : 'Expand'} ${row.node.name}`}
                      onPress={() =>
                        setCollapsed((current) => {
                          const next = new Set(current);
                          if (next.has(row.id)) next.delete(row.id);
                          else next.add(row.id);
                          return next;
                        })
                      }
                      style={styles.toggle}
                      testID={`nav-toggle-${row.node.name}`}
                    >
                      <Icon name={row.expanded ? 'chevron-down' : 'chevron-right'} tone="textSecondary" />
                    </Pressable>
                  ) : (
                    <View style={styles.toggle}>
                      <Icon name={isVisited ? 'check-circle' : 'map-marker-outline'} size={18} tone={isVisited ? 'accent' : 'info'} />
                    </View>
                  )}
                  <View style={styles.flex}>
                    <AppText variant="bodyStrong" tone={isVisited ? 'textSecondary' : 'textPrimary'} numberOfLines={1}>
                      {row.node.name}
                    </AppText>
                    <AppText variant="caption" tone="textMuted" numberOfLines={1}>
                      {[isVisited ? 'Visited' : 'Upcoming', row.node.place?.location ? 'Exact location' : 'Found by name'].join(' · ')}
                    </AppText>
                  </View>
                  <IconButton
                    icon={isVisited ? 'undo' : 'check-circle-outline'}
                    variant="plain"
                    size="sm"
                    tone={isVisited ? 'textMuted' : 'accent'}
                    accessibilityLabel={isVisited ? `Mark ${row.node.name} as upcoming` : `Mark ${row.node.name} as visited`}
                    onPress={() => toggleVisited(row.node, !isVisited)}
                    testID={isVisited ? `nav-unvisit-${row.node.name}` : `nav-visit-${row.node.name}`}
                  />
                  <IconButton
                    icon="navigation-variant"
                    variant="plain"
                    size="sm"
                    tone="accent"
                    accessibilityLabel={`Navigate to ${row.node.name} in Google Maps`}
                    onPress={() => run(() => open(navigateLink(row.node).url), 'Could not open Google Maps.')}
                    testID={`nav-go-${row.node.name}`}
                  />
                  <IconButton
                    icon="close"
                    variant="plain"
                    size="sm"
                    accessibilityLabel={`Remove ${row.node.name} from Navigation`}
                    onPress={() => run(() => store().removeFromNavigation(tripId, row.id), 'Could not change Navigation.')}
                    testID={`nav-remove-${row.node.name}`}
                  />
                  {context.handle}
                </View>
              );
            }}
          />
        </>
      )}

      {total > 0 ? (
        <Card style={styles.journey} testID="arrival-settings">
          <ToggleRow
            icon="map-marker-radius-outline"
            label="Arrival prompts"
            description={`Asks “Mark as visited?” after you have stayed about ${arrival.radiusMeters} m from an upcoming place for ${arrival.dwellMinutes} minutes. Never marks anything by itself.`}
            value={arrival.enabled}
            onChange={(value) => run(() => useArrivalStore.getState().setEnabled(value), 'Could not change arrival prompts.')}
            testID="arrival-toggle"
          />
          {arrivalError ? <Notice tone="warning" title="Arrival prompts are off" message={arrivalError} testID="arrival-denied" /> : null}
          <AppText variant="caption" tone="textMuted">
            Best effort: location is used only while Trip Prep is open (no background tracking), so a prompt can be late or
            missed. Places need a known location
            {withoutLocation > 0 ? ` — ${withoutLocation} upcoming ${withoutLocation === 1 ? 'place has' : 'places have'} none yet` : ''}.
            You can always mark places visited yourself.
          </AppText>
        </Card>
      ) : null}

      {candidates.length > 0 ? (
        <View style={styles.list}>
          <AppText variant="label" tone="textMuted">
            Add from your plan
          </AppText>
          {candidates.map((row) => (
            <View key={row.node.id} style={[styles.candidate, { marginLeft: indentFor(row.depth) }]}>
              <AppText variant={row.depth === 0 ? 'bodyStrong' : 'body'} style={styles.flex} numberOfLines={1}>
                {row.node.name}
              </AppText>
              <Button
                label="Add"
                icon="plus"
                size="sm"
                variant="ghost"
                onPress={() => run(() => store().addToNavigation(tripId, row.node.id), 'Could not change Navigation.')}
                testID={`nav-add-${row.node.name}`}
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
  journey: {
    gap: spacing.md,
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  legs: {
    gap: spacing.sm,
  },
  leg: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  legNumber: {
    width: 24,
    height: 24,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
  },
  pressed: {
    opacity: 0.75,
  },
  list: {
    gap: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 56,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surfaceRaised,
  },
  rowVisited: {
    opacity: 0.7,
    borderColor: colors.border,
  },
  highlight: {
    borderColor: colors.accent,
    borderWidth: 2,
    backgroundColor: colors.accentSoft,
  },
  toggle: {
    width: 36,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
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
