// Destination page: hero (favourite, share, cover), quick actions, location,
// and the Overview / Explore / Prepare / Plan / Memories tabs — at a 360 px
// phone width, including a restart to confirm everything is saved on device.
//
//   npx expo export --platform web --output-dir dist && npm run e2e:destination
//   SCREENSHOT_DIR=/tmp/shots npm run e2e:destination

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

async function addPlace(page, name, inside) {
  if (inside) {
    if ((await byId(page, `plan-add-in-${inside}`).count()) === 0) await byId(page, `plan-toggle-${inside}`).click();
    await byId(page, `plan-add-in-${inside}`).click();
  } else {
    await byId(page, 'planner-add').click();
  }
  await byId(page, 'plan-add').waitFor();
  await byId(page, 'plan-add-name').fill(name);
  await byId(page, 'plan-add-save').click();
  await byId(page, 'planner-screen').waitFor();
  await byId(page, `plan-row-${name}`).waitFor();
}

async function openPlace(page, trip, name) {
  await page.goto(`${trip}/plan`);
  await byId(page, 'planner-screen').waitFor({ timeout: 60_000 });
  if ((await byId(page, `plan-open-${name}`).count()) === 0) await byId(page, 'planner-expand-all').click();
  await byId(page, `plan-open-${name}`).click();
  await byId(page, 'plan-place').waitFor();
  await byId(page, 'detail-panel-overview').waitFor();
}

async function setLocation(page, value) {
  await byId(page, 'detail-location-edit').click();
  await byId(page, 'detail-location-input').fill(value);
  await byId(page, 'detail-location-save').click();
  await byId(page, 'detail-coordinates').waitFor();
}

const tab = async (page, name) => {
  await byId(page, `detail-tab-${name}`).click();
  await byId(page, `detail-panel-${name}`).waitFor();
};

await run('Destination page test', async () => {
  let { context, page, errors } = await launch();

  setStep('set up a trip with a destination and a place inside it');
  const trip = await createTrip(page, 'Kerala Hills');
  await page.goto(`${trip}/plan`);
  await byId(page, 'planner-screen').waitFor();
  await addPlace(page, 'Munnar');
  await addPlace(page, 'Echo Point', 'Munnar');

  setStep('hero, tabs and honest "not connected" states');
  await openPlace(page, trip, 'Munnar');
  for (const t of ['overview', 'explore', 'prepare', 'plan', 'memories']) check((await byId(page, `detail-tab-${t}`).count()) === 1, `has the ${t} tab`);
  await byId(page, 'detail-weather-off').waitFor();
  check(/Add your own cover photo/.test(await text(page, 'detail-hero')), 'no cover photo is invented');
  check(/Route stop 1/.test(await text(page, 'detail-hero')), 'shows the route position');
  await shot(page, 'dest-01-overview');

  setStep('location: validation, coordinates, Maps link');
  await byId(page, 'detail-location-edit').click();
  await byId(page, 'detail-location-input').fill('https://maps.app.goo.gl/abc');
  check(/Short share links/.test(await text(page, 'detail-location-editor')), 'short links are explained, not guessed');
  check(await byId(page, 'detail-location-save').isDisabled(), 'cannot save an unreadable location');
  await byId(page, 'detail-location-search-off').waitFor();
  await byId(page, 'detail-location-input').fill('https://www.google.com/maps/place/Munnar/@10.0,77.0,13z/data=!3d10.0889!4d77.0595');
  await byId(page, 'detail-location-save').click();
  await waitText(page, 'detail-coordinates', (v) => v === '10.08890, 77.05950');
  check(true, 'reads the pinned place from a full Google Maps link');
  check((await text(page, 'detail-location')).includes('Change location'), 'offers to change the location');

  setStep('favourite and share');
  await byId(page, 'detail-save').click();
  await waitText(page, 'detail-hero', (v) => v.includes('Saved for later'));
  check(true, 'saved for later');
  await page.evaluate(() => {
    window.__shared = [];
    navigator.share = (data) => {
      window.__shared.push(data);
      return Promise.resolve();
    };
  });
  await byId(page, 'detail-share').click();
  await page.waitForTimeout(300);
  const shared = await page.evaluate(() => window.__shared.map((d) => `${d.title ?? ''}\n${d.text ?? ''}`).join('\n'));
  check(shared.includes('Munnar') && shared.includes('google.com/maps'), 'shares the name and a Maps link');

  setStep('overview: details, tags, notices with source and date');
  await byId(page, 'detail-about').fill('Tea hills and misty viewpoints');
  await byId(page, 'detail-season').fill('September to March');
  await byId(page, 'detail-facts-save').click();
  await waitText(page, 'detail-facts', (v) => v.includes('Details saved'));
  await byId(page, 'detail-tag-Must visit').click();
  await waitText(page, 'detail-hero', (v) => v.includes('Must visit'));
  await byId(page, 'detail-tag-input').fill('Rainy day');
  await byId(page, 'detail-tag-add').click();
  await waitText(page, 'detail-hero', (v) => v.includes('Rainy day'));
  check(true, 'preset and custom tags');
  await byId(page, 'detail-alert-add').click();
  await byId(page, 'detail-alert-kind-closure').click();
  await byId(page, 'detail-alert-title').fill('Gap road closed at night');
  check(await byId(page, 'detail-alert-save').isDisabled(), 'a notice needs a source');
  await byId(page, 'detail-alert-source').fill('District collector notice');
  await byId(page, 'detail-alert-date').fill(iso(now));
  await byId(page, 'detail-alert-save').click();
  await byId(page, 'detail-alert-Gap road closed at night').waitFor();
  check((await text(page, 'detail-alert-Gap road closed at night')).includes('Source: District collector notice · checked'), 'shows the source and date');
  await shot(page, 'dest-02-notices');

  setStep('prepare: suggested and own tasks, progress');
  await tab(page, 'prepare');
  await byId(page, 'detail-suggest-Carry water and snacks').click();
  await byId(page, 'detail-task-Carry water and snacks').waitFor();
  check((await byId(page, 'detail-suggest-Carry water and snacks').count()) === 0, 'an added suggestion is no longer suggested');
  await byId(page, 'detail-task-input').fill('Book the jeep safari');
  await byId(page, 'detail-task-cat-tickets').click();
  await byId(page, 'detail-task-add').click();
  await byId(page, 'detail-task-Book the jeep safari').click();
  await waitText(page, 'detail-prepare-progress', (v) => v === '1 of 2 done');
  check(true, 'progress counts finished tasks');
  await shot(page, 'dest-03-prepare');

  setStep('plan: duration, best time, sunrise/sunset, notes');
  await tab(page, 'plan');
  await byId(page, 'detail-duration-120').click();
  await waitText(page, 'detail-visit-length', (v) => v === '2 h · A couple of hours');
  await byId(page, 'detail-duration-input').fill('300');
  await byId(page, 'detail-duration-set').click();
  await waitText(page, 'detail-visit-length', (v) => v === '5 h · Half day');
  await byId(page, 'detail-best-sunrise').click();
  check(/\d{1,2}:\d{2}/.test(await text(page, 'detail-sun')) && (await text(page, 'detail-sun')).includes('first trip day'), 'sunrise and sunset for the first trip day');
  check((await text(page, 'detail-plan-route')).includes('First stop of the route'), 'knows it is the first stop');
  await byId(page, 'detail-note-kind-food').click();
  await byId(page, 'detail-note-input').fill('Try the cardamom tea');
  await byId(page, 'detail-note-add').click();
  await byId(page, 'detail-note-food').waitFor();
  await shot(page, 'dest-04-plan');

  setStep('memories: rating and notes');
  await tab(page, 'memories');
  await byId(page, 'detail-rate-4').click();
  await byId(page, 'detail-memory-notes').fill('Clouds below us at dawn');
  await byId(page, 'detail-memory-save').click();
  await waitText(page, 'detail-memories', (v) => v.includes('Memory saved'));

  setStep('explore: places inside and recommendations');
  await tab(page, 'explore');
  check(/Places inside \(1\)/.test(await text(page, 'detail-explore')), 'lists places inside');
  await byId(page, 'rec-unconfigured').waitFor();
  check((await page.locator('[data-testid^="rec-add-"]').count()) === 0, 'no sample recommendations');

  setStep('quick actions on a place inside: route, distance, Navigation, visited');
  await openPlace(page, trip, 'Echo Point');
  await setLocation(page, '10.1500, 77.0595');
  await byId(page, 'plan-place-route').click();
  await waitText(page, 'detail-hero', (v) => v.includes('Route stop 2'));
  await tab(page, 'plan');
  await waitText(page, 'detail-plan-route', (v) => v.includes('After Munnar · about 6.8 km in a straight line'));
  check(true, 'shows the previous stop and straight-line distance');
  await byId(page, 'detail-navigation').click();
  await waitText(page, 'detail-quick-message', (v) => v.includes('Added to Navigation'));
  await byId(page, 'detail-visit').click();
  await waitText(page, 'detail-hero', (v) => v.includes('Visited'));
  check(true, 'marked visited');
  await byId(page, 'plan-place-route').click();
  await byId(page, 'detail-route-confirm').waitFor();
  check((await text(page, 'detail-route-confirm')).includes('stays in your plan'), 'removing from the route asks first');
  await byId(page, 'sheet-action-remove').click();
  await waitText(page, 'detail-hero', (v) => v.includes('Not on the route'));
  await page.goto(`${trip}/plan?tab=navigation`);
  await byId(page, 'nav-row-Echo Point').waitFor();
  check(true, 'Navigation keeps the place after it leaves the route');

  setStep('saved for later, tag filters and comparison');
  await page.goto(`${trip}/plan`);
  await byId(page, 'planner-compare').click();
  await byId(page, 'plan-compare').waitFor();
  await byId(page, 'compare-filter-saved').click();
  await byId(page, 'compare-pick-Munnar').waitFor();
  check((await byId(page, 'compare-pick-Echo Point').count()) === 0, 'Saved shows only places saved for later');
  await byId(page, 'compare-filter-tag-Rainy day').click();
  check((await byId(page, 'compare-pick-Munnar').count()) === 1 && (await byId(page, 'compare-pick-Echo Point').count()) === 0, 'filters by tag');
  await byId(page, 'compare-filter-all').click();
  await byId(page, 'compare-pick-Munnar').click();
  await byId(page, 'compare-pick-Echo Point').click();
  await byId(page, 'compare-table').waitFor();
  check((await text(page, 'compare-row-distance')).includes('6.8 km (straight line)'), 'compares straight-line distance');
  check((await text(page, 'compare-row-time')).includes('5 h · Half day') && (await text(page, 'compare-row-time')).includes('—'), 'compares the user’s own facts and marks gaps');
  check((await text(page, 'compare-row-status')).includes('Visited'), 'shows visited status');
  await shot(page, 'dest-06-compare');
  await byId(page, 'compare-open-Munnar').click();
  await byId(page, 'plan-place').waitFor();
  await byId(page, 'detail-offline').waitFor();
  check(/location, 2 tasks, 1 note, 1 notice, memories/.test(await text(page, 'detail-offline')), 'says what is stored on the device');
  check(errors.length === 0, `no uncaught page errors (${errors.join(' | ') || 'none'})`);
  await context.close();

  setStep('everything persists across a restart');
  ({ context, page, errors } = await launch());
  await openPlace(page, trip, 'Munnar');
  const hero = await text(page, 'detail-hero');
  check(hero.includes('Saved for later') && hero.includes('Must visit') && hero.includes('Rainy day') && hero.includes('Half day'), 'hero tags persisted');
  check((await byId(page, 'detail-about').inputValue()) === 'Tea hills and misty viewpoints', 'description persisted');
  await byId(page, 'detail-alert-Gap road closed at night').waitFor();
  check((await text(page, 'detail-coordinates')) === '10.08890, 77.05950', 'location persisted');
  await tab(page, 'prepare');
  check((await text(page, 'detail-prepare-progress')) === '1 of 2 done', 'tasks persisted');
  await tab(page, 'plan');
  await byId(page, 'detail-note-food').waitFor();
  await tab(page, 'memories');
  check((await byId(page, 'detail-memory-notes').inputValue()) === 'Clouds below us at dawn', 'memory persisted');
  await page.goto(`${trip}/plan/place/${encodeURIComponent('x')}`);
  await page.getByText('Not in this plan').waitFor();
  check(true, 'a missing place says so');
  check(errors.length === 0, `no uncaught page errors after restart (${errors.join(' | ') || 'none'})`);
  await shot(page, 'dest-05-restart');
});
