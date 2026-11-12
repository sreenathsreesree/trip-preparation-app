import type { NavItem } from './companion';
import { childrenOf, type PlanNode } from './model';

/** The Navigation list in the user's saved order: depth-first, each place followed by the places nested in it. */
export function navigationOrder(items: readonly NavItem[]): NavItem[] {
  const result: NavItem[] = [];
  const walk = (parentId: string | null) => {
    for (const child of childrenOf(items, parentId)) {
      result.push(child);
      walk(child.id);
    }
  };
  walk(null);
  return result;
}

/** The places still to navigate to, in order: visited places are left out, nothing is reordered, a place appears once. */
export function journeyStops(ordered: readonly NavItem[], nodes: ReadonlyMap<string, PlanNode>, visited: ReadonlySet<string>): PlanNode[] {
  const seen = new Set<string>();
  return ordered.flatMap((item) => {
    const node = nodes.get(item.nodeId);
    if (!node || visited.has(node.id) || seen.has(node.id)) return [];
    seen.add(node.id);
    return [node];
  });
}
