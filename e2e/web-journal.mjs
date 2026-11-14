// Journey Journal: dashboard entry point, new/edit/delete entries with mood,
// place and photos, day-by-day timeline with destination memories, honest
// "Drive not set up" state, offline use and restart persistence — at 360 px.
//
//   npx expo export --platform web --output-dir dist && npm run e2e:journal
//   SCREENSHOT_DIR=/tmp/shots npm run e2e:journal

import { BASE, byId, check, expand, iso, launch, run, setStep, shot, text, waitText } from './harness.mjs';

const now = new Date();
const day = (d) => new Date(now.getFullYear(), now.getMonth() + 1, d);
// 1×1 PNG.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

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

async function writeEntry(page, { date, title, body, mood, place, photo = false }) {
  await byId(page, 'journal-new').click();
  await byId(page, 'journal-editor').waitFor();
  if (date) await byId(page, 'journal-date').fill(date);
  if (title) await byId(page, 'journal-title').fill(title);
  if (body) await byId(page, 'journal-body').fill(body);
  if (mood) await byId(page, `journal-mood-${mood}`).click();
  if (place) await byId(page, `journal-place-${place}`).click();
  if (photo) {
    const chooser = page.waitForEvent('filechooser');
    await byId(page, 'journal-photo').click();
    await (await chooser).setFiles({ name: 'view.png', mimeType: 'image/png', buffer: PNG });
    await page.locator('[data-testid="journal-editor"] img').first().waitFor();
  }
  await byId(page, 'journal-save').click();
  await byId(page, 'journal-screen').waitFor();
}

await run('Journal test', async () => {
  let { context, page, errors, dialogs } = await launch();

  setStep('trip with a destination and a memory');
  const trip = await createTrip(page, 'Kerala Journal');
  await page.goto(`${trip}/plan`);
  await byId(page, 'planner-add').click();
  await byId(page, 'plan-add-name').fill('Munnar');
  await byId(page, 'plan-add-save').click();
  await byId(page, 'plan-row-Munnar').waitFor();
  await byId(page, 'plan-open-Munnar').click();
  await byId(page, 'detail-tab-memories').click();
  await expand(page, 'detail-memory-editor');
  await byId(page, 'detail-memory-date').fill(iso(day(11)));
  await byId(page, 'detail-memory-notes').fill('Clouds below us');
  await byId(page, 'detail-rate-5').click();
  await byId(page, 'detail-memory-save').click();
  await waitText(page, 'detail-memories', (v) => v.includes('Memory saved'));

  setStep('dashboard entry point, empty state, Drive not set up');
  await page.goto(trip);
  await byId(page, 'journal-summary').waitFor();
  await byId(page, 'journal-open').click();
  await byId(page, 'journal-screen').waitFor();
  await byId(page, 'journal-drive-off').waitFor();
  check((await byId(page, 'journal-drive-connect').count()) === 0, 'no Drive button when Drive is not set up');
  await byId(page, `journal-day-${iso(day(11))}`).waitFor();
  check((await text(page, `journal-day-${iso(day(11))}`)).includes('Day 2') && (await byId(page, 'journal-memory-Munnar').count()) === 1, 'destination memories appear on their trip day');

  setStep('validation');
  await byId(page, 'journal-new').click();
  await byId(page, 'journal-editor').waitFor();
  check((await byId(page, 'journal-date').inputValue()) === iso(day(10)), 'a new entry defaults to the first trip day before the trip');
  await byId(page, 'journal-save').click();
  await byId(page, 'journal-invalid').waitFor();
  check((await text(page, 'journal-invalid')).includes('title or a few words'), 'an empty entry is not saved');
  await byId(page, 'journal-date').fill('2026-02-30');
  await byId(page, 'journal-title').fill('Bad date');
  await waitText(page, 'journal-invalid', (v) => v.includes('valid date'));
  await page.goBack();
  await byId(page, 'journal-screen').waitFor();

  setStep('write entries with mood, place and a photo');
  await writeEntry(page, { date: iso(day(10)), title: 'Arrival', body: 'Drove up the ghats in the rain.', mood: 'tired' });
  await writeEntry(page, { date: iso(day(11)), title: 'Tea hills', body: 'Sunrise over the estates.', mood: 'great', place: 'Munnar', photo: true });
  const day2 = await text(page, `journal-day-${iso(day(11))}`);
  check(day2.includes('Tea hills') && day2.includes('Munnar') && day2.includes('Great'), 'entry shows with its place and mood');
  check((await page.locator(`[data-testid="journal-entry-Tea hills"] img`).count()) === 1, 'entry shows its photo');
  const order = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="journal-day-"]')].map((d) => d.getAttribute('data-testid')));
  check(JSON.stringify(order) === JSON.stringify([`journal-day-${iso(day(11))}`, `journal-day-${iso(day(10))}`]), 'newest day first');
  await shot(page, 'journal-01-timeline');

  setStep('edit an entry');
  await byId(page, 'journal-entry-Arrival').click();
  await byId(page, 'journal-editor').waitFor();
  check((await byId(page, 'journal-body').inputValue()) === 'Drove up the ghats in the rain.', 'editor loads the entry');
  await byId(page, 'journal-title').fill('Arrival day');
  await byId(page, 'journal-save').click();
  await byId(page, 'journal-entry-Arrival day').waitFor();

  setStep('offline: the journal keeps working');
  await context.setOffline(true);
  await writeEntry(page, { date: iso(day(12)), title: 'No signal', body: 'Written offline.' });
  await byId(page, 'journal-entry-No signal').waitFor();
  check(true, 'writes offline');
  await context.setOffline(false);

  setStep('delete asks first');
  await byId(page, 'journal-entry-No signal').click();
  await byId(page, 'journal-delete').click();
  await byId(page, 'journal-screen').waitFor();
  await page.waitForTimeout(300);
  check((await byId(page, 'journal-entry-No signal').count()) === 0, 'entry deleted');
  check(dialogs.some((d) => d.includes('Delete this entry?')), 'deletion was confirmed');
  check(errors.length === 0, `no uncaught page errors (${errors.join(' | ') || 'none'})`);
  await context.close();

  setStep('restart: everything persisted');
  ({ context, page, errors } = await launch());
  await page.goto(`${trip}/journal`);
  await byId(page, 'journal-screen').waitFor({ timeout: 60_000 });
  await byId(page, 'journal-entry-Arrival day').waitFor();
  check((await page.locator(`[data-testid="journal-entry-Tea hills"] img`).count()) === 1, 'photo persisted');
  check((await text(page, 'journal-screen')).includes('2 entries'), 'entry count persisted');
  await page.goto(trip);
  await waitText(page, 'journal-summary', (v) => v.includes('2 entries · 1 photo'));
  check(true, 'dashboard card summarises the journal');
  check(errors.length === 0, `no uncaught page errors after restart (${errors.join(' | ') || 'none'})`);
});
