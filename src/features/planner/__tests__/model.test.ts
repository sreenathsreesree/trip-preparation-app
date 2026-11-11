import {
  ancestorIds,
  buildTree,
  canMove,
  countDescendants,
  moveItem,
  PLANNER_LIMITS,
  routeNodes,
  subtreeHeight,
  subtreeIds,
  visibleRows,
  type PlanNode,
} from '../model';

const node = (id: string, parentId: string | null, position: number): PlanNode => ({
  id,
  tripId: 't',
  parentId,
  placeId: null,
  place: null,
  tripDestinationId: null,
  origin: 'planner',
  name: id,
  notes: '',
  position,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
});

// Kerala Road Trip: Munnar › (Chokramudi, Echo Point, Mattupetty › Nearby A); Athirappilly › (Falls, Vazhachal)
const kerala = [
  node('athirappilly', null, 1),
  node('munnar', null, 0),
  node('echo', 'munnar', 1),
  node('chokramudi', 'munnar', 0),
  node('mattupetty', 'munnar', 2),
  node('nearbyA', 'mattupetty', 0),
  node('falls', 'athirappilly', 0),
  node('vazhachal', 'athirappilly', 1),
];

describe('plan tree helpers', () => {
  it('builds an ordered, nested tree', () => {
    const tree = buildTree(kerala);
    expect(tree.map((t) => t.node.id)).toEqual(['munnar', 'athirappilly']);
    expect(tree[0]?.children.map((c) => c.node.id)).toEqual(['chokramudi', 'echo', 'mattupetty']);
    expect(tree[0]?.children[2]?.children[0]).toMatchObject({ depth: 2, node: { id: 'nearbyA' } });
    expect(countDescendants(tree[0] as never)).toBe(4);
  });

  it('treats nodes with a missing parent as roots and survives a corrupt cycle', () => {
    const orphan = node('lost', 'gone', 0);
    const cycleA = { ...node('a', 'b', 0) };
    const cycleB = { ...node('b', 'a', 0) };
    const tree = buildTree([...kerala, orphan, cycleA, cycleB]);
    expect(tree.map((t) => t.node.id)).toContain('lost');
    expect(ancestorIds([cycleA, cycleB], 'a')).toEqual(['b', 'a']);
  });

  it('finds ancestors, subtrees and heights', () => {
    expect(ancestorIds(kerala, 'nearbyA')).toEqual(['mattupetty', 'munnar']);
    expect(subtreeIds(kerala, 'munnar').sort()).toEqual(['chokramudi', 'echo', 'mattupetty', 'munnar', 'nearbyA']);
    expect(subtreeHeight(kerala, 'munnar')).toBe(2);
    expect(subtreeHeight(kerala, 'echo')).toBe(0);
  });

  it('refuses moves into itself, into its own descendants or too deep', () => {
    expect(canMove(kerala, 'munnar', 'munnar').ok).toBe(false);
    expect(canMove(kerala, 'munnar', 'nearbyA').ok).toBe(false);
    expect(canMove(kerala, 'mattupetty', 'athirappilly').ok).toBe(true);
    expect(canMove(kerala, 'nearbyA', null).ok).toBe(true);

    const chain = Array.from({ length: PLANNER_LIMITS.maxDepth }, (_, i) => node(`n${i}`, i === 0 ? null : `n${i - 1}`, 0));
    const last = `n${PLANNER_LIMITS.maxDepth - 1}`;
    expect(canMove([...chain, node('x', null, 1)], 'x', last).ok).toBe(false);
    expect(canMove([...chain, node('x', null, 1)], 'x', `n${PLANNER_LIMITS.maxDepth - 2}`).ok).toBe(true);
    // A place with a child needs two levels.
    const withChild = [...chain, node('x', null, 1), node('y', 'x', 0)];
    expect(canMove(withChild, 'x', `n${PLANNER_LIMITS.maxDepth - 2}`).ok).toBe(false);
  });

  it('shows children only of expanded nodes', () => {
    const tree = buildTree(kerala);
    expect(visibleRows(tree, new Set()).map((r) => r.node.id)).toEqual(['munnar', 'athirappilly']);
    expect(visibleRows(tree, new Set(['munnar', 'mattupetty'])).map((r) => r.node.id)).toEqual([
      'munnar',
      'chokramudi',
      'echo',
      'mattupetty',
      'nearbyA',
      'athirappilly',
    ]);
  });

  it('orders route nodes by stop position, independent of the tree', () => {
    const route = [
      { id: 's1', tripId: 't', nodeId: 'falls', position: 1 },
      { id: 's2', tripId: 't', nodeId: 'echo', position: 0 },
      { id: 's3', tripId: 't', nodeId: 'deleted', position: 2 },
    ];
    expect(routeNodes({ nodes: kerala, route }).map((n) => n.id)).toEqual(['echo', 'falls']);
  });

  it('moves list items with clamping', () => {
    expect(moveItem(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
    expect(moveItem(['a', 'b', 'c'], 2, -5)).toEqual(['c', 'a', 'b']);
    expect(moveItem(['a', 'b'], 5, 0)).toEqual(['a', 'b']);
  });
});
