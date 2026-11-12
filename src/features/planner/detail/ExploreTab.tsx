import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText, Button, Notice } from '@/components/ui';
import { toErrorMessage } from '@/lib/errors';
import { spacing } from '@/theme';

import { PlanTree } from '../components/PlanTree';
import { Recommendations } from '../components/Recommendations';
import { usePlannerStore, useTripPlan } from '../plannerStore';
import type { DetailContext } from './shared';

/** Places inside this one (drag to reorder or nest) and live nearby recommendations. */
export function ExploreTab({ ctx, onMore }: { ctx: DetailContext; onMore: (id: string) => void }) {
  const { tripId, node, plan } = ctx;
  const companion = useTripPlan(tripId).companion;
  const [error, setError] = useState<string | null>(null);
  const children = plan.nodes.filter((n) => n.parentId === node.id);
  const routeNumber = new Map(plan.route.map((stop, index) => [stop.nodeId, index + 1]));
  const visited = new Set((companion?.profiles ?? []).filter((p) => p.visitStatus === 'visited').map((p) => p.nodeId));
  const inNavigation = new Set((companion?.navigation ?? []).map((n) => n.nodeId));

  return (
    <View style={styles.root} testID="detail-explore">
      <View style={styles.group}>
        <View style={styles.row}>
          <AppText variant="title" style={styles.flex}>
            Places inside ({children.length})
          </AppText>
          <Button
            label="Add place"
            icon="map-marker-plus-outline"
            variant="ghost"
            size="sm"
            onPress={() => router.push({ pathname: '/trips/[tripId]/plan/add', params: { tripId, parentId: node.id } })}
            testID="detail-explore-add"
          />
        </View>
        {children.length > 0 ? (
          <PlanTree
            tripId={tripId}
            plan={plan}
            rootId={node.id}
            routeNumber={routeNumber}
            visited={visited}
            inNavigation={inNavigation}
            onMove={(id, target) =>
              void usePlannerStore
                .getState()
                .moveNode(tripId, id, target)
                .catch((err: unknown) => setError(toErrorMessage(err, 'Could not move it.')))
            }
            onMore={onMore}
            testID="plan-place-inside"
          />
        ) : (
          <AppText variant="caption" tone="textMuted">
            Nothing inside yet. Add attractions, viewpoints, stays or anything else you want to see here.
          </AppText>
        )}
        {error ? <Notice tone="danger" title="Not moved" message={error} /> : null}
      </View>

      <View style={styles.group}>
        <AppText variant="title">Recommended nearby</AppText>
        <Recommendations tripId={tripId} plan={plan} nodeId={node.id} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: spacing.xxl,
  },
  group: {
    gap: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  flex: {
    flex: 1,
  },
});
