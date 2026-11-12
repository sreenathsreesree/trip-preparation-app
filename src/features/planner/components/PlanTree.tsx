import { router } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';

import { canMove, childrenOf, PLANNER_LIMITS, subtreeIds, type PlanNode, type PlanTreeNode, type TripPlan } from '../model';
import { buildTree } from '../model';
import { siblingMap } from '../dragDrop';
import { DraggableList, type DraggableItem, type MoveAction, type ScrollBinding } from './DraggableList';
import { AddPlaceRow, PLAN_INDENT, PlanRow } from './PlanRow';

type TreeRow =
  | (DraggableItem & { kind: 'node'; tree: PlanTreeNode; descendants: number })
  | (DraggableItem & { kind: 'add'; parentName: string; parentNodeId: string });

const countBelow = (item: PlanTreeNode): number => item.children.reduce((sum, child) => sum + 1 + countBelow(child), 0);

/**
 * The destination hierarchy as an expandable, drag-and-drop tree.
 *
 * Every place can be expanded; an expanded place lists its places and ends with
 * an "Add place" line (until the 12-level limit). Dragging a handle reorders
 * within a parent, nests into another place, moves between parents or promotes
 * to a higher level — validated against cycles and the depth limit. Only the
 * hierarchy changes: route stops and the Navigation list keep their own order.
 *
 * With `rootId`, only the places inside that place are shown (and moves stay inside it).
 */
export function PlanTree({
  tripId,
  plan,
  rootId = null,
  routeNumber,
  visited,
  inNavigation,
  scroll,
  onDragActiveChange,
  onMove,
  onMore,
  expansion,
  testID,
}: {
  tripId: string;
  plan: TripPlan;
  rootId?: string | null;
  routeNumber: ReadonlyMap<string, number>;
  visited: ReadonlySet<string>;
  inNavigation: ReadonlySet<string>;
  scroll?: ScrollBinding;
  onDragActiveChange?: (active: boolean) => void;
  onMove: (id: string, target: { parentId: string | null; index: number }) => void;
  onMore: (id: string) => void;
  /** Optional controlled expansion state (for "Expand all / Collapse all"). */
  expansion?: [ReadonlyMap<string, boolean>, (update: (current: ReadonlyMap<string, boolean>) => ReadonlyMap<string, boolean>) => void];
  testID?: string;
}) {
  // Places with children start expanded, others collapsed; the user's choice overrides.
  const [ownToggled, setOwnToggled] = useState<ReadonlyMap<string, boolean>>(() => new Map());
  const toggled = expansion ? expansion[0] : ownToggled;
  const setToggled = expansion ? expansion[1] : setOwnToggled;

  const fullTree = useMemo(() => buildTree(plan.nodes), [plan.nodes]);
  const roots = useMemo(() => {
    if (rootId === null) return fullTree;
    const find = (items: readonly PlanTreeNode[]): PlanTreeNode | null => {
      for (const item of items) {
        if (item.node.id === rootId) return item;
        const found = find(item.children);
        if (found) return found;
      }
      return null;
    };
    return find(fullTree)?.children ?? [];
  }, [fullTree, rootId]);

  const isExpanded = useCallback(
    (item: PlanTreeNode) => toggled.get(item.node.id) ?? item.children.length > 0,
    [toggled],
  );

  const rows = useMemo(() => {
    const result: TreeRow[] = [];
    const walk = (items: readonly PlanTreeNode[]) => {
      for (const item of items) {
        const expanded = isExpanded(item);
        result.push({
          kind: 'node',
          id: item.node.id,
          parentId: item.node.parentId,
          depth: item.depth,
          expanded,
          hasChildren: item.children.length > 0,
          draggable: true,
          tree: item,
          descendants: countBelow(item),
        });
        if (expanded) {
          walk(item.children);
          if (item.depth + 1 < PLANNER_LIMITS.maxDepth) {
            result.push({
              kind: 'add',
              id: `add:${item.node.id}`,
              parentId: item.node.id,
              depth: item.depth + 1,
              expanded: false,
              hasChildren: false,
              draggable: false,
              parentName: item.node.name,
              parentNodeId: item.node.id,
            });
          }
        }
      }
    };
    walk(roots);
    // In a subtree, depths are shown relative to its root.
    if (rootId !== null && roots[0]) {
      const base = roots[0].depth;
      for (const row of result) row.depth -= base;
    }
    return result;
  }, [roots, isExpanded, rootId]);

  const ordered = useMemo(() => {
    const sorted: PlanNode[] = [];
    const walk = (parentId: string | null) => {
      for (const child of childrenOf(plan.nodes, parentId)) {
        sorted.push(child);
        walk(child.id);
      }
    };
    walk(null);
    return sorted;
  }, [plan.nodes]);
  const siblings = useMemo(() => siblingMap(ordered), [ordered]);
  const allowed = useMemo(() => (rootId ? new Set(subtreeIds(plan.nodes, rootId)) : null), [plan.nodes, rootId]);

  const canPlaceIn = useCallback(
    (draggedId: string, parentId: string | null) => {
      if (allowed && (parentId === null || !allowed.has(parentId))) return false;
      return canMove(plan.nodes, draggedId, parentId).ok;
    },
    [plan.nodes, allowed],
  );

  const subtreeOf = useCallback((id: string) => subtreeIds(plan.nodes, id), [plan.nodes]);

  const toggle = (item: PlanTreeNode) =>
    setToggled((current) => new Map(current).set(item.node.id, !isExpanded(item)));

  const drop = (id: string, target: { parentId: string | null; index: number }) => {
    // Show the place where it landed.
    if (target.parentId) setToggled((current) => new Map(current).set(target.parentId as string, true));
    onMove(id, target);
  };

  const accessibleMove = (id: string, action: MoveAction) => {
    const node = plan.nodes.find((n) => n.id === id);
    if (!node) return;
    const list = siblings.get(node.parentId) ?? [];
    const index = list.indexOf(id);
    if (action === 'up' && index > 0) onMove(id, { parentId: node.parentId, index: index - 1 });
    else if (action === 'down' && index < list.length - 1) onMove(id, { parentId: node.parentId, index: index + 1 });
    else if (action === 'out' && node.parentId && node.parentId !== rootId) {
      const parent = plan.nodes.find((n) => n.id === node.parentId);
      if (!parent) return;
      const parentSiblings = siblings.get(parent.parentId) ?? [];
      onMove(id, { parentId: parent.parentId, index: parentSiblings.indexOf(parent.id) + 1 });
    }
  };

  const addIn = (parentId: string) =>
    router.push({ pathname: '/trips/[tripId]/plan/add', params: { tripId, parentId } });

  return (
    <DraggableList
      items={rows}
      allowNest
      siblings={siblings}
      subtreeOf={subtreeOf}
      canPlaceIn={canPlaceIn}
      onDrop={drop}
      onAccessibleMove={accessibleMove}
      indent={PLAN_INDENT}
      scroll={scroll}
      onDragActiveChange={onDragActiveChange}
      testID={testID}
      renderItem={(row, context) =>
        row.kind === 'add' ? (
          <AddPlaceRow parentName={row.parentName} depth={row.depth} onPress={() => addIn(row.parentNodeId)} />
        ) : (
          <PlanRow
            item={{ ...row.tree, depth: row.depth }}
            descendants={row.descendants}
            expanded={row.expanded}
            routeNumber={routeNumber.get(row.id) ?? null}
            visited={visited.has(row.id)}
            inNavigation={inNavigation.has(row.id)}
            handle={context.handle}
            highlight={context.isDropInside}
            dimmed={context.dragActive}
            onToggle={() => toggle(row.tree)}
            onOpen={() =>
              router.push({ pathname: '/trips/[tripId]/plan/place/[nodeId]', params: { tripId, nodeId: row.id } })
            }
            onMore={() => onMore(row.id)}
          />
        )
      }
    />
  );
}
