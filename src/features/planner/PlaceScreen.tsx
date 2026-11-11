import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';

import { Screen } from '@/components/layout/Screen';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import {
  AppText,
  Button,
  Card,
  EmptyState,
  IconButton,
  LoadingState,
  Notice,
  Tag,
  TextField,
} from '@/components/ui';
import { toErrorMessage } from '@/lib/errors';
import { successFeedback } from '@/lib/haptics';
import { colors, spacing } from '@/theme';

import { daysUntilRefresh } from '../places/cachePolicy';
import { placeLink } from '../places/mapsLinks';
import { useTrip } from '../trips/hooks';
import type { TripSummary } from '../trips/model';
import { useNodeActions } from './components/NodeActions';
import { PlanRow } from './components/PlanRow';
import { ancestorIds, buildTree, countDescendants, PLANNER_LIMITS, validateNodeName, type PlanNode, type PlanTreeNode } from './model';
import { usePlannerStore, useTripPlan } from './plannerStore';

function findItem(tree: readonly PlanTreeNode[], id: string): PlanTreeNode | null {
  for (const item of tree) {
    if (item.node.id === id) return item;
    const found = findItem(item.children, id);
    if (found) return found;
  }
  return null;
}

function Details({ trip, node }: { trip: TripSummary; node: PlanNode }) {
  const plan = useTripPlan(trip.id).plan;
  const [name, setName] = useState(node.name);
  const [notes, setNotes] = useState(node.notes);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: 'danger' | 'success'; text: string } | null>(null);
  const actions = useNodeActions(trip.id, plan, {
    onRemoved: (id) => {
      if (id === node.id) router.back();
    },
  });
  if (!plan) return null;

  const tree = buildTree(plan.nodes);
  const item = findItem(tree, node.id);
  const trail = ancestorIds(plan.nodes, node.id)
    .reverse()
    .map((id) => plan.nodes.find((n) => n.id === id)?.name)
    .filter(Boolean)
    .join(' › ');
  const routeIndex = plan.route.findIndex((s) => s.nodeId === node.id);
  const routeNumber = new Map(plan.route.map((stop, index) => [stop.nodeId, index + 1]));
  const dirty = name.trim() !== node.name || notes.trim() !== node.notes;
  const nameError = validateNodeName(name);
  const link = placeLink(node);
  const refreshIn = daysUntilRefresh(node.place?.fetchedAt ?? null, new Date());

  async function save() {
    if (nameError) return;
    setSaving(true);
    setMessage(null);
    try {
      await usePlannerStore.getState().updateNode(trip.id, node.id, { name, notes });
      successFeedback();
      setMessage({ tone: 'success', text: 'Saved.' });
    } catch (err) {
      setMessage({ tone: 'danger', text: toErrorMessage(err, 'Could not save.') });
    } finally {
      setSaving(false);
    }
  }

  const toggleRoute = () => {
    setMessage(null);
    const store = usePlannerStore.getState();
    (routeIndex >= 0 ? store.removeRouteStop(trip.id, node.id) : store.addRouteStop(trip.id, node.id)).catch(
      (err: unknown) => setMessage({ tone: 'danger', text: toErrorMessage(err, 'Could not change the route.') }),
    );
  };

  return (
    <Screen testID="plan-place" bottomInset>
      <ScreenHeader
        showBack
        eyebrow={trail || trip.name}
        title={node.name}
        trailing={<IconButton icon="dots-horizontal" accessibilityLabel="Place actions" onPress={() => actions.open(node.id)} testID="plan-place-actions" />}
      />

      <View style={styles.tags}>
        {node.parentId ? (
          <Tag label="Place inside a destination" icon="subdirectory-arrow-right" color={colors.info} />
        ) : (
          <Tag label="Main destination" icon="map-marker-radius" color={colors.accent} />
        )}
        {routeIndex >= 0 ? (
          <Tag label={`Route stop ${routeIndex + 1}`} icon="map-marker-path" color={colors.accent} />
        ) : (
          <Tag label="Not on the route" icon="map-marker-path" />
        )}
      </View>

      <Card>
        {node.place?.location ? (
          <View style={styles.info}>
            {node.place.formattedAddress ? <AppText variant="body">{node.place.formattedAddress}</AppText> : null}
            <AppText variant="caption" tone="textMuted">
              {node.place.location.latitude.toFixed(5)}, {node.place.location.longitude.toFixed(5)}
            </AppText>
            {refreshIn !== null ? (
              <AppText variant="caption" tone="textMuted">
                Details from Google Maps · stored on this device for {refreshIn} more {refreshIn === 1 ? 'day' : 'days'}
              </AppText>
            ) : null}
          </View>
        ) : node.place ? (
          <AppText variant="caption" tone="warning">
            Saved place whose map details have expired. They refresh when place search is available.
          </AppText>
        ) : (
          <AppText variant="caption" tone="textMuted">
            Added by name — not linked to a map location yet.
          </AppText>
        )}
        <Button
          label={link.exact ? 'Open in Google Maps' : 'Search in Google Maps'}
          icon="google-maps"
          variant="ghost"
          size="sm"
          onPress={() => void Linking.openURL(link.url)}
          style={styles.left}
          testID="plan-place-maps"
        />
      </Card>

      <TextField
        label="Name"
        value={name}
        onChangeText={setName}
        error={nameError ?? undefined}
        maxLength={PLANNER_LIMITS.nameMax}
        helper={node.parentId ? undefined : 'Shown as one of this trip’s destinations'}
        testID="plan-place-name"
      />
      <TextField
        label="Notes"
        placeholder="Timings, tickets, ideas…"
        value={notes}
        onChangeText={setNotes}
        maxLength={PLANNER_LIMITS.notesMax}
        multiline
        testID="plan-place-notes"
      />
      {dirty ? (
        <Button label="Save changes" icon="content-save-outline" onPress={() => void save()} loading={saving} disabled={!!nameError} testID="plan-place-save" />
      ) : null}
      {message ? <Notice tone={message.tone} title={message.text} /> : null}
      {actions.error ? <Notice tone="danger" title="Not changed" message={actions.error} /> : null}

      <View style={styles.row}>
        <Button
          label={routeIndex >= 0 ? 'Remove from route' : 'Add to route'}
          icon={routeIndex >= 0 ? 'map-marker-remove-outline' : 'map-marker-path'}
          variant="secondary"
          size="sm"
          onPress={toggleRoute}
          testID="plan-place-route"
        />
        {node.parentId ? (
          <Button
            label="Make main destination"
            icon="arrow-top-left"
            variant="secondary"
            size="sm"
            onPress={() =>
              usePlannerStore
                .getState()
                .promote(trip.id, node.id)
                .catch((err: unknown) => setMessage({ tone: 'danger', text: toErrorMessage(err, 'Could not change it.') }))
            }
            testID="plan-place-promote"
          />
        ) : null}
      </View>

      <View style={styles.group}>
        <View style={styles.row}>
          <AppText variant="label" tone="textMuted" style={styles.flex}>
            Places inside ({item?.children.length ?? 0})
          </AppText>
          <Button
            label="Add place inside"
            icon="map-marker-plus-outline"
            variant="ghost"
            size="sm"
            onPress={() => router.push({ pathname: '/trips/[tripId]/plan/add', params: { tripId: trip.id, parentId: node.id } })}
            testID="plan-place-add-inside"
          />
        </View>
        {item && item.children.length > 0 ? (
          item.children.map((child) => (
            <PlanRow
              key={child.node.id}
              item={{ ...child, depth: 1 }}
              descendants={countDescendants(child)}
              expanded={false}
              routeNumber={routeNumber.get(child.node.id) ?? null}
              reorder={false}
              canMoveUp={false}
              canMoveDown={false}
              onToggle={() => undefined}
              onOpen={() =>
                router.push({ pathname: '/trips/[tripId]/plan/place/[nodeId]', params: { tripId: trip.id, nodeId: child.node.id } })
              }
              onMore={() => actions.open(child.node.id)}
              onMove={() => undefined}
            />
          ))
        ) : (
          <AppText variant="caption" tone="textMuted">
            Nothing inside yet. Add attractions, viewpoints, stays or anything else you want to see here.
          </AppText>
        )}
      </View>
      {actions.sheet}
    </Screen>
  );
}

export function PlaceScreen({ tripId, nodeId }: { tripId: string | undefined; nodeId: string | undefined }) {
  const { trip } = useTrip(tripId);
  const state = useTripPlan(tripId);
  const node = state.plan?.nodes.find((n) => n.id === nodeId);
  useFocusEffect(
    useCallback(() => {
      if (tripId) void usePlannerStore.getState().load(tripId);
    }, [tripId]),
  );

  if (trip && node) return <Details key={`${node.id}:${node.updatedAt}`} trip={trip} node={node} />;
  return (
    <Screen bottomInset>
      <ScreenHeader showBack title="Place" />
      {state.status === 'ready' ? (
        <EmptyState icon="map-marker-question-outline" title="Not in this plan" message="It may have been removed." />
      ) : (
        <LoadingState label="Loading place…" />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  tags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  info: {
    gap: spacing.xs,
  },
  left: {
    alignSelf: 'flex-start',
    marginTop: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.sm,
  },
  group: {
    gap: spacing.sm,
  },
  flex: {
    flex: 1,
  },
});
