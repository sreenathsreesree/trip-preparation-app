// End-to-end smoke test against the static web export.
//
//   npx expo export --platform web --output-dir dist
//   npm run e2e:web
//
// Serves dist/ with the cross-origin isolation headers web SQLite needs,
// creates a trip through the UI, ticks a checklist item, fully restarts the
// browser (same profile) and verifies the data is still there.
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
const viewport = { width: 390, height: 844 };
const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const now = new Date();
const start = new Date(now.getFullYear(), now.getMonth() + 1, 5);
const end = new Date(now.getFullYear(), now.getMonth() + 1, 9);

let step = 'start';
async function launch() {
  const context = await chromium.launchPersistentContext(profile, { viewport });
  const page = context.pages()[0] ?? (await context.newPage());
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  return { context, page, errors };
}
async function shot(page, name) {
  if (SCREENSHOT_DIR) await page.screenshot({ path: join(SCREENSHOT_DIR, `${name}.png`) });
}
function check(condition, message) {
  if (!condition) throw new Error(`Assertion failed at "${step}": ${message}`);
  console.log(`  ✓ ${message}`);
}

try {
  // ---- Session 1: create a trip ----
  let { context, page, errors } = await launch();
  step = 'home (empty)';
  await page.goto(BASE);
  await page.getByTestId('home-empty').waitFor({ timeout: 120_000 });
  const isolated = await page.evaluate(() => globalThis.crossOriginIsolated);
  if (EXTERNAL_BASE) console.log(`  · cross-origin isolated: ${isolated}`);
  else check(isolated, 'page is cross-origin isolated');
  await shot(page, '01-home-empty');

  step = 'create trip';
  await page.getByTestId('home-plan-trip').click();
  await page.getByTestId('trip-name-input').waitFor();
  await page.getByTestId('wizard-next').click();
  check(await page.getByText('Give your trip a name.').isVisible(), 'validation blocks an empty step');
  await page.getByTestId('trip-name-input').fill('Spiti Valley Ride');
  await page.getByTestId('trip-destination-input').fill('Kaza, Himachal Pradesh');
  await page.getByTestId('category-mountains').click();
  await shot(page, '02-create-basics');
  await page.getByTestId('wizard-next').click();

  await page.getByTestId('trip-calendar-next-month').click();
  await page.getByTestId(`calendar-day-${iso(start)}`).click();
  await page.getByTestId(`calendar-day-${iso(end)}`).click();
  await page.getByTestId('adults-stepper-increment').click();
  await shot(page, '03-create-dates');
  await page.getByTestId('wizard-next').click();

  await page.getByTestId('transport-car').click();
  await shot(page, '04-create-transport');
  await page.getByTestId('wizard-create').click();

  step = 'dashboard';
  await page.getByTestId('trip-dashboard').waitFor({ timeout: 15_000 });
  const tripUrl = page.url();
  check(/\/trips\/[0-9a-f-]{36}$/.test(new URL(tripUrl).pathname), `navigated to dashboard (${new URL(tripUrl).pathname})`);
  for (const section of ['packing', 'documents', 'vehicle', 'tasks', 'shopping', 'home']) {
    await page.getByTestId(`section-card-${section}`).waitFor();
  }
  check(true, 'all six preparation sections shown for a car trip');
  await shot(page, '05-dashboard');

  step = 'checklist';
  await page.getByTestId('section-card-packing').click();
  await page.getByTestId('section-screen-packing').waitFor();
  const before = await page.getByTestId('section-progress-text').innerText();
  const firstItem = page.locator('[data-testid^="prep-item-"]').first();
  await firstItem.click();
  await page.waitForFunction(
    (prev) => document.querySelector('[data-testid="section-progress-text"]')?.textContent !== prev,
    before,
  );
  const after = await page.getByTestId('section-progress-text').innerText();
  check(after.startsWith('1/'), `ticking an item updates progress (${before} → ${after})`);
  await page.getByTestId('add-item-input').fill('Spare bike chain');
  await page.getByTestId('add-item-button').click();
  await page.getByText('Spare bike chain').waitFor();
  check(true, 'custom item added');
  await shot(page, '06-checklist');
  check(errors.length === 0, `no uncaught page errors (${errors.join(' | ') || 'none'})`);
  await context.close();

  // ---- Session 2: full browser restart with the same profile ----
  step = 'after restart';
  ({ context, page, errors } = await launch());
  await page.goto(BASE);
  await page.getByTestId('next-trip-hero').waitFor({ timeout: 30_000 });
  check(await page.getByText('Spiti Valley Ride').first().isVisible(), 'trip is still on Home after restart');
  await shot(page, '07-home-after-restart');

  await page.goto(tripUrl.replace(/\/[^/]+$/, (id) => `${id}/packing`));
  await page.getByTestId('section-screen-packing').waitFor({ timeout: 15_000 });
  const persisted = await page.getByTestId('section-progress-text').innerText();
  check(persisted === after.replace(/^(\d+)\/(\d+)/, (_, d, t) => `${d}/${Number(t) + 1}`), `ticked + added items persisted (${persisted})`);
  check(await page.getByText('Spare bike chain').isVisible(), 'custom item persisted');

  await page.goto(`${BASE}/profile`);
  await page.getByTestId('profile-trip-count').filter({ hasText: '1' }).waitFor();
  check(true, 'profile reports 1 stored trip');
  await shot(page, '08-profile');

  for (const tab of ['trips', 'checklists', 'inventory']) {
    await page.getByTestId(`tab-${tab}`).click();
    await page.getByTestId(`${tab}-screen`).waitFor();
    await page.waitForTimeout(400); // let the tab indicator settle for the screenshot
    await shot(page, `09-${tab}`);
  }
  check(true, 'tab bar navigates between all tabs');

  step = 'delete trip';
  page.once('dialog', (dialog) => dialog.accept());
  await page.goto(tripUrl);
  await page.getByTestId('delete-trip').click();
  await page.getByTestId('trips-empty').waitFor({ timeout: 15_000 });
  check(true, 'deleting the trip returns to an empty Trips list');
  check(errors.length === 0, `no uncaught page errors after restart (${errors.join(' | ') || 'none'})`);
  await context.close();

  console.log('\nWeb smoke test passed.');
} catch (error) {
  console.error(`\nWeb smoke test FAILED: ${error.message}`);
  process.exitCode = 1;
} finally {
  if (server.listening) server.close();
  rmSync(profile, { recursive: true, force: true });
}
