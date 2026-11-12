import { setupRepositories, tripInput } from '../../../../test/fixtures';
import { buildTree, PLANNER_LIMITS, routeNodes, type TreeNode, type TreeItem } from '../model';
import { cleanTags, navigationParentFor, routeIndexForUpcoming, taskProgress, visitLength, type NavItem } from '../companion';

async function setup() {
  const repos = await setupRepositories();
  const trip = await repos.trips.create(tripInput({ name: 'Kerala', destinations: [] }), { sections: [] });
  const add = async (name: string, parentId: string | null = null, addToRoute = false) =>
    (await repos.planner.addNode(trip.id, { name, parentId, addToRoute })).node;
  const munnar = await add('Munnar', null, true);
  const echo = await add('Echo Point', munnar.id, true);
  const tea = await add('Tea Museum', munnar.id);
  const kolukkumalai = await add('Kolukkumalai', munnar.id);
  const ath = await add('Athirappilly', null, true);
  return { ...repos, trip, munnar, echo, tea, kolukkumalai, ath };
}

/** Navigation as "name > child" lines, in order. */
async function navShape(ctx: Awaited<ReturnType<typeof setup>>) {
  const { navigation } = await ctx.companion.trip(ctx.trip.id);
  const plan = await ctx.planner.load(ctx.trip.id);
  const names = new Map(plan.nodes.map((n) => [n.id, n.name]));
  const render = (items: TreeNode<NavItem>[]): unknown[] =>
    items.map((i) => (i.children.length ? { [names.get(i.node.nodeId) ?? '?']: render(i.children) } : names.get(i.node.nodeId)));
  return render(buildTree(navigation));
}

const planSnapshot = async (ctx: Awaited<ReturnType<typeof setup>>) => {
  const plan = await ctx.planner.load(ctx.trip.id);
  return {
    tree: plan.nodes.map((n) => [n.id, n.parentId, n.position]).sort(),
    route: routeNodes(plan).map((n) => n.name),
  };
};

describe('Navigation list', () => {
  it('nests a place under its nearest plan ancestor already in Navigation, never twice', async () => {
    const ctx = await setup();
    await ctx.companion.addToNavigation(ctx.trip.id, ctx.echo.id);
    await ctx.companion.addToNavigation(ctx.trip.id, ctx.munnar.id);
    await ctx.companion.addToNavigation(ctx.trip.id, ctx.tea.id);
    expect(await navShape(ctx)).toEqual(['Echo Point', { Munnar: ['Tea Museum'] }]);
    const again = await ctx.companion.addToNavigation(ctx.trip.id, ctx.tea.id);
    expect(again.status).toBe('duplicate');
    expect((await ctx.companion.trip(ctx.trip.id)).navigation).toHaveLength(3);
    ctx.db.close();
  });

  it('reorders, nests, promotes and moves between folders without touching the plan or the route', async () => {
    const ctx = await setup();
    const before = await planSnapshot(ctx);
    const item = async (nodeId: string) => (await ctx.companion.addToNavigation(ctx.trip.id, nodeId)).item;
    const munnar = await item(ctx.munnar.id);
    const tea = await item(ctx.tea.id); // under Munnar
    const ath = await item(ctx.ath.id);
    const echo = await item(ctx.echo.id); // under Munnar
    expect(await navShape(ctx)).toEqual([{ Munnar: ['Tea Museum', 'Echo Point'] }, 'Athirappilly']);

    await ctx.companion.moveNavigation(echo.id, { parentId: munnar.id, index: 0 }); // reorder within parent
    expect(await navShape(ctx)).toEqual([{ Munnar: ['Echo Point', 'Tea Museum'] }, 'Athirappilly']);
    await ctx.companion.moveNavigation(tea.id, { parentId: ath.id }); // move between parents
    expect(await navShape(ctx)).toEqual([{ Munnar: ['Echo Point'] }, { Athirappilly: ['Tea Museum'] }]);
    await ctx.companion.moveNavigation(echo.id, { parentId: null, index: 0 }); // promote
    expect(await navShape(ctx)).toEqual(['Echo Point', 'Munnar', { Athirappilly: ['Tea Museum'] }]);
    await ctx.companion.moveNavigation(munnar.id, { parentId: echo.id }); // nest
    expect(await navShape(ctx)).toEqual([{ 'Echo Point': ['Munnar'] }, { Athirappilly: ['Tea Museum'] }]);

    await expect(ctx.companion.moveNavigation(echo.id, { parentId: munnar.id })).rejects.toThrow('inside one of its own');
    await expect(ctx.companion.moveNavigation(echo.id, { parentId: echo.id })).rejects.toThrow('inside itself');
    expect(await planSnapshot(ctx)).toEqual(before);
    ctx.db.close();
  });

  it('refuses moves deeper than the nesting limit', async () => {
    const ctx = await setup();
    const ids: string[] = [];
    let parent: string | null = null;
    for (let i = 0; i < PLANNER_LIMITS.maxDepth; i += 1) {
      const node: { id: string } = (await ctx.planner.addNode(ctx.trip.id, { name: `Level ${i}`, parentId: parent })).node;
      ids.push(node.id);
      parent = node.id;
    }
    // A deep chain in Navigation (each under the previous one).
    const items: string[] = [];
    for (const id of ids) items.push((await ctx.companion.addToNavigation(ctx.trip.id, id)).item.id);
    const extra = (await ctx.companion.addToNavigation(ctx.trip.id, ctx.ath.id)).item;
    const deepest = items[items.length - 1] ?? '';
    await expect(ctx.companion.moveNavigation(extra.id, { parentId: deepest })).rejects.toThrow(`${PLANNER_LIMITS.maxDepth} levels`);
    ctx.db.close();
  });

  it('removing from Navigation keeps places inside, the plan and the route', async () => {
    const ctx = await setup();
    const before = await planSnapshot(ctx);
    const munnar = (await ctx.companion.addToNavigation(ctx.trip.id, ctx.munnar.id)).item;
    await ctx.companion.addToNavigation(ctx.trip.id, ctx.echo.id);
    await ctx.companion.addToNavigation(ctx.trip.id, ctx.tea.id);
    await ctx.companion.addToNavigation(ctx.trip.id, ctx.ath.id);
    await ctx.companion.removeFromNavigation(munnar.id);
    expect(await navShape(ctx)).toEqual(['Echo Point', 'Tea Museum', 'Athirappilly']);
    expect(await planSnapshot(ctx)).toEqual(before);
    ctx.db.close();
  });

  it('planner moves and route changes never change Navigation', async () => {
    const ctx = await setup();
    await ctx.companion.addToNavigation(ctx.trip.id, ctx.ath.id);
    await ctx.companion.addToNavigation(ctx.trip.id, ctx.echo.id);
    const shape = await navShape(ctx);
    await ctx.planner.moveNode(ctx.echo.id, { parentId: ctx.ath.id });
    await ctx.planner.moveRouteStop(ctx.trip.id, ctx.ath.id, 0);
    await ctx.planner.removeRouteStop(ctx.trip.id, ctx.echo.id);
    expect(await navShape(ctx)).toEqual(shape);
    // Removing the place itself from the plan removes it from Navigation too.
    await ctx.planner.removeNode(ctx.echo.id, 'withChildren');
    expect(await navShape(ctx)).toEqual(['Athirappilly']);
    ctx.db.close();
  });
});

describe('profiles and visits', () => {
  it('marks visited and back, independently for parents and children, without touching order', async () => {
    const ctx = await setup();
    const before = await planSnapshot(ctx);
    expect((await ctx.companion.node(ctx.echo.id)).profile).toMatchObject({ visitStatus: 'upcoming', createdAt: null });
    const visited = await ctx.companion.setVisited(ctx.echo.id, true);
    expect(visited.visitStatus).toBe('visited');
    expect(visited.visitedAt).toBeTruthy();
    expect((await ctx.companion.node(ctx.munnar.id)).profile.visitStatus).toBe('upcoming');
    expect((await ctx.companion.setVisited(ctx.echo.id, false))).toMatchObject({ visitStatus: 'upcoming', visitedAt: null });
    expect(await planSnapshot(ctx)).toEqual(before);
    ctx.db.close();
  });

  it('saves the user’s own facts, tags and visit length', async () => {
    const ctx = await setup();
    const profile = await ctx.companion.updateProfile(ctx.munnar.id, {
      saved: true,
      tags: ['Must visit', ' must visit ', 'Photography', ''],
      about: '  Tea country  ',
      bestSeason: 'Sep – Mar',
      visitMinutes: 240,
      bestTime: 'sunrise',
    });
    expect(profile).toMatchObject({ saved: true, tags: ['Must visit', 'Photography'], about: 'Tea country', visitMinutes: 240, bestTime: 'sunrise' });
    // Visit status is not changed by profile edits.
    await ctx.companion.setVisited(ctx.munnar.id, true);
    expect((await ctx.companion.updateProfile(ctx.munnar.id, { entryFee: '₹50' })).visitStatus).toBe('visited');
    await expect(ctx.companion.updateProfile(ctx.munnar.id, { visitMinutes: -5 })).rejects.toThrow('visit length');
    ctx.db.close();
  });
});

describe('preparation, notes, notices and memories', () => {
  it('manages a preparation checklist without duplicate suggested tasks', async () => {
    const ctx = await setup();
    const task = await ctx.companion.addTask(ctx.munnar.id, { title: 'Book jeep safari', category: 'tickets' });
    expect(await ctx.companion.addTasks(ctx.munnar.id, [
      { title: 'book jeep safari', category: 'tickets' },
      { title: 'Check opening hours', category: 'timings' },
    ])).toBe(1);
    const done = await ctx.companion.updateTask(task.id, { isDone: true, notes: 'Booked for 6 am' });
    expect(done).toMatchObject({ isDone: true, notes: 'Booked for 6 am' });
    expect(done.completedAt).toBeTruthy();
    const { tasks } = await ctx.companion.node(ctx.munnar.id);
    expect(taskProgress(tasks)).toEqual({ done: 1, total: 2, percent: 50 });
    expect((await ctx.companion.trip(ctx.trip.id)).taskCounts[ctx.munnar.id]).toEqual({ done: 1, total: 2 });
    await ctx.companion.removeTask(task.id);
    expect((await ctx.companion.node(ctx.munnar.id)).tasks.map((t) => t.title)).toEqual(['Check opening hours']);
    await expect(ctx.companion.addTask(ctx.munnar.id, { title: '  ' })).rejects.toThrow('title');
    ctx.db.close();
  });

  it('stores notes by kind and notices with their source', async () => {
    const ctx = await setup();
    const note = await ctx.companion.addNote(ctx.munnar.id, { kind: 'food', body: 'Try puttu and kadala' });
    expect((await ctx.companion.updateNote(note.id, { body: 'Try appam' })).body).toBe('Try appam');
    await expect(ctx.companion.addNote(ctx.munnar.id, { kind: 'food', body: '   ' })).rejects.toThrow();
    await expect(ctx.companion.addAlert(ctx.munnar.id, { kind: 'closure', title: 'Gap road closed', source: '' })).rejects.toThrow('comes from');
    await expect(
      ctx.companion.addAlert(ctx.munnar.id, { kind: 'closure', title: 'Gap road closed', source: 'News', sourceUrl: 'ftp://x' }),
    ).rejects.toThrow('http');
    const alert = await ctx.companion.addAlert(ctx.munnar.id, {
      kind: 'closure',
      title: 'Gap road closed at night',
      source: 'District collector notice',
      sourceUrl: 'https://example.org/notice',
      confirmed: true,
      observedAt: '2026-11-10T09:00:00Z',
    });
    expect(alert).toMatchObject({ confirmed: true, status: 'saved', observedAt: '2026-11-10T09:00:00Z' });
    expect((await ctx.companion.setAlertStatus(alert.id, 'dismissed')).status).toBe('dismissed');
    ctx.db.close();
  });

  it('keeps personal memories separate from public data', async () => {
    const ctx = await setup();
    const memory = await ctx.companion.saveMemory(ctx.echo.id, { visitedOn: '2026-12-21', rating: 5, notes: 'Misty morning' });
    expect(memory).toMatchObject({ visitedOn: '2026-12-21', rating: 5, notes: 'Misty morning', photos: [] });
    const updated = await ctx.companion.saveMemory(ctx.echo.id, { photos: ['file:///a.jpg'], moments: 'Saw an elephant' });
    expect(updated).toMatchObject({ rating: 5, notes: 'Misty morning', photos: ['file:///a.jpg'], moments: 'Saw an elephant' });
    await expect(ctx.companion.saveMemory(ctx.echo.id, { rating: 7 })).rejects.toThrow('1 to 5');
    await expect(ctx.companion.saveMemory(ctx.echo.id, { visitedOn: 'yesterday' })).rejects.toThrow('date');
    ctx.db.close();
  });
});

describe('trip duplication', () => {
  it('copies profiles (as upcoming), tasks (not done), notes and Navigation; not notices or memories', async () => {
    const ctx = await setup();
    await ctx.companion.updateProfile(ctx.munnar.id, { tags: ['Must visit'], visitMinutes: 120 });
    await ctx.companion.setVisited(ctx.munnar.id, true);
    const task = await ctx.companion.addTask(ctx.munnar.id, { title: 'Book stay', category: 'stay' });
    await ctx.companion.updateTask(task.id, { isDone: true });
    await ctx.companion.addNote(ctx.munnar.id, { kind: 'why', body: 'Tea hills' });
    await ctx.companion.addAlert(ctx.munnar.id, { kind: 'info', title: 'x', source: 'y' });
    await ctx.companion.saveMemory(ctx.munnar.id, { rating: 4 });
    await ctx.companion.addToNavigation(ctx.trip.id, ctx.munnar.id);
    await ctx.companion.addToNavigation(ctx.trip.id, ctx.echo.id);

    const copy = await ctx.trips.duplicate(ctx.trip.id);
    const plan = await ctx.planner.load(copy.id);
    const munnarCopy = plan.nodes.find((n) => n.name === 'Munnar')!;
    const details = await ctx.companion.node(munnarCopy.id);
    expect(details.profile).toMatchObject({ visitStatus: 'upcoming', tags: ['Must visit'], visitMinutes: 120 });
    expect(details.tasks.map((t) => [t.title, t.isDone])).toEqual([['Book stay', false]]);
    expect(details.notes.map((n) => n.body)).toEqual(['Tea hills']);
    expect(details.alerts).toEqual([]);
    expect(details.memory).toBeNull();
    const nav = (await ctx.companion.trip(copy.id)).navigation;
    expect(nav).toHaveLength(2);
    expect(nav.every((item) => plan.nodes.some((n) => n.id === item.nodeId))).toBe(true);
    ctx.db.close();
  });
});

describe('pure helpers', () => {
  it('cleans tags, sizes visits and finds a navigation parent', () => {
    expect(cleanTags(['A', 'a', '  b  ', ''])).toEqual(['A', 'b']);
    expect(visitLength(30)?.label).toBe('Quick stop');
    expect(visitLength(240)?.label).toBe('Half day');
    expect(visitLength(480)?.label).toBe('Full day');
    expect(visitLength(null)).toBeNull();
    const nav = [{ id: 'v1', nodeId: 'grand' }, { id: 'v2', nodeId: 'other' }];
    expect(navigationParentFor(['parent', 'grand'], nav)).toBe('v1');
    expect(navigationParentFor(['parent'], nav)).toBeNull();
    const tree: TreeItem[] = [];
    expect(buildTree(tree)).toEqual([]);
  });
});

describe('route order with completed stops', () => {
  it('maps drops among upcoming stops to the full route, keeping visited stops in place', () => {
    const route = ['a', 'b', 'c', 'd', 'e'];
    const visited = new Set(['b', 'd']);
    // Upcoming: a, c, e. Drag e to the top: before a.
    expect(routeIndexForUpcoming(route, visited, 'e', 0)).toBe(0);
    // Drag a after c (index 1 among [c, e] → before e).
    expect(routeIndexForUpcoming(route, visited, 'a', 1)).toBe(3);
    // Drag a to the end (after e).
    expect(routeIndexForUpcoming(route, visited, 'a', 2)).toBe(4);
    expect(routeIndexForUpcoming(['a', 'b'], new Set(['b']), 'a', 0)).toBe(1);
  });

  it('saves arrival prompt settings on the device (off by default)', async () => {
    const ctx = await setup();
    expect(await ctx.companion.arrivalSettings()).toEqual({ enabled: false, radiusMeters: 150, dwellMinutes: 4 });
    expect(await ctx.companion.saveArrivalSettings({ enabled: true, radiusMeters: 200, dwellMinutes: 5 })).toMatchObject({ enabled: true });
    expect(await ctx.companion.arrivalSettings()).toEqual({ enabled: true, radiusMeters: 200, dwellMinutes: 5 });
    ctx.db.close();
  });
});
