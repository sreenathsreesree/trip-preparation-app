/**
 * Drop targets for drag-and-drop in tree and flat lists (pure, no React).
 *
 * The list is rendered as visible rows in order, each with its measured top
 * and height. While dragging, the pointer's position inside the row under it
 * decides the intent:
 *
 *   top 30 %    → insert before that row (same parent)
 *   middle 40 % → put inside that row, as its last child (tree lists only)
 *   bottom 30 % → insert after it (or as the first child of an expanded row)
 *
 * The result is a parent and an index among that parent's children with the
 * dragged item left out — exactly what the repositories' move operations take.
 */

export interface DragRow {
  id: string;
  parentId: string | null;
  depth: number;
  /** Whether the row's children are currently shown right below it. */
  expanded: boolean;
  hasChildren: boolean;
  top: number;
  height: number;
}

export interface DropTarget {
  /** Where the indicator is drawn. */
  kind: 'before' | 'after' | 'inside';
  /** The row the indicator refers to. */
  rowId: string;
  parentId: string | null;
  /** Index among the new parent's children, not counting the dragged item. */
  index: number;
  /** Depth the item would have after the drop (for the indicator's indent). */
  depth: number;
}

export interface DropOptions {
  /** Tree lists allow nesting; flat lists (route) do not. */
  allowNest: boolean;
  /** Ordered child ids per parent (`null` = top level). */
  siblings: ReadonlyMap<string | null, readonly string[]>;
  /** Ids of the dragged item and everything inside it (never valid targets). */
  dragged: ReadonlySet<string>;
  /** Whether the dragged item may be placed under this parent (cycle / depth rules). */
  canPlaceIn?: (parentId: string | null) => boolean;
}

const BEFORE = 0.3;
const AFTER = 0.7;

function indexAmong(siblings: readonly string[] | undefined, dragged: ReadonlySet<string>, rowId: string): number {
  const list = (siblings ?? []).filter((id) => !dragged.has(id));
  const at = list.indexOf(rowId);
  return at === -1 ? list.length : at;
}

function childCount(siblings: readonly string[] | undefined, dragged: ReadonlySet<string>): number {
  return (siblings ?? []).filter((id) => !dragged.has(id)).length;
}

/** The drop target for a pointer at `y` (list coordinates), or null when there is none or it is not allowed. */
export function computeDrop(rows: readonly DragRow[], y: number, options: DropOptions): DropTarget | null {
  const { allowNest, siblings, dragged } = options;
  // Over the dragged item itself or one of its own places: no valid drop (never a cycle).
  const under = rows.find((row) => y >= row.top && y < row.top + row.height);
  if (under && dragged.has(under.id)) return null;
  const candidates = rows.filter((row) => !dragged.has(row.id));
  if (candidates.length === 0) return null;

  let target: DropTarget | null = null;
  const first = candidates[0] as DragRow;
  const last = candidates[candidates.length - 1] as DragRow;

  if (y < first.top) {
    target = { kind: 'before', rowId: first.id, parentId: first.parentId, index: indexAmong(siblings.get(first.parentId), dragged, first.id), depth: first.depth };
  } else if (y >= last.top + last.height) {
    target = {
      kind: 'after',
      rowId: last.id,
      parentId: last.parentId,
      index: indexAmong(siblings.get(last.parentId), dragged, last.id) + 1,
      depth: last.depth,
    };
  } else {
    // The row under the pointer (gaps between rows count as the row below).
    const row = candidates.find((r) => y < r.top + r.height) ?? last;
    const relative = row.height > 0 ? Math.min(1, Math.max(0, (y - row.top) / row.height)) : 0.5;
    const beforeLimit = allowNest ? BEFORE : 0.5;
    const afterLimit = allowNest ? AFTER : 0.5;
    if (relative < beforeLimit) {
      target = { kind: 'before', rowId: row.id, parentId: row.parentId, index: indexAmong(siblings.get(row.parentId), dragged, row.id), depth: row.depth };
    } else if (relative >= afterLimit) {
      if (allowNest && row.expanded && row.hasChildren) {
        // The next line is the row's first child: dropping here means "first inside".
        target = { kind: 'after', rowId: row.id, parentId: row.id, index: 0, depth: row.depth + 1 };
      } else {
        target = {
          kind: 'after',
          rowId: row.id,
          parentId: row.parentId,
          index: indexAmong(siblings.get(row.parentId), dragged, row.id) + 1,
          depth: row.depth,
        };
      }
    } else {
      target = { kind: 'inside', rowId: row.id, parentId: row.id, index: childCount(siblings.get(row.id), dragged), depth: row.depth + 1 };
    }
  }

  if (options.canPlaceIn && !options.canPlaceIn(target.parentId)) return null;
  return target;
}

/** True when dropping would leave the item exactly where it is. */
export function isNoOp(
  target: DropTarget,
  item: { id: string; parentId: string | null },
  siblings: ReadonlyMap<string | null, readonly string[]>,
): boolean {
  if (target.parentId !== item.parentId) return false;
  const current = (siblings.get(item.parentId) ?? []).indexOf(item.id);
  return current === target.index;
}

/** Ordered child ids per parent, from items with a parent and a sibling order. */
export function siblingMap<T extends { id: string; parentId: string | null }>(ordered: readonly T[]): Map<string | null, string[]> {
  const map = new Map<string | null, string[]>();
  for (const item of ordered) {
    const list = map.get(item.parentId);
    if (list) list.push(item.id);
    else map.set(item.parentId, [item.id]);
  }
  return map;
}
