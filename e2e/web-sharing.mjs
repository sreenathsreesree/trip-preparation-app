// Shared trips in a build without the Trip Prep cloud (the state until the
// shared-trip migration is approved): menu entry, what-is-shared explainer,
// honest "not available" states, no share switch on journal entries, and join
// links that explain themselves. Live sharing is covered by the Postgres tests
// (supabase/tests/sharing.test.mjs) and the Jest sync tests.
//
//   npx expo export --platform web --output-dir dist && npm run e2e:sharing

import { BASE, byId, check, iso, launch, run, setStep, shot, text } from './harness.mjs';

const now = new Date();
const day = (d) => new Date(now.getFullYear(), now.getMonth() + 1, d);

await run('Sharing test', async () => {
  const { page, errors } = await launch();

  setStep('create a trip');
  await page.goto(`${BASE}/trips/new`);
  await byId(page, 'trip-name-input').waitFor({ timeout: 60_000 });
  await byId(page, 'trip-name-input').fill('Shared Kerala');
  await byId(page, 'category-mountains').click();
  await byId(page, 'wizard-next').click();
  await byId(page, 'trip-calendar-next-month').click();
  await byId(page, `calendar-day-${iso(day(10))}`).click();
  await byId(page, `calendar-day-${iso(day(14))}`).click();
  await byId(page, 'wizard-next').click();
  await byId(page, 'transport-car').click();
  await byId(page, 'wizard-create').click();
  await byId(page, 'trip-dashboard').waitFor();
  const trip = page.url().split('?')[0];

  setStep('share screen from the trip menu');
  await byId(page, 'trip-actions').click();
  await byId(page, 'sheet-action-share').click();
  await byId(page, 'share-screen').waitFor();
  const explainer = await text(page, 'share-explainer');
  check(explainer.includes('Everything else stays private') && explainer.includes('never uploaded to Trip Prep'), 'explains exactly what is shared and what stays private');
  await byId(page, 'share-unavailable').waitFor();
  check((await byId(page, 'share-start').count()) === 0, 'no share button when sharing is unavailable');
  await shot(page, 'share-01-unavailable');

  setStep('journal entries stay private, with no share switch');
  await page.goto(`${trip}/journal/entry`);
  await byId(page, 'journal-editor').waitFor();
  check((await byId(page, 'journal-share-toggle').count()) === 0, 'no share switch outside a shared trip');
  check((await text(page, 'journal-privacy')).startsWith('Private'), 'entries say they are private');

  setStep('join links');
  await page.goto(`${BASE}/join/not-a-token`);
  await byId(page, 'join-invalid').waitFor();
  await page.goto(`${BASE}/join/abcdefghijklmnopqrstuvwxyz012345`);
  await byId(page, 'join-unavailable').waitFor();
  check((await byId(page, 'join-accept').count()) === 0, 'cannot join without the cloud');
  check(errors.length === 0, `no uncaught page errors (${errors.join(' | ') || 'none'})`);
});
