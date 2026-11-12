// End-to-end test of the destination planner against the web export.
//
//   npx expo export --platform web --output-dir dist
//   npm run e2e:planner
//
// In a small-phone viewport: create a trip without destinations, start
// planning from the dashboard, build a nested plan, check that only main
// destinations become the trip's destinations, promote / move / reorder
// without touching the route, manage the route separately, remove with an
// explained route impact, rename from the place screen, use the Home and
// trip-menu entry points, then restart the browser to check persistence.

import { BASE, byId, check, iso, launch, plannerAdd, plannerMove, dragRouteStop, run, setStep, shot, text, waitText, within } from './harness.mjs';

const now = new Date();
const day = (d) => new Date(now.getFullYear(), now.getMonth() + 1, d);

async function destinationsOnDashboard(page, tripUrl) {
  await page.goto(tripUrl);
  await byId(page, 'trip-dashboard').waitFor();
  return (await text(page, 'plan-summary')).split('\n').map((l) => l.trim());
}

async function routeStops(page, tripUrl) {
  await page.goto(`${tripUrl}/plan/route`);
  await byId(page, 'plan-route').waitFor();
  await page.waitForTimeout(200);
  const ids = await page.locator('[data-testid^="route-stop-"]').evaluateAll((els) => els.map((e) => e.dataset.testid));
  return ids.map((id) => id.replace('route-stop-', ''));
}

async function openPlanner(page, tripUrl) {
  await page.goto(`${tripUrl}/plan`);
  await byId(page, 'planner-screen').waitFor();
}

await run('Planner test', async () => {
  let { context, page, errors, dialogs } = await launch();

  setStep('create a trip without destinations');
  await page.goto(`${BASE}/trips/new`);
  await byId(page, 'trip-name-input').waitFor({ timeout: 60_000 });
  await byId(page, 'trip-name-input').fill('Kerala Road Trip');
  await byId(page, 'category-leisure').click();
  await shot(page, 'm5-01-create-basics');
  await byId(page, 'wizard-next').click();
  await byId(page, 'trip-calendar-next-month').click();
  await byId(page, `calendar-day-${iso(day(10))}`).click();
  await byId(page, `calendar-day-${iso(day(15))}`).click();
  await byId(page, 'traveller-name-0').fill('Asha');
  await byId(page, 'wizard-next').click();
  await byId(page, 'transport-car').click();
  await byId(page, 'wizard-create').click();
  await byId(page, 'trip-created-start-planning').waitFor();
  const tripUrl = page.url().split('?')[0];
  check((await text(page, 'plan-summary')).includes('Start planning'), 'dashboard offers to start planning');
  await shot(page, 'm5-02-dashboard-created');
  await byId(page, 'trip-created-start-planning').getByText('Start planning', { exact: true }).click();
  await byId(page, 'planner-empty').waitFor();
  await shot(page, 'm5-03-planner-empty');
  check(true, 'empty planner explains what to do');

  setStep('build a nested plan');
  await plannerAdd(page, 'Munnar');
  await plannerAdd(page, 'Athirappilly');
  for (const place of ['Chokramudi Point', 'Echo Point', 'Mattupetty Dam']) await plannerAdd(page, place, { parent: 'Munnar' });
  await plannerAdd(page, 'Nearby Attraction A', { parent: 'Mattupetty Dam' });
  await plannerAdd(page, 'Athirappilly Waterfalls', { parent: 'Athirappilly', toggleRoute: true });
  await plannerAdd(page, 'Vazhachal Waterfalls', { parent: 'Athirappilly' });
  await waitText(page, 'planner-screen', (v) => v.includes('2 main destinations · 8 places · 3 route stops'));
  check(true, 'counts main destinations, places and route stops');
  await page.waitForTimeout(300);
  await shot(page, 'm5-04-planner-tree');
  check(
    (await destinationsOnDashboard(page, tripUrl)).includes('Munnar → Athirappilly'),
    'only main destinations become the trip’s destinations',
  );
  check(
    JSON.stringify(await routeStops(page, tripUrl)) === JSON.stringify(['Munnar', 'Athirappilly', 'Athirappilly Waterfalls']),
    'route has exactly the chosen stops',
  );

  setStep('same-name warning and collapse');
  await openPlanner(page, tripUrl);
  await byId(page, 'planner-add').click();
  await byId(page, 'plan-add-name').fill('echo point');
  await byId(page, 'plan-add-save').click();
  await byId(page, 'plan-add-same-name').waitFor();
  check(true, 'adding a same-named place asks first');
  await byId(page, 'plan-add').getByText('Cancel', { exact: true }).click();
  await byId(page, 'planner-screen').waitFor();
  await byId(page, 'plan-toggle-Munnar').click();
  await page.waitForTimeout(200);
  check((await byId(page, 'planner-screen').getByText('Chokramudi Point').count()) === 0, 'collapsing hides nested places');
  await byId(page, 'plan-toggle-Munnar').click();
  await byId(page, 'plan-row-Chokramudi Point').waitFor();

  setStep('promote a nested place');
  await byId(page, 'plan-more-Echo Point').click();
  await byId(page, 'sheet-action-promote').waitFor();
  await page.waitForTimeout(400);
  await shot(page, 'm5-05-node-actions');
  await byId(page, 'sheet-action-promote').click();
  await waitText(page, 'planner-screen', (v) => v.includes('3 main destinations'));
  check(
    (await destinationsOnDashboard(page, tripUrl)).includes('Munnar → Echo Point → Athirappilly'),
    'promoting adds a trip destination right after its old main destination',
  );
  check(
    JSON.stringify(await routeStops(page, tripUrl)) === JSON.stringify(['Munnar', 'Athirappilly', 'Athirappilly Waterfalls']),
    'promoting does not change the route',
  );

  setStep('move into another place');
  await openPlanner(page, tripUrl);
  await byId(page, 'plan-more-Munnar').click();
  await byId(page, 'sheet-action-move').click();
  await byId(page, 'plan-move').waitFor();
  check(await byId(page, 'plan-move-into-Nearby Attraction A').isDisabled(), 'cannot move a place inside its own places');
  await shot(page, 'm5-06-move');
  await openPlanner(page, tripUrl);
  await byId(page, 'plan-more-Echo Point').click();
  await byId(page, 'sheet-action-move').click();
  await byId(page, 'plan-move-into-Athirappilly').click();
  await byId(page, 'planner-screen').waitFor();
  check(
    (await destinationsOnDashboard(page, tripUrl)).includes('Munnar → Athirappilly'),
    'nesting a main destination removes it from the trip’s destinations',
  );

  setStep('reorder main destinations');
  await openPlanner(page, tripUrl);
  await plannerMove(page, 'Athirappilly', 'up');
  await page.waitForTimeout(300);
  check((await destinationsOnDashboard(page, tripUrl)).includes('Athirappilly → Munnar'), 'reordering updates the trip everywhere');
  check(
    JSON.stringify(await routeStops(page, tripUrl)) === JSON.stringify(['Munnar', 'Athirappilly', 'Athirappilly Waterfalls']),
    'reordering destinations does not reorder the route',
  );

  setStep('manage the route separately');
  await dragRouteStop(page, 'Athirappilly Waterfalls', 'Munnar', 'before');
  await byId(page, 'route-add-Echo Point').click();
  await byId(page, 'route-remove-Munnar').click();
  await page.waitForTimeout(300);
  await shot(page, 'm5-07-route');
  check(
    JSON.stringify(await routeStops(page, tripUrl)) === JSON.stringify(['Athirappilly Waterfalls', 'Athirappilly', 'Echo Point']),
    'route stops can be added, removed and reordered',
  );
  await openPlanner(page, tripUrl);
  await byId(page, 'plan-row-Munnar').waitFor();
  check(true, 'removing a route stop keeps the place in the plan');

  setStep('remove with an explained route impact');
  await byId(page, 'plan-more-Athirappilly').click();
  await byId(page, 'sheet-action-remove').click();
  await byId(page, 'plan-remove-options').waitFor();
  await shot(page, 'm5-08-remove-options');
  await byId(page, 'sheet-action-with-children').click();
  await waitText(page, 'planner-screen', (v) => v.includes('1 main destination'));
  const removal = dialogs.at(-1) ?? '';
  check(
    removal.includes('Your route loses 3 stops') && removal.includes('Athirappilly Waterfalls') && removal.includes('no longer be one of this trip'),
    'removal explained its effect on the route and destinations first',
  );
  check((await routeStops(page, tripUrl)).length === 0, 'removed places left the route');

  setStep('rename from the place screen');
  await openPlanner(page, tripUrl);
  await byId(page, 'plan-open-Munnar').click();
  await byId(page, 'plan-place').waitFor();
  await byId(page, 'plan-place-maps').waitFor();
  await byId(page, 'plan-place-name').fill('Munnar Hills');
  await byId(page, 'plan-place-notes').fill('Two nights, tea estates');
  await byId(page, 'plan-place-save').click();
  await within(page, 'plan-place', 'Munnar Hills').waitFor();
  await page.waitForTimeout(200);
  await shot(page, 'm5-09-place');
  check((await destinationsOnDashboard(page, tripUrl)).includes('Munnar Hills'), 'renaming a main destination renames it everywhere');

  setStep('entry points: trip menu, edit form and Home');
  await byId(page, 'trip-actions').click();
  await byId(page, 'sheet-action-plan').waitFor();
  await byId(page, 'sheet-action-edit').click();
  await byId(page, 'destinations-planner-link').waitFor();
  check((await text(page, 'destinations-planner-link')).includes('Munnar Hills'), 'edit form shows planner destinations');
  await byId(page, 'edit-destinations-in-planner').click();
  await byId(page, 'planner-screen').waitFor();
  check(true, 'edit form opens the planner');
  await page.goto(BASE);
  await byId(page, 'home-continue-planning').waitFor();
  check((await text(page, 'home-continue-planning')).includes('Kerala Road Trip'), 'Home offers to continue planning');
  await shot(page, 'm5-10-home');
  await byId(page, 'home-continue-planning').click();
  await byId(page, 'planner-screen').waitFor();
  check(errors.length === 0, `no uncaught page errors (${errors.join(' | ') || 'none'})`);
  await context.close();

  setStep('after restart');
  ({ context, page, errors, dialogs } = await launch());
  await openPlanner(page, tripUrl);
  for (const name of ['Munnar Hills', 'Chokramudi Point', 'Mattupetty Dam', 'Nearby Attraction A']) {
    await byId(page, `plan-row-${name}`).waitFor({ timeout: 60_000 });
  }
  check(true, 'nested plan persisted');
  await page.goto(`${BASE}/trips`);
  await byId(page, 'trips-screen').waitFor();
  await within(page, 'trips-screen', 'Munnar Hills').waitFor();
  check(true, 'trip card route uses the planner’s destinations');
  check(errors.length === 0, `no uncaught page errors after restart (${errors.join(' | ') || 'none'})`);
  await context.close();
});
