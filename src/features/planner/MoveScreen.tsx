import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Screen } from '@/components/layout/Screen';
import { goBackOrHome, ScreenHeader } from '@/components/layout/ScreenHeader';
import { AppText, EmptyState, Icon, LoadingState, Notice } from '@/components/ui';
import { toErrorMessage } from '@/lib/errors';
import { successFeedback } from '@/lib/haptics';
import { colors, radii, spacing } from '@/theme';

import { buildTree, canMove, visibleRows, type PlanNode, type TripPlan } from './model';
import { usePlannerStore, useTripPlan } from './plannerStore';

function Target({
  label,
  depth,
  current,
  disabledReason,
  onPress,
  testID,
}: {
  label: string;
  depth: number;
  current: boolean;
  disabledReason: string | null;
  onPress: () => void;
  testID: string;
}) {
  const disabled = current || !!disabledReason;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={current ? `${label}, current place` : disabledReason ? `${label}, ${disabledReason}` : `Move into ${label}`}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.target,
        { marginLeft: Math.min(depth, 5) * 16 },
        current && styles.current,
        disabled && !current && styles.disabled,
        pressed && styles.pressed,
      ]}
      testID={testID}
    >
      <Icon name={depth === -1 ? 'map-marker-radius' : 'subdirectory-arrow-right'} tone={current ? 'accent' : 'textSecondary'} />
      <View style={styles.flex}>
        <AppText variant="body" numberOfLines={1}>
          {label}
        </AppText>
        {current || disabledReason ? (
          <AppText variant="caption" tone="textMuted" numberOfLines={1}>
            {current ? 'Where it is now' : disabledReason}
          </AppText>
        ) : null}
      </View>
    </Pressable>
  );
}

function Picker({ tripId, plan, node }: { tripId: string; plan: TripPlan; node: PlanNode }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const rows = visibleRows(buildTree(plan.nodes), new Set(plan.nodes.map((n) => n.id)));
  const inFlight = useRef(false);

  async function moveTo(parentId: string | null) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      await usePlannerStore.getState().moveNode(tripId, node.id, { parentId });
      successFeedback();
      goBackOrHome();
    } catch (err) {
      setError(toErrorMessage(err, 'Could not move it.'));
      setBusy(false);
      inFlight.current = false;
    }
  }

  return (
    <Screen testID="plan-move" bottomInset>
      <ScreenHeader showBack backIcon="close" eyebrow={`Move "${node.name}"`} title="Move into…" />
      <AppText variant="caption" tone="textMuted">
        Everything inside it moves too. Your route stays exactly as it is.
        {node.parentId === null ? ' Moving a main destination inside another place removes it from the trip’s destinations.' : ''}
      </AppText>
      {error ? <Notice tone="danger" title="Not moved" message={error} /> : null}
      <View style={[styles.list, busy && styles.busy]}>
        <Target
          label="Main destination (top level)"
          depth={-1}
          current={node.parentId === null}
          disabledReason={null}
          onPress={() => void moveTo(null)}
          testID="plan-move-top"
        />
        {rows.map((row) => {
          const check = canMove(plan.nodes, node.id, row.node.id);
          return (
            <Target
              key={row.node.id}
              label={row.node.name}
              depth={row.depth}
              current={node.parentId === row.node.id}
              disabledReason={row.node.id === node.id ? 'This place' : check.ok ? null : 'Inside the place you are moving'}
              onPress={() => void moveTo(row.node.id)}
              testID={`plan-move-into-${row.node.name}`}
            />
          );
        })}
      </View>
    </Screen>
  );
}

export function MoveScreen({ tripId, nodeId }: { tripId: string | undefined; nodeId: string | undefined }) {
  const state = useTripPlan(tripId);
  useEffect(() => {
    if (tripId && state.status === 'idle') void usePlannerStore.getState().load(tripId);
  }, [tripId, state.status]);
  const node = state.plan?.nodes.find((n) => n.id === nodeId);
  if (tripId && state.plan && node) return <Picker tripId={tripId} plan={state.plan} node={node} />;
  return (
    <Screen bottomInset>
      <ScreenHeader showBack backIcon="close" title="Move" />
      {state.status === 'ready' ? (
        <EmptyState icon="map-marker-question-outline" title="Not in this plan" message="It may have been removed." />
      ) : (
        <LoadingState label="Loading…" />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: spacing.sm,
  },
  busy: {
    opacity: 0.6,
  },
  target: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 52,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  current: {
    borderColor: colors.accentBorder,
  },
  disabled: {
    opacity: 0.45,
  },
  pressed: {
    opacity: 0.8,
  },
  flex: {
    flex: 1,
    minWidth: 0,
  },
});
