import { useCallback, useMemo, type ReactNode } from 'react';

import { DraggableList, type DraggableItem, type RenderContext } from '../../planner/components/DraggableList';

/**
 * A flat list whose rows are reordered by dragging their handle (the planner's drag-and-drop),
 * with Move up / Move down available to screen readers. Calls `onReorder` with the new order.
 */
export function ReorderList<T extends { id: string }>({
  items,
  renderItem,
  onReorder,
  draggable = true,
  testID,
}: {
  items: readonly T[];
  renderItem: (item: T, context: RenderContext, index: number) => ReactNode;
  onReorder: (orderedIds: string[]) => void;
  draggable?: boolean;
  testID?: string;
}) {
  type Row = DraggableItem & { item: T; index: number };
  const rows: Row[] = useMemo(
    () => items.map((item, index) => ({ id: item.id, parentId: null, depth: 0, expanded: false, hasChildren: false, draggable, item, index })),
    [items, draggable],
  );
  const siblings = useMemo(() => new Map<string | null, readonly string[]>([[null, items.map((i) => i.id)]]), [items]);
  const subtreeOf = useCallback((id: string) => [id], []);
  const canPlaceIn = useCallback((_: string, parentId: string | null) => parentId === null, []);
  const moveTo = (id: string, index: number) => {
    const ids = items.map((i) => i.id).filter((x) => x !== id);
    ids.splice(Math.max(0, Math.min(index, ids.length)), 0, id);
    if (ids.join() !== items.map((i) => i.id).join()) onReorder(ids);
  };
  return (
    <DraggableList
      items={rows}
      allowNest={false}
      siblings={siblings}
      subtreeOf={subtreeOf}
      canPlaceIn={canPlaceIn}
      onDrop={(id, target) => moveTo(id, target.index)}
      onAccessibleMove={(id, action) => {
        const index = items.findIndex((i) => i.id === id);
        if (action === 'up' && index > 0) moveTo(id, index - 1);
        if (action === 'down' && index < items.length - 1) moveTo(id, index + 1);
      }}
      indent={0}
      renderItem={(row, context) => renderItem(row.item, context, row.index)}
      testID={testID}
    />
  );
}

/** Moves one id up or down in an order (for the explicit Move up / Move down actions). */
export function moved(ids: readonly string[], id: string, direction: -1 | 1): string[] {
  const i = ids.indexOf(id);
  const j = i + direction;
  if (i < 0 || j < 0 || j >= ids.length) return [...ids];
  const next = [...ids];
  [next[i], next[j]] = [next[j] as string, next[i] as string];
  return next;
}
