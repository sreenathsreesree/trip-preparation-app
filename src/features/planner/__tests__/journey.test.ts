import { journeyLegs } from '../../places/mapsLinks';
import type { NavItem } from '../companion';
import { journeyStops, navigationOrder } from '../journey';
import type { PlanNode } from '../model';

const T = '2026-11-01T00:00:00Z';
const planNode = (id: string): PlanNode => ({
  id,
  tripId: 't',
  parentId: null,
  placeId: null,
  place: null,
  tripDestinationId: null,
  origin: 'manual' as PlanNode['origin'],
  name: id,
  notes: '',
  position: 0,
  createdAt: T,
  updatedAt: T,
});
const nav = (id: string, parentId: string | null, position: number): NavItem => ({
  id: `nav-${id}`,
  tripId: 't',
  nodeId: id,
  parentId: parentId ? `nav-${parentId}` : null,
  position,
  createdAt: T,
  updatedAt: T,
});

// Saved Navigation order (stored shuffled): Kochi, Munnar > (Echo Point, Mattupetty), Vagamon, Alleppey,
// Kumarakom, Thekkady > (Periyar), Varkala — 10 places.
const items: NavItem[] = [
  nav('Varkala', null, 6),
  nav('Mattupetty', 'Munnar', 1),
  nav('Kochi', null, 0),
  nav('Periyar', 'Thekkady', 0),
  nav('Munnar', null, 1),
  nav('Alleppey', null, 3),
  nav('Echo Point', 'Munnar', 0),
  nav('Thekkady', null, 5),
  nav('Vagamon', null, 2),
  nav('Kumarakom', null, 4),
];
const SAVED = ['Kochi', 'Munnar', 'Echo Point', 'Mattupetty', 'Vagamon', 'Alleppey', 'Kumarakom', 'Thekkady', 'Periyar', 'Varkala'];
const nodes = new Map(SAVED.map((id) => [id, planNode(id)]));
const stops = (visited: string[] = []) => journeyStops(navigationOrder(items), nodes, new Set(visited)).map((n) => n.name);

describe('journey stops', () => {
  it('follows the saved Navigation order, nested places after their parent', () => {
    expect(navigationOrder(items).map((i) => i.nodeId)).toEqual(SAVED);
    expect(stops()).toEqual(SAVED);
  });

  it('leaves visited places out without reordering the rest', () => {
    expect(stops(['Kochi', 'Echo Point', 'Periyar'])).toEqual(['Munnar', 'Mattupetty', 'Vagamon', 'Alleppey', 'Kumarakom', 'Thekkady', 'Varkala']);
    expect(stops(SAVED)).toEqual([]);
  });

  it('skips Navigation entries whose place was deleted and never repeats a place', () => {
    const extra = [...items, nav('Kochi', null, 7)].map((i, n) => (n === items.length ? { ...i, id: 'nav-dup' } : i));
    const withMissing = [...extra, nav('Gone', null, 8)];
    expect(journeyStops(navigationOrder(withMissing), nodes, new Set()).map((n) => n.name)).toEqual(SAVED);
  });

  it('opens all 10 saved places in one Google Maps app route, in order', () => {
    const [leg, ...rest] = journeyLegs(journeyStops(navigationOrder(items), nodes, new Set()), 'app');
    expect(rest).toEqual([]);
    const p = new URL(leg!.url).searchParams;
    expect(p.get('origin')).toBe('Kochi');
    expect(p.get('waypoints')!.split('|')).toEqual(SAVED.slice(1, -1));
    expect(p.get('destination')).toBe('Varkala');
  });

  it('starts the journey at the first place not yet visited', () => {
    const journey = journeyStops(navigationOrder(items), nodes, new Set(['Kochi', 'Munnar']));
    const legs = journeyLegs(journey, 'browser');
    expect(new URL(legs[0]!.url).searchParams.get('origin')).toBe('Echo Point');
    expect(legs.flatMap((l, i) => [...(i === 0 ? [l.from!.name] : []), ...l.stops.map((s) => s.name)])).toEqual(SAVED.slice(2));
    const one = journeyLegs(journeyStops(navigationOrder(items), nodes, new Set(SAVED.slice(0, -1))), 'app');
    expect(one).toHaveLength(1);
    expect(one[0]!.from).toBeNull(); // last place: directions from where you are
  });
});
