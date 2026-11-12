import { setupRepositories, tripInput } from '../../../../test/fixtures';
import { compareRows, filterPlaces, tagsInUse } from '../compare';

async function setup() {
  const repos = await setupRepositories();
  const trip = await repos.trips.create(tripInput({ name: 'Kerala', destinations: [] }), { sections: [] });
  const add = async (name: string, parentId: string | null = null, addToRoute = false) =>
    (await repos.planner.addNode(trip.id, { name, parentId, addToRoute })).node;
  const munnar = await add('Munnar', null, true);
  const echo = await add('Echo Point', munnar.id);
  const ath = await add('Athirappilly', null, true);
  await repos.planner.setNodePlace(munnar.id, { provider: 'manual', providerPlaceId: null, name: 'Munnar', location: { latitude: 10.0889, longitude: 77.0595 } });
  await repos.planner.setNodePlace(ath.id, { provider: 'manual', providerPlaceId: null, name: 'Athirappilly', location: { latitude: 10.2851, longitude: 76.5698 } });
  await repos.companion.updateProfile(munnar.id, { saved: true, tags: ['Must visit', 'Photography'], visitMinutes: 480, bestTime: 'morning', entryFee: 'Free' });
  await repos.companion.updateProfile(echo.id, { tags: ['Photography'] });
  await repos.companion.addTasks(munnar.id, [
    { title: 'Book stay', category: 'stay' },
    { title: 'Carry jacket', category: 'clothing' },
  ]);
  const tasks = (await repos.companion.node(munnar.id)).tasks;
  await repos.companion.updateTask(tasks[0]?.id as string, { isDone: true });
  const plan = await repos.planner.load(trip.id);
  const companion = await repos.companion.trip(trip.id);
  return { plan, companion, munnar, echo, ath };
}

describe('saved places, tags and comparison', () => {
  it('filters by saved and by tag, in plan order', async () => {
    const { plan, companion } = await setup();
    const names = (f: Parameters<typeof filterPlaces>[2]) => filterPlaces(plan, companion.profiles, f).map((n) => n.name);
    expect(names({ kind: 'all' })).toEqual(['Munnar', 'Echo Point', 'Athirappilly']);
    expect(names({ kind: 'saved' })).toEqual(['Munnar']);
    expect(names({ kind: 'tag', tag: 'Photography' })).toEqual(['Munnar', 'Echo Point']);
    expect(tagsInUse(companion.profiles)).toEqual(['Photography', 'Must visit']);
  });

  it('compares only the user’s own information and says when something is missing', async () => {
    const { plan, companion } = await setup();
    const picked = ['Munnar', 'Athirappilly', 'Echo Point'].map((n) => plan.nodes.find((x) => x.name === n)!);
    const rows = Object.fromEntries(compareRows(plan, companion.profiles, companion.taskCounts, picked).map((r) => [r.key, r.values]));
    expect(rows.route).toEqual(['Stop 1', 'Stop 2', 'Not on route']);
    expect(rows.distance?.[0]).toBe('—');
    expect(rows.distance?.[1]).toMatch(/^5\d km \(straight line\)$/);
    expect(rows.distance?.[2]).toBe('No location');
    expect(rows.time).toEqual(['8 h · Full day', '—', '—']);
    expect(rows.best).toEqual(['Morning', '—', '—']);
    expect(rows.fee).toEqual(['Free', '—', '—']);
    expect(rows.prep).toEqual(['1 of 2 done', '—', '—']);
    expect(rows.tags).toEqual(['Must visit, Photography', '—', 'Photography']);
  });
});
