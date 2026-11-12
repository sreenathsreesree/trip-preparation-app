// Destination planner upgrade: drag-and-drop hierarchy, route and Navigation,
// visited status, and the destination page — at a 360 px phone width.
//
//   npx expo export --platform web --output-dir dist && npm run e2e:planner-dnd
//   SCREENSHOT_DIR=/tmp/shots npm run e2e:planner-dnd

import { BASE, byId, check, iso, launch, run, setStep, shot, text, waitText } from './harness.mjs';

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

export async function dragElement(page, handle, target, position) {
  // Bring the handle to the middle of the screen (away from the auto-scroll edges).
  await handle.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(200);
  const hb = await handle.boundingBox();
  const tb = await target.boundingBox();
  if (!hb || !tb) throw new Error('drag: element not visible');
  const fraction = position === 'before' ? 0.1 : position === 'inside' ? 0.5 : 0.92;
  const x = hb.x + hb.width / 2;
  await page.mouse.move(x, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(x, hb.y + hb.height / 2 + 6, { steps: 3 });
  await page.mouse.move(x, tb.y + tb.height * fraction, { steps: 14 });
  await page.waitForTimeout(150);
  if (process.env.DEBUG_DRAG) await page.screenshot({ path: `${process.env.DEBUG_DRAG}/drag-${Date.now()}.png` });
  await page.mouse.up();
  await page.waitForTimeout(500);
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

/** Route stop names in order. */
export async function routeOrder(page, trip) {
  await page.goto(`${trip}/plan/route`);
  await byId(page, 'plan-route').waitFor();
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

  check(errors.length === 0, `no uncaught page errors (${errors.join('; ') || 'none'})`);
});
