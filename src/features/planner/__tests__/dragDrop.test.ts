import { computeDrop, isNoOp, siblingMap, type DragRow } from '../dragDrop';

// Munnar (expanded) > Echo, Tea ; Athirappilly (collapsed, has children) ; Kochi
const rows: DragRow[] = [
  { id: 'munnar', parentId: null, depth: 0, expanded: true, hasChildren: true, top: 0, height: 50 },
  { id: 'echo', parentId: 'munnar', depth: 1, expanded: false, hasChildren: false, top: 50, height: 50 },
  { id: 'tea', parentId: 'munnar', depth: 1, expanded: false, hasChildren: false, top: 100, height: 50 },
  { id: 'ath', parentId: null, depth: 0, expanded: false, hasChildren: true, top: 150, height: 50 },
  { id: 'kochi', parentId: null, depth: 0, expanded: false, hasChildren: false, top: 200, height: 50 },
];
const siblings = siblingMap([
  { id: 'munnar', parentId: null },
  { id: 'ath', parentId: null },
  { id: 'kochi', parentId: null },
  { id: 'echo', parentId: 'munnar' },
  { id: 'tea', parentId: 'munnar' },
  { id: 'falls', parentId: 'ath' },
]);
const tree = (dragged: string[], canPlaceIn?: (p: string | null) => boolean) => ({
  allowNest: true,
  siblings,
  dragged: new Set(dragged),
  canPlaceIn,
});

describe('tree drop targets', () => {
  it('reorders within the same parent (index ignores the dragged item)', () => {
    // Drag Tea above Echo.
    expect(computeDrop(rows, 52, tree(['tea']))).toMatchObject({ kind: 'before', parentId: 'munnar', index: 0, depth: 1 });
    // Drag Echo below Tea.
    expect(computeDrop(rows, 145, tree(['echo']))).toMatchObject({ kind: 'after', parentId: 'munnar', index: 1 });
  });

  it('nests into another place (middle of a row) as its last child', () => {
    expect(computeDrop(rows, 175, tree(['kochi']))).toMatchObject({ kind: 'inside', rowId: 'ath', parentId: 'ath', index: 1, depth: 1 });
    expect(computeDrop(rows, 125, tree(['kochi']))).toMatchObject({ kind: 'inside', parentId: 'tea', index: 0, depth: 2 });
  });

  it('promotes a child next to a main destination', () => {
    expect(computeDrop(rows, 152, tree(['echo']))).toMatchObject({ kind: 'before', parentId: null, index: 1, depth: 0 });
    expect(computeDrop(rows, 300, tree(['echo']))).toMatchObject({ kind: 'after', parentId: null, index: 3, depth: 0 });
  });

  it('moves between parents and drops as first child below an expanded row', () => {
    expect(computeDrop(rows, 45, tree(['kochi']))).toMatchObject({ kind: 'after', parentId: 'munnar', index: 0, depth: 1 });
    expect(computeDrop(rows, 2, tree(['tea']))).toMatchObject({ kind: 'before', parentId: null, index: 0 });
  });

  it('never targets the dragged item or its own places, and respects canPlaceIn', () => {
    // Dragging Munnar with its children: hovering over its own places is not a drop target.
    expect(computeDrop(rows, 75, tree(['munnar', 'echo', 'tea']))).toBeNull();
    expect(computeDrop(rows, 152, tree(['munnar', 'echo', 'tea']))).toMatchObject({ rowId: 'ath', kind: 'before' });
    expect(computeDrop(rows, 175, tree(['kochi'], (p) => p !== 'ath'))).toBeNull();
  });

  it('detects drops that change nothing', () => {
    expect(computeDrop(rows, 60, tree(['echo']))).toBeNull(); // over itself
    const target = computeDrop(rows, 102, tree(['echo'])); // just above Tea = where it already is
    expect(target && isNoOp(target, { id: 'echo', parentId: 'munnar' }, siblings)).toBe(true);
    const moved = computeDrop(rows, 145, tree(['echo']));
    expect(moved && isNoOp(moved, { id: 'echo', parentId: 'munnar' }, siblings)).toBe(false);
  });
});

describe('flat drop targets (route)', () => {
  const flat: DragRow[] = ['a', 'b', 'c'].map((id, i) => ({ id, parentId: null, depth: 0, expanded: false, hasChildren: false, top: i * 60, height: 60 }));
  const order = siblingMap([{ id: 'a', parentId: null }, { id: 'b', parentId: null }, { id: 'c', parentId: null }]);
  const opts = (dragged: string) => ({ allowNest: false, siblings: order, dragged: new Set([dragged]) });
  it('only inserts before or after, never inside', () => {
    expect(computeDrop(flat, 70, opts('a'))).toMatchObject({ kind: 'before', index: 0 }); // top half of b
    expect(computeDrop(flat, 95, opts('a'))).toMatchObject({ kind: 'after', index: 1 }); // bottom half of b
    expect(computeDrop(flat, 500, opts('a'))).toMatchObject({ kind: 'after', index: 2 });
    expect(computeDrop(flat, -20, opts('c'))).toMatchObject({ kind: 'before', index: 0 });
  });
});
