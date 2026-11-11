import { router } from 'expo-router';
import { useState } from 'react';

import { ActionSheet, type SheetAction } from '@/components/ui';
import { confirmAction } from '@/lib/confirm';
import { toErrorMessage } from '@/lib/errors';

import { childrenOf, removalImpact, type TripPlan } from '../model';
import { usePlannerStore } from '../plannerStore';

/** Plain-language summary of a removal, shown before anything is deleted. */
export function describeRemoval(plan: TripPlan, nodeId: string, mode: 'keepChildren' | 'withChildren'): string {
  const impact = removalImpact(plan, nodeId, mode);
  const node = plan.nodes.find((n) => n.id === nodeId);
  const parts: string[] = [];
  if (mode === 'withChildren' && impact.removedNodes > 1) {
    parts.push(`Everything inside it (${impact.removedNodes - 1} more ${impact.removedNodes === 2 ? 'place' : 'places'}) is removed too.`);
  }
  if (mode === 'keepChildren' && impact.movedUp > 0) {
    parts.push(
      node?.parentId === null
        ? `The ${impact.movedUp} ${impact.movedUp === 1 ? 'place' : 'places'} inside become main destinations.`
        : `The ${impact.movedUp} ${impact.movedUp === 1 ? 'place' : 'places'} inside move up a level.`,
    );
  }
  if (impact.removesMainDestination) parts.push('It will no longer be one of this trip’s destinations.');
  if (impact.routeStops.length > 0) {
    parts.push(
      `Your route loses ${impact.routeStops.length === 1 ? 'the stop' : `${impact.routeStops.length} stops`}: ${impact.routeStops.join(', ')}. Other stops keep their order.`,
    );
  } else {
    parts.push('Your route is not affected.');
  }
  return parts.join(' ');
}

/**
 * Actions for one place in the plan: open, add inside, reorder, move,
 * promote, route membership and removal (always explained first).
 */
export function useNodeActions(tripId: string, plan: TripPlan | null, options: { onRemoved?: (id: string) => void } = {}) {
  const [targetId, setTargetId] = useState<string | null>(null);
  const [removeTargetId, setRemoveTargetId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const store = usePlannerStore.getState;

  const run = (fn: () => Promise<unknown>, fallback: string) => {
    setError(null);
    fn().catch((err: unknown) => setError(toErrorMessage(err, fallback)));
  };

  async function remove(nodeId: string, mode: 'keepChildren' | 'withChildren') {
    if (!plan) return;
    const node = plan.nodes.find((n) => n.id === nodeId);
    if (!node) return;
    const ok = await confirmAction({
      title: `Remove "${node.name}"?`,
      message: describeRemoval(plan, nodeId, mode),
      confirmLabel: 'Remove',
      destructive: true,
    });
    if (!ok) return;
    await store().removeNode(tripId, nodeId, mode);
    options.onRemoved?.(nodeId);
  }

  const node = plan?.nodes.find((n) => n.id === targetId);
  const actions: SheetAction[] = [];
  if (plan && node) {
    const siblings = childrenOf(plan.nodes, node.parentId);
    const index = siblings.findIndex((n) => n.id === node.id);
    const onRoute = plan.route.some((s) => s.nodeId === node.id);
    const hasChildren = plan.nodes.some((n) => n.parentId === node.id);
    actions.push(
      {
        key: 'open',
        label: 'Open details',
        icon: 'information-outline',
        onPress: () => router.push({ pathname: '/trips/[tripId]/plan/place/[nodeId]', params: { tripId, nodeId: node.id } }),
      },
      {
        key: 'add-inside',
        label: 'Add a place inside',
        icon: 'map-marker-plus-outline',
        onPress: () => router.push({ pathname: '/trips/[tripId]/plan/add', params: { tripId, parentId: node.id } }),
      },
    );
    if (index > 0) {
      actions.push({
        key: 'up',
        label: 'Move up',
        icon: 'arrow-up',
        onPress: () => run(() => store().moveNode(tripId, node.id, { parentId: node.parentId, index: index - 1 }), 'Could not move it.'),
      });
    }
    if (index < siblings.length - 1) {
      actions.push({
        key: 'down',
        label: 'Move down',
        icon: 'arrow-down',
        onPress: () => run(() => store().moveNode(tripId, node.id, { parentId: node.parentId, index: index + 1 }), 'Could not move it.'),
      });
    }
    actions.push({
      key: 'move',
      label: 'Move into another place…',
      icon: 'file-tree-outline',
      description: 'Nest it, or make it a main destination. Your route stays the same.',
      onPress: () => router.push({ pathname: '/trips/[tripId]/plan/move/[nodeId]', params: { tripId, nodeId: node.id } }),
    });
    if (node.parentId) {
      actions.push({
        key: 'promote',
        label: 'Make main destination',
        icon: 'arrow-top-left',
        description: 'Becomes one of this trip’s destinations. Your route stays the same.',
        onPress: () => run(() => store().promote(tripId, node.id), 'Could not make it a main destination.'),
      });
    }
    actions.push(
      onRoute
        ? {
            key: 'route-remove',
            label: 'Remove from route',
            icon: 'map-marker-remove-outline',
            description: 'Stays in your plan',
            onPress: () => run(() => store().removeRouteStop(tripId, node.id), 'Could not change the route.'),
          }
        : {
            key: 'route-add',
            label: 'Add to route',
            icon: 'map-marker-path',
            description: 'As the last stop',
            onPress: () => run(() => store().addRouteStop(tripId, node.id), 'Could not change the route.'),
          },
      {
        key: 'remove',
        label: 'Remove…',
        icon: 'trash-can-outline',
        destructive: true,
        onPress: () => {
          if (hasChildren) setRemoveTargetId(node.id);
          else void remove(node.id, 'keepChildren').catch((err: unknown) => setError(toErrorMessage(err, 'Could not remove it.')));
        },
      },
    );
  }

  const removeNode = plan?.nodes.find((n) => n.id === removeTargetId);
  const childCount = removeNode ? plan?.nodes.filter((n) => n.parentId === removeNode.id).length ?? 0 : 0;
  const removeActions: SheetAction[] = removeNode
    ? [
        {
          key: 'keep-children',
          label: `Remove only "${removeNode.name}"`,
          icon: 'arrow-up-bold-outline',
          description: `Its ${childCount} ${childCount === 1 ? 'place moves' : 'places move'} up a level`,
          onPress: () =>
            void remove(removeNode.id, 'keepChildren').catch((err: unknown) => setError(toErrorMessage(err, 'Could not remove it.'))),
        },
        {
          key: 'with-children',
          label: 'Remove it and everything inside',
          icon: 'delete-sweep-outline',
          destructive: true,
          onPress: () =>
            void remove(removeNode.id, 'withChildren').catch((err: unknown) => setError(toErrorMessage(err, 'Could not remove it.'))),
        },
      ]
    : [];

  return {
    open: (nodeId: string) => {
      setError(null);
      setTargetId(nodeId);
    },
    error,
    clearError: () => setError(null),
    sheet: (
      <>
        <ActionSheet
          visible={!!node}
          title={node?.name ?? ''}
          subtitle={node ? (node.parentId ? 'Place in your plan' : 'Main destination') : undefined}
          actions={actions}
          onClose={() => setTargetId(null)}
          testID="plan-node-actions"
        />
        <ActionSheet
          visible={!!removeNode}
          title={`Remove "${removeNode?.name ?? ''}"`}
          subtitle="It has places inside. What should happen to them?"
          actions={removeActions}
          onClose={() => setRemoveTargetId(null)}
          testID="plan-remove-options"
        />
      </>
    ),
  };
}
