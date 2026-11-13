// Route Planner (road legs from OSRM fixtures, missing locations, optimise
// proposal → apply → restore), Group Trip without sharing, My Trip private
// documents — at 360 px. Provider calls are answered by harness fixtures.
//
//   npx expo export --platform web --output-dir dist && npm run e2e:journey
import { BASE, byId, check, iso, launch, plannerAdd, plannerTab, run, setStep, shot, text, waitText } from './harness.mjs';

const today = new Date();
const plus = (n) => new Date(today.getFullYear(), today.getMonth(), today.getDate() + n);
async function pickDay(page, date) {
  for (let i = 0; i < 3 && (await byId(page, `calendar-day-${iso(date)}`).count()) === 0; i++) await byId(page, 'trip-calendar-next-month').click();
  await byId(page, `calendar-day-${iso(date)}`).click();
}
async function createTrip(page, name) {
  await page.goto(`${BASE}/trips/new`);
  await byId(page, 'trip-name-input').waitFor({ timeout: 60_000 });
  await byId(page, 'trip-name-input').fill(name);
  await byId(page, 'category-mountains').click();
  await byId(page, 'wizard-next').click();
  await pickDay(page, plus(2));
  await pickDay(page, plus(5));
  await byId(page, 'wizard-next').click();
  await byId(page, 'transport-car').click();
  await byId(page, 'wizard-create').click();
  await byId(page, 'trip-dashboard').waitFor();
  return page.url().split('?')[0];
}
async function setLocation(page, trip, name, value) {
  await page.goto(`${trip}/plan`);
  await byId(page, `plan-open-${name}`).click();
  await byId(page, 'detail-location-edit').click();
  await byId(page, 'detail-location-input').fill(value);
  await byId(page, 'detail-location-save').click();
  await byId(page, 'detail-coordinates').waitFor();
}
const routeOrder = async (page) =>
  page.locator('[data-testid^="route-stop-"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid').replace('route-stop-', '')));

await run('Journey test', async () => {
  let { context, page, errors } = await launch();

  setStep('plan four destinations on the route');
  const trip = await createTrip(page, 'Kerala Loop');
  await page.goto(`${trip}/plan`);
  for (const n of ['Kochi', 'Munnar', 'Thekkady', 'Alleppey']) await plannerAdd(page, n);
  await setLocation(page, trip, 'Kochi', '9.9312, 76.2673');
  await setLocation(page, trip, 'Munnar', '10.0889, 77.0595');
  await setLocation(page, trip, 'Alleppey', '9.4981, 76.3388');

  setStep('route: road legs, a stop without a location, nothing guessed');
  await page.goto(`${trip}/plan`);
  await plannerTab(page, 'route');
  await byId(page, 'route-overview').waitFor();
  await byId(page, 'route-missing').waitFor();
  check(/Thekkady/.test(await text(page, 'route-missing')), 'the stop without a location is named');
  await waitText(page, 'route-leg-Kochi', (v) => /12\.0 km · about 25 min by road/.test(v));
  check(/needs both locations/.test(await text(page, 'route-leg-Munnar')), 'a leg to a stop without location is unavailable, not estimated');
  check(/1 of 3 legs measured by road/.test(await text(page, 'route-coverage')), 'coverage shown');
  check(/Google Maps: one route/.test(await text(page, 'route-maps-legs')), 'Google Maps split shown');
  await shot(page, 'journey-01-route');

  setStep('all locations: total road distance and time');
  await setLocation(page, trip, 'Thekkady', '9.6031, 77.1615');
  await page.goto(`${trip}/plan`);
  await plannerTab(page, 'route');
  await waitText(page, 'route-total', (v) => /39\.0 km · about 1 h 18 min driving/.test(v));
  check(/3 of 3 legs measured by road · live/.test(await text(page, 'route-coverage')), 'every leg measured, marked live');

  setStep('optimise: proposal first, applied only on request, then restored');
  const before = await routeOrder(page);
  check(JSON.stringify(before) === JSON.stringify(['Kochi', 'Munnar', 'Thekkady', 'Alleppey']), `starting order (${before})`);
  await byId(page, 'route-optimise').click();
  await byId(page, 'route-proposal').waitFor();
  check(JSON.stringify(await routeOrder(page)) === JSON.stringify(before), 'nothing reordered before the user agrees');
  await byId(page, 'route-proposal-apply').click();
  await waitText(page, 'route-message', (v) => /New order applied/.test(v));
  await page.waitForTimeout(300);
  check(JSON.stringify(await routeOrder(page)) === JSON.stringify(['Kochi', 'Thekkady', 'Munnar', 'Alleppey']), `suggested order applied (${await routeOrder(page)})`);
  await byId(page, 'route-restore').click();
  await waitText(page, 'route-message', (v) => /Previous order restored/.test(v));
  await page.waitForTimeout(300);
  check(JSON.stringify(await routeOrder(page)) === JSON.stringify(before), 'previous order restored');
  await shot(page, 'journey-02-optimise');

  setStep('Group Trip and My Trip');
  await page.goto(trip);
  await byId(page, 'trip-group').click();
  await byId(page, 'group-not-shared').waitFor();
  await page.goto(trip);
  await byId(page, 'trip-mine').click();
  await byId(page, 'my-trip-screen').waitFor();
  await byId(page, 'mydoc-title').fill('My passport');
  await byId(page, 'mydoc-ref').fill('P1234567');
  await byId(page, 'mydoc-add').click();
  await byId(page, 'mydoc-My passport').waitFor();
  check(/Passport · No\. P1234567/.test(await text(page, 'mydoc-My passport')), 'private document saved');

  setStep('offline after a restart: saved road legs and private documents');
  await context.close();
  const { providers } = await import('./harness.mjs');
  providers.offline = true;
  ({ context, page, errors } = await launch());
  await page.goto(`${trip}/plan`);
  await byId(page, 'planner-screen').waitFor({ timeout: 60_000 });
  await plannerTab(page, 'route');
  await waitText(page, 'route-coverage', (v) => /3 of 3 legs measured by road · saved/.test(v));
  await page.goto(`${trip}/mine`);
  await byId(page, 'mydoc-My passport').waitFor();
  providers.offline = false;
  check(errors.length === 0, `no uncaught page errors (${errors.join(' | ') || 'none'})`);
  await context.close();
});
