// End-to-end smoke test against the static web export.
//
//   npx expo export --platform web --output-dir dist
//   npm run e2e:web
//
// Serves dist/ with the cross-origin isolation headers web SQLite needs and
// drives the app in a small-phone viewport: create a multi-stop trip, edit it,
// work the checklist (priorities, details, reorder), build a template, apply
// and re-apply it, duplicate/complete/archive/restore trips, then fully restart
// the browser (same profile) to check persistence, and finally delete a trip.
//
// Requires Playwright with Chromium to be resolvable (`require('playwright')`);
// it is intentionally not a project dependency. Set SCREENSHOT_DIR to save
// screenshots, or BASE_URL to test an already-running server (e.g. `npm run web`).

import { createReadStream, existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { extname, join, normalize, resolve } from 'node:path';

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  console.error('Playwright is not installed. Install it (with Chromium) to run this smoke test.');
  process.exit(2);
}

const DIST = resolve(process.cwd(), 'dist');
const SCREENSHOT_DIR = process.env.SCREENSHOT_DIR;
const EXTERNAL_BASE = process.env.BASE_URL?.replace(/\/$/, '');
if (!EXTERNAL_BASE && !existsSync(join(DIST, 'index.html'))) {
  console.error('dist/ not found. Run: npx expo export --platform web --output-dir dist');
  process.exit(2);
}

const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.wasm': 'application/wasm',
  '.json': 'application/json',
  '.ttf': 'font/ttf',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  let file = normalize(join(DIST, decodeURIComponent(url.pathname)));
  if (!file.startsWith(DIST) || !existsSync(file) || statSync(file).isDirectory()) {
    file = join(DIST, 'index.html'); // single-page app fallback
  }
  res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream');
  createReadStream(file).pipe(res);
});
let BASE = EXTERNAL_BASE;
if (!BASE) {
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  BASE = `http://127.0.0.1:${server.address().port}`;
}

const profile = mkdtempSync(join(tmpdir(), 'trip-prep-e2e-'));
// Small Android phone.
const viewport = { width: 360, height: 780 };
const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const now = new Date();
const start = new Date(now.getFullYear(), now.getMonth() + 1, 5);
const end = new Date(now.getFullYear(), now.getMonth() + 1, 9);

let step = 'start';
/** The open browser session, so failures can be captured and cleaned up. */
const session = { context: null, page: null };
async function launch() {
  const context = await chromium.launchPersistentContext(profile, { viewport });
  session.context = context;
  context.setDefaultTimeout(15_000);
  const page = context.pages()[0] ?? (await context.newPage());
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  // Confirmation dialogs (delete) are accepted; the message is recorded.
  const dialogs = [];
  page.on('dialog', (dialog) => {
    dialogs.push(dialog.message());
    void dialog.accept();
  });
  session.page = page;
  return { context, page, errors, dialogs };
}
async function shot(page, name) {
  if (SCREENSHOT_DIR) await page.screenshot({ path: join(SCREENSHOT_DIR, `${name}.png`) });
}
function check(condition, message) {
  if (!condition) throw new Error(`Assertion failed at "${step}": ${message}`);
  console.log(`  ✓ ${message}`);
}
const byId = (page, id) => page.getByTestId(id);
/** Text inside a specific screen (other screens can stay mounted, hidden, in the DOM on web). */
const within = (page, screenId, value, options) => byId(page, screenId).getByText(value, options).first();
const text = async (page, id) => (await byId(page, id).first().innerText()).trim();
async function waitText(page, id, predicate, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  let last = '';
  while (Date.now() < deadline) {
    last = await text(page, id).catch(() => '');
    if (predicate(last)) return last;
    await page.waitForTimeout(100);
  }
  throw new Error(`Timed out at "${step}" waiting on ${id} (last value: "${last}")`);
}
async function openTripActions(page, action) {
  await byId(page, 'trip-actions').click();
  await byId(page, `sheet-action-${action}`).click();
}

try {
  // ---------------------------------------------------------------- Session 1
  let { context, page, errors, dialogs } = await launch();
  step = 'home (empty)';
  await page.goto(BASE);
  await byId(page, 'home-empty').waitFor({ timeout: 60_000 });
  const isolated = await page.evaluate(() => globalThis.crossOriginIsolated);
  if (EXTERNAL_BASE) console.log(`  · cross-origin isolated: ${isolated}`);
  else check(isolated, 'page is cross-origin isolated');

  step = 'create: basics with three stops';
  await byId(page, 'home-plan-trip').click();
  await byId(page, 'trip-name-input').waitFor();
  await byId(page, 'wizard-next').click();
  check(await page.getByText('Give your trip a name.').isVisible(), 'validation blocks an empty step');
  await byId(page, 'trip-name-input').fill('Spiti Valley Ride');
  await byId(page, 'destination-input-0').fill('Manali');
  await byId(page, 'destination-add').click();
  await byId(page, 'destination-input-1').fill('Kaza');
  await byId(page, 'destination-add').click();
  await byId(page, 'wizard-next').click();
  check(await page.getByText('Enter a place or remove this stop.').first().isVisible(), 'empty stop is flagged');
  await byId(page, 'destination-input-2').fill('Chandratal');
  await byId(page, 'destination-move-2-up').click(); // Manali, Chandratal, Kaza
  await byId(page, 'category-mountains').click();
  await shot(page, '01-create-basics');
  await byId(page, 'wizard-next').click();

  step = 'create: dates and travellers';
  await byId(page, 'trip-calendar-next-month').click();
  await byId(page, `calendar-day-${iso(start)}`).click();
  await byId(page, `calendar-day-${iso(end)}`).click();
  await byId(page, 'traveller-name-0').fill('Asha');
  await byId(page, 'traveller-add').click();
  await byId(page, 'traveller-name-1').fill('Kabir');
  await byId(page, 'traveller-kind-1').click(); // adult -> child
  await byId(page, 'traveller-add').click();
  await byId(page, 'traveller-name-2').fill('Ravi');
  await shot(page, '02-create-when');
  await byId(page, 'wizard-next').click();

  step = 'create: transport';
  await byId(page, 'transport-car').click();
  await shot(page, '03-create-how');
  await byId(page, 'wizard-create').click();

  step = 'dashboard';
  await byId(page, 'trip-dashboard').waitFor();
  const tripUrl = page.url();
  const tripPath = new URL(tripUrl).pathname;
  check(
    await within(page, 'trip-dashboard', 'Manali → Chandratal → Kaza', { exact: false }).isVisible(),
    'route keeps stop order',
  );
  check((await text(page, 'departure-status')) === 'Not ready to depart', 'open essentials block departure');
  const readiness0 = await text(page, 'readiness-percent');
  for (const kind of ['packing', 'documents', 'vehicle', 'tasks', 'shopping', 'home']) {
    await byId(page, `section-card-${kind}`).waitFor();
  }
  check(true, 'six standard sections for a car trip');
  await shot(page, '04-dashboard');

  step = 'tick an essential from the readiness panel';
  await page.locator('[data-testid="readiness-panel"] [data-testid^="task-check-"]').first().click();
  const readiness1 = await waitText(page, 'readiness-percent', (v) => v !== readiness0);
  check(true, `readiness updates immediately (${readiness0} → ${readiness1})`);

  step = 'section: add, edit details, reorder';
  await byId(page, 'section-card-packing').click();
  await byId(page, 'section-screen-packing').waitFor();
  const packing0 = await text(page, 'section-progress-text');
  await byId(page, 'add-item-priority-essential').click();
  await byId(page, 'add-item-input').fill('Spare bike chain');
  await byId(page, 'add-item-button').click();
  await within(page, 'section-screen-packing', 'Spare bike chain').waitFor();
  const packing1 = await waitText(page, 'section-progress-text', (v) => v !== packing0);
  check(true, `essential task added (${packing0} → ${packing1})`);
  const sectionScreen = byId(page, 'section-screen-packing');
  await sectionScreen.locator('[data-testid^="task-open-"]', { hasText: 'Spare bike chain' }).click();
  await byId(page, 'task-editor').waitFor();
  await byId(page, 'task-description-input').fill('Pre-stretched, 520 pitch');
  await byId(page, 'task-notes-input').fill('Buy in Manali');
  await byId(page, 'priority-optional').click();
  await shot(page, '05-task-editor');
  await byId(page, 'task-save').click();
  await byId(page, 'section-screen-packing').waitFor();
  await within(page, 'section-screen-packing', 'Pre-stretched, 520 pitch').waitFor();
  check(true, 'description shown on the row');
  const firstBefore = await sectionScreen.locator('[data-testid^="task-open-"]').first().innerText();
  await byId(page, 'toggle-reorder').click();
  await sectionScreen.locator('[data-testid^="task-move-"][data-testid$="-down"]').first().click();
  await page.waitForTimeout(500);
  const firstAfter = await sectionScreen.locator('[data-testid^="task-open-"]').first().innerText();
  check(firstAfter !== firstBefore, 'reordering moves a task');
  await byId(page, 'toggle-reorder').click();
  await page.waitForTimeout(600); // let layout animations settle
  await shot(page, '06-section');

  step = 'edit trip details';
  await page.goto(tripUrl);
  await byId(page, 'trip-dashboard').waitFor();
  const completionBeforeEdit = await waitText(page, 'completion-percent', (v) => v.length > 0);
  await openTripActions(page, 'edit');
  await byId(page, 'edit-trip-screen').waitFor();
  check((await byId(page, 'trip-name-input').inputValue()) === 'Spiti Valley Ride', 'edit form is prefilled');
  check((await byId(page, 'destination-input-1').inputValue()) === 'Chandratal', 'stops are prefilled in order');
  await byId(page, 'trip-name-input').fill('Spiti & Chandratal');
  await byId(page, 'traveller-remove-2').click(); // remove Ravi
  await shot(page, '07-edit-trip');
  await byId(page, 'edit-trip-save').click();
  await byId(page, 'trip-dashboard').waitFor();
  await within(page, 'trip-dashboard', 'Spiti & Chandratal').waitFor();
  check(await within(page, 'trip-dashboard', '1 adult, 1 child').isVisible(), 'traveller removal saved');
  check(
    (await text(page, 'completion-percent')) === completionBeforeEdit,
    'editing details leaves the checklist untouched',
  );

  step = 'create a template';
  await page.goto(`${BASE}/checklists`);
  await byId(page, 'checklists-screen').waitFor();
  await byId(page, 'segment-templates').click();
  await byId(page, 'templates-empty').waitFor();
  await byId(page, 'templates-new').click();
  await byId(page, 'template-name-input').fill('Trek kit');
  await byId(page, 'template-description-input').fill('High-altitude essentials');
  await byId(page, 'template-save').click();
  await byId(page, 'template-editor').waitFor();
  await byId(page, 'add-section-input').fill('Gear');
  await byId(page, 'add-section-button').click();
  await byId(page, 'add-task-Gear-input').waitFor();
  await byId(page, 'add-task-Gear-priority-essential').click();
  await byId(page, 'add-task-Gear-input').fill('Trekking poles');
  await byId(page, 'add-task-Gear-button').click();
  await within(page, 'template-editor', 'Trekking poles').waitFor();
  await shot(page, '08-template-editor');
  const templateUrl = page.url();
  check(true, 'template with a section and an essential task');

  step = 'apply template to the trip';
  await page.goto(tripUrl);
  await byId(page, 'trip-dashboard').waitFor();
  await byId(page, 'apply-templates').click();
  await byId(page, 'apply-templates-screen').waitFor();
  await page.locator('[data-testid^="template-option-"]').first().click();
  await byId(page, 'apply-templates-confirm').click();
  await byId(page, 'apply-result').waitFor();
  check((await text(page, 'apply-result')).includes('Added 1 task'), 'template tasks copied into the trip');
  await shot(page, '09-apply-result');

  step = 'edit template; trip is unaffected until re-applied';
  await page.goto(templateUrl);
  await byId(page, 'template-editor').waitFor();
  await byId(page, 'add-task-Gear-input').fill('Microspikes');
  await byId(page, 'add-task-Gear-button').click();
  await within(page, 'template-editor', 'Microspikes').waitFor();
  await page.goto(tripUrl);
  await byId(page, 'trip-dashboard').waitFor();
  await byId(page, 'section-card-gear').click();
  await within(page, 'section-screen-custom', 'Trekking poles').waitFor();
  check(
    !(await within(page, 'section-screen-custom', 'Microspikes').isVisible()),
    'template edit did not change the trip',
  );
  await page.goto(tripUrl);
  await byId(page, 'apply-templates').click();
  await page.locator('[data-testid^="template-option-"]').first().click();
  await byId(page, 'apply-templates-confirm').click();
  await byId(page, 'apply-result').waitFor();
  const reapply = await text(page, 'apply-result');
  check(
    reapply.includes('Added 1 task') && reapply.includes('already on this trip'),
    `re-applying adds only the missing task ("${reapply.replace(/\s+/g, ' ')}")`,
  );

  step = 'duplicate, complete, archive, restore';
  await page.goto(tripUrl);
  await byId(page, 'trip-dashboard').waitFor();
  const originalCompletion = await waitText(page, 'completion-percent', (v) => v.length > 0);
  await openTripActions(page, 'duplicate');
  await page.waitForURL((url) => url.pathname !== tripPath && url.pathname.startsWith('/trips/'));
  await within(page, 'trip-dashboard', 'Spiti & Chandratal (copy)').waitFor();
  const copyUrl = page.url();
  // Reload so only the copy's dashboard is mounted.
  await page.goto(copyUrl);
  await byId(page, 'trip-dashboard').waitFor();
  check(
    (await waitText(page, 'completion-percent', (v) => v.length > 0)) === '0%',
    'duplicate starts with nothing ticked',
  );
  await openTripActions(page, 'archive');
  await byId(page, 'archived-notice').waitFor();
  check(true, 'copy archived');
  await page.goto(tripUrl);
  await byId(page, 'trip-dashboard').waitFor();
  check(
    (await waitText(page, 'completion-percent', (v) => v.length > 0)) === originalCompletion,
    'original checklist unchanged by duplicate',
  );
  await openTripActions(page, 'complete');
  await byId(page, 'completed-notice').waitFor();
  check(true, 'original marked completed');

  await page.goto(`${BASE}/trips`);
  await byId(page, 'trips-screen').waitFor();
  await byId(page, 'trips-empty-active').waitFor();
  await byId(page, 'segment-completed').click();
  await within(page, 'trips-screen', 'Spiti & Chandratal', { exact: true }).waitFor();
  await byId(page, 'segment-archived').click();
  await within(page, 'trips-screen', 'Spiti & Chandratal (copy)').waitFor();
  await page.waitForTimeout(600); // let layout animations settle
  await shot(page, '10-trips-archived');
  check(true, 'trips grouped as completed and archived');
  await byId(page, 'trips-screen').locator('[data-testid^="trip-more-"]').first().click();
  await byId(page, 'sheet-action-restore').click();
  await byId(page, 'trips-empty-archived').waitFor();
  await byId(page, 'segment-active').click();
  await within(page, 'trips-screen', 'Spiti & Chandratal (copy)').waitFor();
  check(true, 'archived trip restored to active');
  check(errors.length === 0, `no uncaught page errors (${errors.join(' | ') || 'none'})`);
  await context.close();

  // ---------------------------------------------- Session 2: full restart
  step = 'after restart';
  ({ context, page, errors, dialogs } = await launch());
  await page.goto(`${BASE}/trips`);
  await byId(page, 'trips-screen').waitFor({ timeout: 60_000 });
  await within(page, 'trips-screen', 'Spiti & Chandratal (copy)').waitFor();
  await byId(page, 'segment-completed').click();
  await within(page, 'trips-screen', 'Spiti & Chandratal', { exact: true }).waitFor();
  check(true, 'trips and lifecycle states persisted');

  await page.goto(tripUrl);
  await byId(page, 'trip-dashboard').waitFor();
  check(
    await within(page, 'trip-dashboard', 'Manali → Chandratal → Kaza', { exact: false }).isVisible(),
    'route persisted',
  );
  check(
    (await waitText(page, 'completion-percent', (v) => v.length > 0)) === originalCompletion,
    'ticks persisted',
  );
  await byId(page, 'section-card-packing').click();
  await within(page, 'section-screen-packing', 'Pre-stretched, 520 pitch').waitFor();
  check(true, 'task details persisted');
  await page.goto(templateUrl);
  await byId(page, 'template-editor').waitFor();
  await within(page, 'template-editor', 'Microspikes').waitFor();
  check(true, 'template persisted');
  await shot(page, '11-template-after-restart');

  step = 'delete with confirmation';
  await page.goto(copyUrl);
  await byId(page, 'trip-dashboard').waitFor();
  await openTripActions(page, 'delete');
  await byId(page, 'trips-screen').waitFor();
  check(
    dialogs.some((d) => d.includes('permanently removes') && d.includes('checklist task')),
    'delete asked for explicit confirmation',
  );
  check(
    (await byId(page, 'trips-screen').getByText('Spiti & Chandratal (copy)').count()) === 0,
    'deleted trip is gone',
  );

  await page.goto(`${BASE}/profile`);
  await byId(page, 'profile-trip-count').filter({ hasText: '1' }).waitFor();
  await shot(page, '12-profile');
  check(true, 'profile reports 1 stored trip');
  check(errors.length === 0, `no uncaught page errors after restart (${errors.join(' | ') || 'none'})`);
  await context.close();

  console.log('\nWeb smoke test passed.');
} catch (error) {
  console.error(`\nWeb smoke test FAILED: ${error.message}`);
  if (session.page) await shot(session.page, 'failure').catch(() => undefined);
  process.exitCode = 1;
} finally {
  await session.context?.close().catch(() => undefined);
  if (server.listening) server.close();
  rmSync(profile, { recursive: true, force: true });
}
