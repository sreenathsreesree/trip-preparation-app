// Travel experience: PDF itinerary import (review, edit, confirm; scanned PDF
// → paste text), Explore recommendations (live OpenStreetMap fixtures,
// distance filter, add under a destination, no duplicates), destination and
// trip weather with approved packing additions, automatic covers with credit,
// and offline use from saved data — at 360 px. Provider calls are answered by
// fixtures in the harness (no real network).
//
//   npx expo export --platform web --output-dir dist && npm run e2e:travel
import { readFileSync } from 'node:fs';

import { BASE, byId, check, expand, iso, launch, providers, run, setStep, shot, text, waitText } from './harness.mjs';

const today = new Date();
const plus = (n) => new Date(today.getFullYear(), today.getMonth(), today.getDate() + n);
const PDF = readFileSync(new URL('../test/pdf/itinerary-chrome.pdf', import.meta.url));
const SCANNED = readFileSync(new URL('../test/pdf/scanned-image-only.pdf', import.meta.url));

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
  await pickDay(page, plus(1));
  await pickDay(page, plus(4));
  await byId(page, 'wizard-next').click();
  await byId(page, 'transport-car').click();
  await byId(page, 'wizard-create').click();
  await byId(page, 'trip-dashboard').waitFor();
  return page.url().split('?')[0];
}

async function choosePdf(page, name, buffer) {
  const chooser = page.waitForEvent('filechooser');
  await byId(page, 'import-choose').click();
  await (await chooser).setFiles({ name, mimeType: 'application/pdf', buffer });
}

await run('Travel experience test', async () => {
  let { context, page, errors } = await launch();

  setStep('import a plan from a PDF: review and edit before anything is added');
  const trip = await createTrip(page, 'Kerala Getaway');
  await page.goto(`${trip}/plan`);
  await byId(page, 'planner-import-pdf').click();
  await byId(page, 'import-plan-screen').waitFor();
  await choosePdf(page, 'kerala-itinerary.pdf', PDF);
  await byId(page, 'import-draft').waitFor({ timeout: 20_000 });
  for (const n of ['Munnar', 'Alleppey', 'Mattupetty Dam', 'Echo Point', 'Tea County Resort', 'Cochin International Airport']) await byId(page, `import-item-${n}`).waitFor();
  check((await byId(page, 'import-kind-Tea County Resort-hotel').getAttribute('aria-selected')) !== 'false', 'hotel recognised as a stay');
  await byId(page, 'import-include-Saravana Bhavan').click(); // leave out a restaurant
  await byId(page, 'import-remove-Rapsy Restaurant').click();
  await shot(page, 'travel-01-draft');
  // Nothing added before Confirm.
  await page.goto(`${trip}/plan`);
  await byId(page, 'planner-screen').waitFor();
  check((await byId(page, 'plan-row-Munnar').count()) === 0, 'the trip is unchanged until the draft is confirmed');
  await byId(page, 'planner-import-pdf').click();
  await byId(page, 'import-record-kerala-itinerary.pdf').click(); // the saved draft (with the edits) comes back
  await byId(page, 'import-draft').waitFor();
  check((await byId(page, 'import-item-Rapsy Restaurant').count()) === 0, 'edits to the draft were kept');
  await byId(page, 'import-confirm').click();
  await byId(page, 'import-done').waitFor();
  check(/2 destinations/.test(await text(page, 'import-done')), `summary shown (${await text(page, 'import-done')})`);
  await page.goto(`${trip}/plan`);
  await byId(page, 'plan-row-Munnar').waitFor();
  check((await byId(page, 'plan-row-Saravana Bhavan').count()) === 0, 'left-out items are not added');
  check((await byId(page, 'plan-row-Cochin International Airport').count()) === 0, 'transport stops are not made destinations by default');

  setStep('scanned PDF: kept, and the text can be pasted instead');
  await byId(page, 'planner-import-pdf').click();
  await choosePdf(page, 'scan.pdf', SCANNED);
  await byId(page, 'import-error').waitFor({ timeout: 20_000 });
  check(/looks scanned/.test(await text(page, 'import-error')), 'scanned PDF explained, nothing invented');
  await byId(page, 'import-back').click().catch(() => undefined);
  await byId(page, 'import-paste').fill('Day 5 - Kumarakom\nVisit Kumarakom Bird Sanctuary\nVisit Mattupetty Dam');
  await byId(page, 'import-paste-go').click();
  await byId(page, 'import-item-Kumarakom Bird Sanctuary').waitFor();
  await byId(page, 'import-match-Mattupetty Dam').waitFor();
  check(/Already in your plan/.test(await text(page, 'import-match-Mattupetty Dam')), 'existing place recognised (no duplicate)');
  await byId(page, 'import-confirm').click();
  await byId(page, 'import-done').waitFor();

  setStep('destination: automatic cover with credit, weather, planned day');
  await page.goto(`${trip}/plan`);
  await byId(page, 'plan-open-Munnar').click();
  await byId(page, 'detail-auto-cover-credit').waitFor();
  check(/Fixture Photographer · CC BY-SA 4\.0/.test(await text(page, 'detail-auto-cover-credit')), 'cover credits its author and licence');
  await byId(page, 'detail-location-edit').click();
  await byId(page, 'detail-location-input').fill('10.0889, 77.0595');
  await byId(page, 'detail-location-save').click();
  await expand(page, 'detail-section-weather');
  await byId(page, 'weather-card').waitFor();
  check(/18°C · Rain/.test(await text(page, 'weather-now')), 'current weather from the provider');
  check(/Updated/.test(await text(page, 'weather-card')) && /Open-Meteo/.test(await text(page, 'weather-card')), 'last update and source shown');
  await shot(page, 'travel-02-destination');

  setStep('explore: live places around the destination, add one without duplicates');
  await byId(page, 'detail-tab-explore').click();
  await byId(page, 'rec-cat-waterfalls').click();
  await byId(page, 'rec-Lakkam Waterfalls').waitFor();
  check((await byId(page, 'rec-Distant Falls').count()) === 0, '10 km filter leaves out a place 33 km away');
  await byId(page, 'rec-km-50').click();
  await byId(page, 'rec-Distant Falls').waitFor();
  await byId(page, 'rec-add-Lakkam Waterfalls').click();
  await page.getByText('Add under Munnar').click();
  await byId(page, 'rec-added-Lakkam Waterfalls').waitFor();
  check((await byId(page, 'rec-add-Lakkam Waterfalls').count()) === 0, 'an added place cannot be added again');

  setStep('trip: cover, weather along the trip, packing ideas need approval');
  await page.goto(trip);
  await byId(page, 'trip-cover-credit').waitFor();
  await expand(page, 'trip-weather-section');
  await byId(page, 'trip-weather').waitFor();
  await byId(page, 'weather-packing-hints').waitFor();
  await page.goto(`${trip}/packing`);
  await byId(page, 'packing-screen').waitFor();
  check((await byId(page, 'packing-category-none').count()) === 0, 'nothing added to packing by itself');
  await page.goto(trip);
  await expand(page, 'trip-weather-section');
  await byId(page, 'weather-hint-add-cold').click();
  await byId(page, 'weather-hint-added-cold').waitFor();
  await page.goto(`${trip}/packing/category/none`);
  await page.getByText('Warm jacket').first().waitFor();
  const packed = await page.locator('body').innerText();
  check(/Warm jacket/.test(packed), 'approved idea added to packing');
  check(!/Sunscreen/.test(packed), 'ideas not approved are not added');
  await shot(page, 'travel-03-trip');

  setStep('offline after a restart: saved weather, places and cover still show');
  await context.close();
  providers.offline = true;
  ({ context, page, errors } = await launch());
  await page.goto(`${trip}/plan`);
  await byId(page, 'plan-open-Munnar').click({ timeout: 60_000 });
  await expand(page, 'detail-section-weather');
  await byId(page, 'weather-card').waitFor();
  await byId(page, 'detail-auto-cover-credit').waitFor();
  await byId(page, 'detail-tab-explore').click();
  await byId(page, 'rec-cat-waterfalls').click();
  await byId(page, 'rec-Lakkam Waterfalls').waitFor();
  check((await page.locator('[data-testid="rec-source-cache"], [data-testid="rec-source-stale_cache"]').count()) === 1, 'recommendations say they are saved, not live');
  await page.goto(`${trip}/plan/import`);
  await byId(page, 'import-record-kerala-itinerary.pdf').waitFor();
  check(/Added/.test(await text(page, 'import-record-kerala-itinerary.pdf')), 'imported plans stay listed offline');
  providers.offline = false;
  check(errors.length === 0, `no uncaught page errors (${errors.join(' | ') || 'none'})`);
  await context.close();
});
