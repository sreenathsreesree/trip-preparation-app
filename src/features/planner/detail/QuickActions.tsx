import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ActionSheet, AppText, Icon, Notice } from '@/components/ui';
import type { IconName } from '@/theme/icons';
import { toErrorMessage } from '@/lib/errors';
import { successFeedback } from '@/lib/haptics';
import { colors, radii, spacing } from '@/theme';

import { useDetailStore } from '../detailStore';
import { usePlannerStore, useTripPlan } from '../plannerStore';
import type { DetailContext } from './shared';

function ActionTile({ label, icon, active = false, onPress, accessibilityLabel, testID }: { label: string; icon: IconName; active?: boolean; onPress: () => void; accessibilityLabel: string; testID?: string }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => [styles.tile, active && styles.tileActive, pressed && styles.tilePressed]}
      testID={testID}
    >
      <Icon name={icon} size={22} tone={active ? 'accent' : 'textSecondary'} />
      <AppText variant="caption" tone={active ? 'accent' : 'textSecondary'} numberOfLines={1}>
        {label}
      </AppText>
    </Pressable>
  );
}

/** One-tap actions as compact tiles: visited, route, Navigation, add inside, promote. */
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
        <ActionTile
          label={visited ? 'Visited' : 'Mark visited'}
          icon={visited ? 'check-circle' : 'check-circle-outline'}
          active={visited}
          accessibilityLabel={visited ? 'Mark as not visited' : 'Mark as visited'}
          onPress={() => void run(() => store().setVisited(tripId, node.id, !visited), visited ? 'Marked as not visited.' : 'Marked as visited.', 'Could not change it.')}
          testID="detail-visit"
        />
        <ActionTile
          label={routeIndex >= 0 ? `Stop ${routeIndex + 1}` : 'Add to route'}
          icon={routeIndex >= 0 ? 'map-marker-check-outline' : 'map-marker-path'}
          active={routeIndex >= 0}
          accessibilityLabel={routeIndex >= 0 ? 'Remove from route' : 'Add to route'}
          onPress={() =>
            routeIndex >= 0 ? setConfirmRoute(true) : void run(() => store().addRouteStop(tripId, node.id), 'Added to the route.', 'Could not change the route.')
          }
          testID="plan-place-route"
        />
        <ActionTile
          label={navItem ? 'In Navigation' : 'Navigation'}
          icon={navItem ? 'navigation-variant' : 'navigation-variant-outline'}
          active={!!navItem}
          accessibilityLabel={navItem ? 'Remove from Navigation' : 'Add to Navigation'}
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
        <ActionTile
          label="Add inside"
          icon="map-marker-plus-outline"
          accessibilityLabel="Add place inside"
          onPress={() => router.push({ pathname: '/trips/[tripId]/plan/add', params: { tripId, parentId: node.id } })}
          testID="plan-place-add-inside"
        />
        {node.parentId ? (
          <ActionTile
            label="Make main"
            icon="arrow-top-left"
            accessibilityLabel="Make main destination"
            onPress={() => void run(() => store().promote(tripId, node.id), 'Now a main destination.', 'Could not change it.')}
            testID="plan-place-promote"
          />
        ) : null}
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
    gap: spacing.sm,
  },
  tile: {
    flex: 1,
    minWidth: 0,
    minHeight: 64,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xxs,
    paddingHorizontal: spacing.xs,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  tileActive: {
    borderColor: colors.accentBorder,
    backgroundColor: colors.accentSoft,
  },
  tilePressed: {
    backgroundColor: colors.surfacePressed,
  },
});
