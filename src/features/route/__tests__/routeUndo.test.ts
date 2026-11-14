
import { reorderSubset } from '../routeUndoRepository';

describe('reordering only the main destinations', () => {
  it('swaps the main stops into each other’s places and leaves the rest where they are', () => {
    // a, b, c are main destinations; x is a place inside a; v was visited.
    expect(reorderSubset(['v', 'a', 'x', 'b', 'c'], ['c', 'a', 'b'])).toEqual(['v', 'c', 'x', 'a', 'b']);
    expect(reorderSubset(['a', 'b'], ['a', 'b'])).toBeNull();
    expect(reorderSubset(['a', 'b'], ['a'])).toBeNull();
  });
});
