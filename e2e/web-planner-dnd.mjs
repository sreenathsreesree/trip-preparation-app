// Destination planner upgrade: drag-and-drop hierarchy, route and Navigation,
// visited status, and the destination page — at a 360 px phone width.
//
//   npx expo export --platform web --output-dir dist && npm run e2e:planner-dnd
//   SCREENSHOT_DIR=/tmp/shots npm run e2e:planner-dnd

import { BASE, byId, check, dragElement, dragRouteStop, iso, launch, plannerTab, run, setStep, shot, text, waitText } from './harness.mjs';

const now = new Date();
const day = (d) => new Date(now.getFullYear(), now.getMonth() + 1, d);

async function createTrip(page, name) {
  await page.goto(`${BASE}/trips/new`);
  await byId(page, 'trip-name-input').waitFor({ timeout: 60_000 });
  await byId(page, 'trip-name-input').fill(name);
  await byId(page, 'category-mountains').click();
  await byId(page, 'wizard-next').click();
  await byId(page, 'trip-calendar-next-month').click();
  await byId(page, `calendar-day-${iso(day(10))}`).click();
  await byId(page, `calendar-day-${iso(day(14))}`).click();
  await byId(page, 'wizard-next').click();
  await byId(page, 'transport-car').click();
  await byId(page, 'wizard-create').click();
  await byId(page, 'trip-dashboard').waitFor();
  return page.url().split('?')[0];
}

async function addPlace(page, name, { inside, route = false } = {}) {
  if (inside) {
    if ((await byId(page, `plan-add-in-${inside}`).count()) === 0) await byId(page, `plan-toggle-${inside}`).click();
    await byId(page, `plan-add-in-${inside}`).click();
  } else {
    await byId(page, 'planner-add').click();
  }
  await byId(page, 'plan-add').waitFor();
  await byId(page, 'plan-add-name').fill(name);
  if (route) await byId(page, 'plan-add-route').click();
  await byId(page, 'plan-add-save').click();
  await byId(page, 'planner-screen').waitFor();
  await byId(page, `plan-row-${name}`).waitFor();
}

/** Drags a row's handle onto another row: 'before' (top), 'inside' (middle) or 'after' (bottom). */
export async function dragRow(page, scope, from, to, position) {
  const handle = byId(page, scope).getByTestId(`plan-row-${from}`).locator('[data-testid^="drag-"]');
  const target = byId(page, scope).getByTestId(`plan-row-${to}`);
  await dragElement(page, handle, target, position);
}

/** Visible order of rows in a tree, with their indentation (left offset) to show nesting. */
export async function treeOrder(page, scope) {
  return page.evaluate((id) => {
    const root = document.querySelector(`[data-testid="${id}"]`);
    if (!root) return [];
    return [...root.querySelectorAll('[data-testid^="plan-row-"]')].map((row) => {
      const name = row.getAttribute('data-testid').slice('plan-row-'.length);
      return `${'  '.repeat(Math.round(parseFloat(getComputedStyle(row).marginLeft) / 16))}${name}`;
    });
  }, scope);
}

/** Navigation rows in order, indented by nesting. */
async function navOrder(page) {
  await page.waitForTimeout(200);
  return page.evaluate(() =>
    [...document.querySelectorAll('[data-testid^="nav-row-"]')].map((row) => {
      const name = row.getAttribute('data-testid').slice('nav-row-'.length);
      return `${'  '.repeat(Math.round(parseFloat(getComputedStyle(row).marginLeft) / 16))}${name}`;
    }),
  );
}

/** Route stop names in order. */
export async function routeOrder(page, trip) {
  if (trip) {
    await page.goto(`${trip}/plan/route`);
    await byId(page, 'plan-route').waitFor();
  }
  await page.waitForTimeout(200);
  return page.evaluate(() =>
    [...document.querySelectorAll('[data-testid^="route-stop-"]')].map((el) => el.getAttribute('data-testid').slice('route-stop-'.length)),
  );
}

await run('Planner drag-and-drop test', async () => {
  let { context, page, errors } = await launch();
  if (process.env.DEBUG_DRAG) page.on('console', (m) => m.text().startsWith('DBG') && console.log(m.text()));

  setStep('build a plan');
  const trip = await createTrip(page, 'Kerala Loop');
  await page.goto(`${trip}/plan`);
  await byId(page, 'planner-screen').waitFor();
  await addPlace(page, 'Munnar', { route: true });
  await addPlace(page, 'Athirappilly', { route: true });
  await addPlace(page, 'Kochi');
  await addPlace(page, 'Echo Point', { inside: 'Munnar', route: true });
  await addPlace(page, 'Tea Museum', { inside: 'Munnar' });
  await addPlace(page, 'Mattupetty Dam', { inside: 'Echo Point' });
  check(
    JSON.stringify(await treeOrder(page, 'planner-tree')) ===
      JSON.stringify(['Munnar', '  Echo Point', '    Mattupetty Dam', '  Tea Museum', 'Athirappilly', 'Kochi']),
    'every level can be expanded and has its own Add place',
  );
  await shot(page, 'dnd-01-tree');
  const routeBefore = await routeOrder(page, trip);
  await page.goto(`${trip}/plan`);
  await byId(page, 'planner-tree').waitFor();

  setStep('reorder within a parent');
  await dragRow(page, 'planner-tree', 'Tea Museum', 'Echo Point', 'before');
  await waitText(page, 'planner-tree', (v) => v.indexOf('Tea Museum') < v.indexOf('Echo Point'));
  check(true, 'Tea Museum moved above Echo Point');

  setStep('nest into another place');
  await dragRow(page, 'planner-tree', 'Kochi', 'Athirappilly', 'inside');
  await waitText(page, 'planner-tree', (v) => v.includes('1 place inside'));
  check((await treeOrder(page, 'planner-tree')).includes('  Kochi'), 'Kochi is now inside Athirappilly');

  setStep('move between parents');
  await dragRow(page, 'planner-tree', 'Tea Museum', 'Athirappilly', 'inside');
  await page.waitForTimeout(300);
  const order = await treeOrder(page, 'planner-tree');
  check(order.indexOf('  Tea Museum') > order.indexOf('Athirappilly'), 'Tea Museum moved from Munnar to Athirappilly');

  setStep('promote to a main destination');
  await dragRow(page, 'planner-tree', 'Echo Point', 'Athirappilly', 'before');
  await page.waitForTimeout(300);
  check((await treeOrder(page, 'planner-tree')).includes('Echo Point'), 'Echo Point is now a main destination');
  check((await treeOrder(page, 'planner-tree')).includes('  Mattupetty Dam'), 'its own places moved with it');

  setStep('a place cannot go inside itself');
  const beforeCycle = await treeOrder(page, 'planner-tree');
  await dragRow(page, 'planner-tree', 'Athirappilly', 'Kochi', 'inside');
  check(JSON.stringify(await treeOrder(page, 'planner-tree')) === JSON.stringify(beforeCycle), 'dropping a place into its own child changes nothing');
  await shot(page, 'dnd-02-after-moves');

  setStep('route is untouched by hierarchy changes');
  check(JSON.stringify(await routeOrder(page, trip)) === JSON.stringify(routeBefore), `route stops and their order are unchanged (${routeBefore.join(', ')})`);

  setStep('route: drag to reorder, stops renumber, hierarchy untouched');
  await page.goto(`${trip}/plan`);
  await byId(page, 'planner-tree').waitFor();
  const treeBeforeRoute = await treeOrder(page, 'planner-tree');
  await plannerTab(page, 'route');
  for (const name of ['Munnar', 'Tea Museum']) await byId(page, `route-add-${name}`).click();
  await page.waitForTimeout(300);
  const initialRoute = await routeOrder(page);
  check(initialRoute.length === 4, `four stops (${initialRoute.join(', ')})`);
  const last = initialRoute[3];
  await dragRouteStop(page, last, initialRoute[0], 'before');
  const reordered = await routeOrder(page);
  check(reordered[0] === last && reordered.length === 4, `dragged the last stop to the top (${reordered.join(', ')})`);
  check((await text(page, `route-number-${last}`)) === '1', 'stops renumber after a move');
  await dragRouteStop(page, reordered[0], reordered[2], 'after');
  const reordered2 = await routeOrder(page);
  check(reordered2[2] === last, `moved it back down (${reordered2.join(', ')})`);
  await byId(page, `route-remove-${reordered2[3]}`).click();
  await page.waitForTimeout(300);
  const finalRoute = await routeOrder(page);
  check(finalRoute.length === 3, 'a stop can still be removed');
  await shot(page, 'dnd-03-route');
  await plannerTab(page, 'destinations');
  check(JSON.stringify(await treeOrder(page, 'planner-tree')) === JSON.stringify(treeBeforeRoute), 'reordering the route never changes the hierarchy');

  setStep('navigation: add places (nested under parents already in Navigation), no duplicates');
  await page.goto(`${trip}/plan?tab=navigation`);
  await byId(page, 'plan-navigation').waitFor();
  await byId(page, 'nav-empty').waitFor();
  await page.evaluate(() => {
    window.__opened = [];
    window.open = (url) => {
      window.__opened.push(String(url));
      return null;
    };
  });
  for (const name of ['Echo Point', 'Mattupetty Dam', 'Kochi', 'Munnar', 'Tea Museum', 'Athirappilly']) {
    await byId(page, `nav-add-${name}`).click();
    await byId(page, `nav-row-${name}`).waitFor();
  }
  const navStart = await navOrder(page);
  check(
    JSON.stringify(navStart) === JSON.stringify(['Echo Point', '  Mattupetty Dam', 'Kochi', 'Munnar', 'Tea Museum', 'Athirappilly']),
    `Navigation keeps parent-child nesting (${navStart.join(' | ')})`,
  );
  await plannerTab(page, 'destinations');
  await byId(page, 'plan-more-Kochi').click();
  await byId(page, 'sheet-action-nav-remove').waitFor();
  check((await byId(page, 'sheet-action-nav-add').count()) === 0, 'a place already in Navigation cannot be added twice');
  await page.keyboard.press('Escape');
  await page.mouse.click(180, 100);
  const treeBeforeNav = await treeOrder(page, 'planner-tree');
  const routeBeforeNav = await routeOrder(page, trip);
  await plannerTab(page, 'navigation');
  await page.evaluate(() => {
    window.__opened = [];
    window.open = (url) => {
      window.__opened.push(String(url));
      return null;
    };
  });

  setStep('navigation: drag to reorder and nest, independent of plan and route');
  const navHandle = (name) => byId(page, `nav-row-${name}`).locator('[data-testid^="drag-"]');
  await dragElement(page, navHandle('Kochi'), byId(page, 'nav-row-Athirappilly'), 'inside');
  await waitText(page, 'nav-list', (v) => v.indexOf('Kochi') > v.indexOf('Athirappilly'));
  await dragElement(page, navHandle('Munnar'), byId(page, 'nav-row-Echo Point'), 'before');
  await page.waitForTimeout(300);
  const navMoved = await navOrder(page);
  check(
    JSON.stringify(navMoved) === JSON.stringify(['Munnar', 'Echo Point', '  Mattupetty Dam', 'Tea Museum', 'Athirappilly', '  Kochi']),
    `Navigation reordered and nested (${navMoved.join(' | ')})`,
  );
  await shot(page, 'dnd-04-navigation');

  setStep('navigation: Google Maps links');
  await byId(page, 'nav-go-Munnar').click();
  let opened = await page.evaluate(() => window.__opened);
  check(opened.length === 1 && opened[0].includes('/maps/dir/?api=1') && new URL(opened[0]).searchParams.get('destination') === 'Munnar', `one place opens Google Maps directions (${opened[0]})`);
  await byId(page, 'nav-journey-go').click();
  await byId(page, 'nav-legs').waitFor();
  check((await byId(page, 'nav-legs').locator('[data-testid^="nav-leg-"][role="link"]').count()) === 2, 'six places become two browser legs (5 places per link)');
  check((await byId(page, 'nav-leg-1-title').innerText()).includes('Leg 1 of 2 · places 1–5'), 'leg 1 labelled with the places it covers');
  check((await byId(page, 'nav-leg-2-stops').innerText()) === 'Athirappilly → Kochi', 'leg 2 lists its places');
  await byId(page, 'nav-leg-1').click();
  await byId(page, 'nav-leg-2').click();
  opened = await page.evaluate(() => window.__opened);
  const leg1 = new URL(opened[1]).searchParams;
  const leg2 = new URL(opened[2]).searchParams;
  check(
    leg1.get('origin') === 'Munnar' && leg1.get('waypoints') === 'Echo Point|Mattupetty Dam|Tea Museum' && leg1.get('destination') === 'Athirappilly',
    'leg 1: from the first saved place through 3 stops',
  );
  check(leg2.get('origin') === 'Athirappilly' && !leg2.has('waypoints') && leg2.get('destination') === 'Kochi', 'leg 2 starts where leg 1 ended; no stop dropped');
  await shot(page, 'dnd-05-legs');

  setStep('navigation: remove keeps the plan and route');
  await byId(page, 'nav-remove-Tea Museum').click();
  await byId(page, 'nav-row-Tea Museum').waitFor({ state: 'detached' });
  await plannerTab(page, 'destinations');
  check(JSON.stringify(await treeOrder(page, 'planner-tree')) === JSON.stringify(treeBeforeNav), 'Navigation changes never touch the hierarchy');
  check(JSON.stringify(await routeOrder(page, trip)) === JSON.stringify(routeBeforeNav), 'Navigation changes never touch the route');
  await page.goto(`${trip}/plan?tab=navigation`);
  await byId(page, 'nav-list').waitFor();
  const navSaved = await navOrder(page);

  setStep('visited: mark, undo, completed section, shared with Navigation');
  await page.goto(`${trip}/plan`);
  await byId(page, 'planner-tree').waitFor();
  const treeBeforeVisit = await treeOrder(page, 'planner-tree');
  await plannerTab(page, 'route');
  const firstStop = (await routeOrder(page))[0];
  await byId(page, `route-visit-${firstStop}`).click();
  await byId(page, 'route-undo-notice').waitFor();
  await waitText(page, 'route-progress', (v) => v.startsWith('1 of 3'));
  check((await byId(page, `route-stop-${firstStop}`).count()) === 0, 'a visited stop leaves the active list');
  await byId(page, 'route-completed-toggle').click();
  await byId(page, `route-done-${firstStop}`).waitFor();
  check(true, 'it appears under Completed stops (collapsible)');
  await byId(page, `route-undo-${firstStop}`).click();
  await byId(page, `route-stop-${firstStop}`).waitFor();
  await waitText(page, 'route-progress', (v) => v.startsWith('0 of 3'));
  check(true, 'undo makes it upcoming again');
  await byId(page, `route-visit-${firstStop}`).click();
  await waitText(page, 'route-progress', (v) => v.startsWith('1 of 3'));
  await plannerTab(page, 'navigation');
  await byId(page, `nav-unvisit-${firstStop}`).waitFor();
  check((await text(page, 'nav-progress')).startsWith('1 of 5'), 'Navigation shows the same place as visited');
  await plannerTab(page, 'destinations');
  check(JSON.stringify(await treeOrder(page, 'planner-tree')) === JSON.stringify(treeBeforeVisit), 'visiting changes no order');
  check((await text(page, `plan-row-${firstStop}`)).includes('Visited'), 'the plan shows it as visited, still in place');
  await shot(page, 'dnd-06-visited');

  setStep('arrival prompts: permission denied keeps manual completion');
  await plannerTab(page, 'navigation');
  await byId(page, 'arrival-toggle').click();
  await byId(page, 'arrival-denied').waitFor();
  check(true, 'without location permission the feature stays off and explains why');

  setStep('hierarchy persists after a restart');
  const saved = await (async () => {
    await page.goto(`${trip}/plan`);
    await byId(page, 'planner-tree').waitFor();
    return treeOrder(page, 'planner-tree');
  })();
  await context.close();
  ({ context, page, errors } = await launch());
  await page.goto(`${trip}/plan`);
  await byId(page, 'planner-tree').waitFor({ timeout: 60_000 });
  await page.waitForTimeout(300);
  check(JSON.stringify(await treeOrder(page, 'planner-tree')) === JSON.stringify(saved), 'same hierarchy after restart');
  check((await text(page, `plan-row-${firstStop}`)).includes('Visited'), 'visited status persists after restart');
  // The visited stop now waits under "Completed stops"; the rest keep their order.
  check(
    JSON.stringify(await routeOrder(page, trip)) === JSON.stringify(finalRoute.filter((name) => name !== firstStop)),
    'same route order after restart',
  );
  await page.goto(`${trip}/plan?tab=navigation`);
  await byId(page, 'nav-list').waitFor();
  await page.waitForTimeout(300);
  check(JSON.stringify(await navOrder(page)) === JSON.stringify(navSaved), 'same Navigation list after restart');

  check(errors.length === 0, `no uncaught page errors (${errors.join('; ') || 'none'})`);
});
