// Planner reliability against the web export: offline use and a large plan.
//
//   npx expo export --platform web --output-dir dist
//   npm run e2e:planner-reliability
//
// 1. Offline: with the network cut (Playwright offline mode), the planner,
//    place details, the route and Home's "Continue planning" keep working,
//    because they only use the on-device database. On web, Expo Router loads
//    each screen's code on first visit, so the screens are opened once online
//    first (Android ships one bundle, so this warm-up is web-only).
// 2. Scale: a 100-place plan (10 main destinations x 9 places): expand /
//    collapse, scrolling, action sheets, reordering and the small-screen layout.

import { BASE, byId, check, iso, launch, plannerAdd, run, setStep, shot, text, waitText, within } from './harness.mjs';

const now = new Date();
const day = (d) => new Date(now.getFullYear(), now.getMonth() + 1, d);

async function createTrip(page, name, from, to) {
  await page.goto(`${BASE}/trips/new`);
  await byId(page, 'trip-name-input').waitFor({ timeout: 60_000 });
  await byId(page, 'trip-name-input').fill(name);
  await byId(page, 'category-mountains').click();
  await byId(page, 'wizard-next').click();
  await byId(page, 'trip-calendar-next-month').click();
  await byId(page, `calendar-day-${iso(day(from))}`).click();
  await byId(page, `calendar-day-${iso(day(to))}`).click();
  await byId(page, 'wizard-next').click();
  await byId(page, 'transport-car').click();
  await byId(page, 'wizard-create').click();
  await byId(page, 'trip-dashboard').waitFor();
  return page.url().split('?')[0];
}

/** Milliseconds from just before `action` until `predicate` holds (includes the click itself). */
async function timed(page, action, predicate, timeout = 10_000) {
  const started = Date.now();
  await action();
  while (Date.now() - started < timeout) {
    if (await predicate()) return Date.now() - started;
    await page.waitForTimeout(16);
  }
  throw new Error('Timed out measuring UI response');
}

const goBack = (page) => page.getByRole('button', { name: /back|close/i }).first().click();

await run('Planner reliability test', async () => {
  let { context, page, errors } = await launch();

  // ------------------------------------------------------------ Offline
  setStep('online warm-up: open each planner screen once');
  const tripUrl = await createTrip(page, 'Offline Spiti', 3, 8);
  await page.goto(`${tripUrl}/plan`);
  await byId(page, 'planner-screen').waitFor();
  await plannerAdd(page, 'Manali');
  await plannerAdd(page, 'Kaza');
  await byId(page, 'plan-open-Manali').click();
  await byId(page, 'plan-place').waitFor();
  await goBack(page);
  await byId(page, 'plan-more-Kaza').click();
  await byId(page, 'sheet-action-move').click();
  await byId(page, 'plan-move').waitFor();
  await goBack(page);
  await byId(page, 'planner-route').click();
  await byId(page, 'plan-route').waitFor();
  await goBack(page);
  await byId(page, 'planner-screen').waitFor();
  await goBack(page); // no history: goes Home inside the app (no reload)
  await byId(page, 'home-continue-planning').waitFor();

  setStep('offline: continue planning from Home');
  await context.setOffline(true);
  const online = await page.evaluate(() => navigator.onLine);
  check(online === false, 'browser is offline');
  await byId(page, 'home-continue-planning').click();
  await byId(page, 'planner-screen').waitFor();
  check(true, 'Home “Continue planning” opens the planner offline');

  setStep('offline: add, nest, rename, move, promote, reorder, route, remove');
  await plannerAdd(page, 'Hadimba Temple', { parent: 'Manali' });
  await plannerAdd(page, 'Old Manali', { parent: 'Manali', toggleRoute: true });
  await plannerAdd(page, 'Cafe 1947', { parent: 'Old Manali' });
  await plannerAdd(page, 'Key Monastery', { parent: 'Kaza' });
  await plannerAdd(page, 'Chandratal');
  check(true, 'manual places and nested places added offline');
  check(await byId(page, 'plan-row-Cafe 1947').isVisible(), 'three levels deep offline');

  await byId(page, 'plan-open-Hadimba Temple').click();
  await byId(page, 'plan-place').waitFor();
  await byId(page, 'plan-place-name').fill('Hadimba Devi Temple');
  await byId(page, 'plan-place-save').click();
  await within(page, 'plan-place', 'Hadimba Devi Temple').waitFor();
  await goBack(page);
  await byId(page, 'plan-row-Hadimba Devi Temple').waitFor();
  check(true, 'renamed offline');

  await byId(page, 'plan-more-Key Monastery').click();
  await byId(page, 'sheet-action-promote').click();
  await waitText(page, 'planner-screen', (v) => v.includes('4 main destinations'));
  await byId(page, 'plan-more-Chandratal').click();
  await byId(page, 'sheet-action-move').click();
  await byId(page, 'plan-move-into-Kaza').click();
  await byId(page, 'planner-screen').waitFor();
  await waitText(page, 'planner-screen', (v) => v.includes('3 main destinations'));
  check(true, 'promoted and nested offline');

  await byId(page, 'planner-reorder').click();
  await byId(page, 'plan-move-Kaza-up').click();
  await byId(page, 'planner-reorder').click();
  await byId(page, 'planner-route').click();
  await byId(page, 'plan-route').waitFor();
  await byId(page, 'route-add-Key Monastery').click();
  await byId(page, 'route-move-Key Monastery-up').click();
  await byId(page, 'route-remove-Kaza').click();
  await page.waitForTimeout(300);
  const stops = await page.locator('[data-testid^="route-stop-"]').evaluateAll((els) => els.map((e) => e.dataset.testid));
  check(
    // Chandratal was added as a main destination (route on by default); nesting it later kept its stop.
    JSON.stringify(stops) ===
      JSON.stringify(['route-stop-Manali', 'route-stop-Old Manali', 'route-stop-Key Monastery', 'route-stop-Chandratal']),
    `route edited offline (${stops.join(', ')})`,
  );
  await goBack(page);
  await byId(page, 'plan-more-Old Manali').click();
  await byId(page, 'sheet-action-remove').click();
  await byId(page, 'sheet-action-keep-children').click();
  await byId(page, 'plan-row-Cafe 1947').waitFor();
  await waitText(page, 'planner-screen', (v) => !v.includes('Old Manali'));
  check(true, 'removed offline (keeping what was inside)');

  setStep('offline: add screen and place details');
  await byId(page, 'planner-add').click();
  await byId(page, 'plan-add').waitFor();
  check(await byId(page, 'plan-add-search-unavailable').isVisible(), 'add screen explains search is unavailable, manual entry works');
  await goBack(page);
  await byId(page, 'plan-open-Manali').click();
  await byId(page, 'plan-place').waitFor();
  check(/places inside \(2\)/i.test(await text(page, 'plan-place')), 'saved place details open offline');
  await shot(page, 'f-01-offline-place');
  check(errors.length === 0, `no uncaught page errors offline (${errors.join(' | ') || 'none'})`);
  await context.setOffline(false);
  await context.close();

  setStep('offline changes persisted across a restart');
  ({ context, page, errors } = await launch());
  await page.goto(`${tripUrl}/plan`);
  await byId(page, 'planner-screen').waitFor({ timeout: 60_000 });
  for (const name of ['Kaza', 'Manali', 'Key Monastery', 'Hadimba Devi Temple', 'Cafe 1947', 'Chandratal']) {
    await byId(page, `plan-row-${name}`).waitFor();
  }
  await page.goto(tripUrl);
  await byId(page, 'trip-dashboard').waitFor();
  check((await text(page, 'plan-summary')).includes('Kaza → Manali → Key Monastery'), 'trip destinations persisted in order');

  // ------------------------------------------------------------ Scale
  setStep('scale: build a 100-place plan');
  const bigUrl = await createTrip(page, 'Grand Tour', 20, 27);
  await page.goto(`${bigUrl}/plan`);
  await byId(page, 'planner-screen').waitFor();
  const started = Date.now();
  for (let r = 1; r <= 10; r += 1) {
    await plannerAdd(page, `Region ${r}`, { toggleRoute: r % 2 === 0 });
    for (let p = 1; p <= 9; p += 1) await plannerAdd(page, `R${r} Spot ${p}`, { parent: `Region ${r}` });
  }
  await waitText(page, 'planner-screen', (v) => v.includes('10 main destinations · 100 places'));
  check(true, `100 places added through the UI in ${Math.round((Date.now() - started) / 1000)} s`);

  setStep('scale: expand / collapse, scroll, sheets, reorder');
  const collapseMs = await timed(
    page,
    () => byId(page, 'planner-expand-all').click(),
    async () => (await byId(page, 'plan-row-R5 Spot 5').count()) === 0,
  );
  check(collapseMs < 1500, `collapse all hides 90 nested rows in ${collapseMs} ms`);
  await shot(page, 'f-02-big-collapsed');
  const expandMs = await timed(
    page,
    () => byId(page, 'planner-expand-all').click(),
    async () => (await byId(page, 'plan-row-R10 Spot 9').count()) === 1,
  );
  check(expandMs < 1500, `expand all shows 100 rows in ${expandMs} ms`);
  const toggleMs = await timed(
    page,
    () => byId(page, 'plan-toggle-Region 7').click(),
    async () => (await byId(page, 'plan-row-R7 Spot 1').count()) === 0,
  );
  check(toggleMs < 1000, `collapsing one destination takes ${toggleMs} ms`);
  await byId(page, 'plan-toggle-Region 7').click();

  await byId(page, 'plan-row-R10 Spot 9').scrollIntoViewIfNeeded();
  await shot(page, 'f-03-big-bottom');
  const sheetMs = await timed(
    page,
    () => byId(page, 'plan-more-R10 Spot 9').click(),
    () => byId(page, 'sheet-action-promote').isVisible(),
  );
  check(sheetMs < 1500, `action sheet on the last row opens in ${sheetMs} ms`);
  await byId(page, 'sheet-action-promote').click();
  await waitText(page, 'planner-screen', (v) => v.includes('11 main destinations'));

  await byId(page, 'planner-reorder').click();
  const reorderMs = await timed(
    page,
    () => byId(page, 'plan-move-Region 10-up').click(),
    async () =>
      (await text(page, 'planner-screen')).indexOf('Region 10') < (await text(page, 'planner-screen')).indexOf('Region 9'),
  );
  check(reorderMs < 2000, `reordering a main destination in a 100-place plan takes ${reorderMs} ms`);

  setStep('rapid taps');
  // Three quick taps, each starting before the previous write finished.
  const down = byId(page, 'plan-move-Region 3-down');
  await Promise.all([down.click(), down.click({ delay: 5 }), down.click({ delay: 10 })]);
  await page.waitForTimeout(800);
  check((await byId(page, 'planner-screen').getByText('Not changed').count()) === 0, 'rapid reorder taps raise no errors');
  await byId(page, 'planner-reorder').click();
  const plannerOrder = await page
    .locator('[data-testid^="plan-row-Region "]')
    .evaluateAll((els) => els.map((e) => e.dataset.testid.replace('plan-row-', '')));
  await byId(page, 'planner-add').click();
  await byId(page, 'plan-add-name').fill('Tapped twice');
  await byId(page, 'plan-add-save').dblclick();
  await byId(page, 'planner-screen').waitFor();
  await byId(page, 'plan-row-Tapped twice').waitFor();
  await page.waitForTimeout(400);
  check((await byId(page, 'planner-screen').getByTestId('plan-row-Tapped twice').count()) === 1, 'a double-tapped Save adds once');

  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  check(width <= 360, `no horizontal overflow at 360 px (scroll width ${width})`);
  await page.goto(bigUrl);
  await byId(page, 'trip-dashboard').waitFor();
  const summary = await text(page, 'plan-summary');
  check(summary.includes('Region 10 → Region 9'), 'dashboard follows the reordered destinations');
  check(
    summary.includes(plannerOrder.filter((name) => name.startsWith('Region')).join(' → ')),
    'after rapid taps the trip’s destinations match the planner order exactly',
  );
  check(errors.length === 0, `no uncaught page errors (${errors.join(' | ') || 'none'})`);
  await context.close();
});
