import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Screen } from '@/components/layout/Screen';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { EmptyState, ErrorState, IconButton, LoadingState, Notice, OptionTile } from '@/components/ui';
import { spacing } from '@/theme';

import { useTrip } from '../trips/hooks';
import type { TripSummary } from '../trips/model';
import { emptyProfile } from './companion';
import { useNodeActions } from './components/NodeActions';
import { ExploreTab } from './detail/ExploreTab';
import { Hero } from './detail/Hero';
import { LocationCard } from './detail/LocationCard';
import { MemoriesTab } from './detail/MemoriesTab';
import { OverviewTab } from './detail/OverviewTab';
import { PlanTab } from './detail/PlanTab';
import { PrepareTab } from './detail/PrepareTab';
import { QuickActions } from './detail/QuickActions';
import { DETAIL_TABS, type DetailContext, type DetailTab } from './detail/shared';
import { useDetailStore, useNodeDetails } from './detailStore';
import { ancestorIds, type PlanNode } from './model';
import { usePlannerStore, useTripPlan } from './plannerStore';

function DestinationPage({ trip, node, initialTab }: { trip: TripSummary; node: PlanNode; initialTab: DetailTab }) {
  const state = useTripPlan(trip.id);
  const { details, error } = useNodeDetails(node.id);
  const [tab, setTab] = useState<DetailTab>(initialTab);
  const actions = useNodeActions(trip.id, state.plan, {
    onRemoved: (id) => {
      if (id === node.id) router.back();
    },
  });
  useEffect(() => {
    void useDetailStore.getState().load(node.id);
  }, [node.id]);

  const plan = state.plan;
  if (!plan) return null;
  const trail = ancestorIds(plan.nodes, node.id)
    .reverse()
    .map((id) => plan.nodes.find((n) => n.id === id)?.name)
    .filter((name): name is string => !!name);
  const profile = details?.profile ?? state.companion?.profiles.find((p) => p.nodeId === node.id) ?? emptyProfile(node.id, trip.id);
  const ctx: DetailContext = { tripId: trip.id, node, plan, profile, details };

  return (
    <Screen testID="plan-place" bottomInset>
      <ScreenHeader
        showBack
        eyebrow={trail.join(' › ') || trip.name}
        title={node.name}
        trailing={<IconButton icon="dots-horizontal" accessibilityLabel="Place actions" onPress={() => actions.open(node.id)} testID="plan-place-actions" />}
      />
      <Hero ctx={ctx} trail={trail} />
      <QuickActions ctx={ctx} />
      <LocationCard ctx={ctx} />
      {actions.error ? <Notice tone="danger" title="Not changed" message={actions.error} /> : null}
      {actions.notice ? <Notice tone="success" title={actions.notice} /> : null}

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs} accessibilityRole="tablist">
        {DETAIL_TABS.map((t) => (
          <OptionTile key={t.value} layout="chip" label={t.label} icon={t.icon} selected={tab === t.value} onPress={() => setTab(t.value)} testID={`detail-tab-${t.value}`} />
        ))}
      </ScrollView>

      {error ? (
        <ErrorState title="Couldn’t load this place" message={error} onRetry={() => void useDetailStore.getState().load(node.id)} />
      ) : !details ? (
        <LoadingState label="Loading…" />
      ) : (
        <View key={tab} testID={`detail-panel-${tab}`}>
          {tab === 'overview' ? <OverviewTab ctx={ctx} /> : null}
          {tab === 'explore' ? <ExploreTab ctx={ctx} onMore={(id) => actions.open(id)} /> : null}
          {tab === 'prepare' ? <PrepareTab ctx={ctx} /> : null}
          {tab === 'plan' ? <PlanTab ctx={ctx} startDate={trip.startDate ?? null} /> : null}
          {tab === 'memories' ? <MemoriesTab ctx={ctx} /> : null}
        </View>
      )}
      {actions.sheet}
    </Screen>
  );
}

export function PlaceScreen({ tripId, nodeId, tab }: { tripId: string | undefined; nodeId: string | undefined; tab?: DetailTab }) {
  const { trip } = useTrip(tripId);
  const state = useTripPlan(tripId);
  const node = state.plan?.nodes.find((n) => n.id === nodeId);
  useFocusEffect(
    useCallback(() => {
      if (tripId) void usePlannerStore.getState().load(tripId);
      if (nodeId) void useDetailStore.getState().load(nodeId);
    }, [tripId, nodeId]),
  );

  if (trip && node) return <DestinationPage key={node.id} trip={trip} node={node} initialTab={tab ?? 'overview'} />;
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
  tabs: {
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
});
