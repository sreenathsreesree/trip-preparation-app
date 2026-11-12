import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ActionSheet, Button, Notice } from '@/components/ui';
import { toErrorMessage } from '@/lib/errors';
import { successFeedback } from '@/lib/haptics';
import { spacing } from '@/theme';

import { useDetailStore } from '../detailStore';
import { usePlannerStore, useTripPlan } from '../plannerStore';
import type { DetailContext } from './shared';

/** One-tap actions: visited, route, Navigation, promote, add inside. */
export function QuickActions({ ctx }: { ctx: DetailContext }) {
  const { tripId, node, plan, profile } = ctx;
  const navItem = useTripPlan(tripId).companion?.navigation.find((n) => n.nodeId === node.id) ?? null;
  const [confirmRoute, setConfirmRoute] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'danger' | 'info'; text: string } | null>(null);
  const routeIndex = plan.route.findIndex((s) => s.nodeId === node.id);
  const visited = profile.visitStatus === 'visited';

  async function run(fn: () => Promise<unknown>, done: string | null, fallback: string) {
    setMessage(null);
    try {
      await fn();
      await useDetailStore.getState().load(node.id);
      if (done) {
        successFeedback();
        setMessage({ tone: 'success', text: done });
      }
    } catch (err) {
      setMessage({ tone: 'danger', text: toErrorMessage(err, fallback) });
    }
  }
  const store = () => usePlannerStore.getState();

  return (
    <View style={styles.root} testID="detail-quick-actions">
      <View style={styles.row}>
        <Button
          label={visited ? 'Mark as not visited' : 'Mark as visited'}
          icon={visited ? 'undo-variant' : 'check-circle-outline'}
          variant={visited ? 'secondary' : 'primary'}
          size="sm"
          onPress={() => void run(() => store().setVisited(tripId, node.id, !visited), visited ? 'Marked as not visited.' : 'Marked as visited.', 'Could not change it.')}
          testID="detail-visit"
        />
        <Button
          label={routeIndex >= 0 ? 'Remove from route' : 'Add to route'}
          icon={routeIndex >= 0 ? 'map-marker-remove-outline' : 'map-marker-path'}
          variant="secondary"
          size="sm"
          onPress={() =>
            routeIndex >= 0 ? setConfirmRoute(true) : void run(() => store().addRouteStop(tripId, node.id), 'Added to the route.', 'Could not change the route.')
          }
          testID="plan-place-route"
        />
        <Button
          label={navItem ? 'Remove from Navigation' : 'Add to Navigation'}
          icon={navItem ? 'navigation-variant' : 'navigation-variant-outline'}
          variant="secondary"
          size="sm"
          onPress={() =>
            navItem
              ? void run(() => store().removeFromNavigation(tripId, navItem.id), 'Removed from Navigation.', 'Could not change Navigation.')
              : void run(
                  async () => {
                    const result = await store().addToNavigation(tripId, node.id);
                    if (result === 'duplicate') throw new Error('It’s already in Navigation.');
                  },
                  'Added to Navigation.',
                  'Could not change Navigation.',
                )
          }
          testID="detail-navigation"
        />
        {node.parentId ? (
          <Button
            label="Make main destination"
            icon="arrow-top-left"
            variant="ghost"
            size="sm"
            onPress={() => void run(() => store().promote(tripId, node.id), 'Now a main destination.', 'Could not change it.')}
            testID="plan-place-promote"
          />
        ) : null}
        <Button
          label="Add place inside"
          icon="map-marker-plus-outline"
          variant="ghost"
          size="sm"
          onPress={() => router.push({ pathname: '/trips/[tripId]/plan/add', params: { tripId, parentId: node.id } })}
          testID="plan-place-add-inside"
        />
      </View>
      {message ? <Notice tone={message.tone} title={message.text} testID="detail-quick-message" /> : null}
      <ActionSheet
        visible={confirmRoute}
        title={`Remove ${node.name} from the route?`}
        subtitle="It stays in your plan and in Navigation. Other stops are renumbered."
        actions={[
          {
            key: 'remove',
            label: 'Remove from route',
            icon: 'map-marker-remove-outline',
            destructive: true,
            onPress: () => void run(() => store().removeRouteStop(tripId, node.id), 'Removed from the route.', 'Could not change the route.'),
          },
        ]}
        onClose={() => setConfirmRoute(false)}
        testID="detail-route-confirm"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
});
