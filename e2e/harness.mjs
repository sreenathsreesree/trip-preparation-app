// Shared helpers for the browser end-to-end tests.
//
// Serves dist/ (the static web export) with the cross-origin isolation headers
// web SQLite needs, launches Chromium with a persistent profile (so a test can
// "restart" the app and check persistence) in a small Android phone viewport,
// and provides small assertion and lookup helpers.
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
  console.error('Playwright is not installed. Install it (with Chromium) to run this test.');
  process.exit(2);
}

const DIST = resolve(process.cwd(), 'dist');
const SCREENSHOT_DIR = process.env.SCREENSHOT_DIR;
export const EXTERNAL_BASE = process.env.BASE_URL?.replace(/\/$/, '');
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

export let BASE = EXTERNAL_BASE;
if (!BASE) {
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  BASE = `http://127.0.0.1:${server.address().port}`;
}

const profile = mkdtempSync(join(tmpdir(), 'trip-prep-e2e-'));
/** Small Android phone. */
export const viewport = { width: 360, height: 780 };
const pad = (n) => String(n).padStart(2, '0');
export const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

let step = 'start';
/** Names the current step; assertion failures and timeouts report it. */
export function setStep(name) {
  step = name;
}

/** The open browser session, so failures can be captured and cleaned up. */
const session = { context: null, page: null };

export async function launch() {
  const context = await chromium.launchPersistentContext(profile, { viewport });
  session.context = context;
  context.setDefaultTimeout(15_000);
  const page = context.pages()[0] ?? (await context.newPage());
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  // Confirmation dialogs (delete, remove) are accepted; the message is recorded.
  const dialogs = [];
  page.on('dialog', (dialog) => {
    dialogs.push(dialog.message());
    void dialog.accept();
  });
  session.page = page;
  return { context, page, errors, dialogs };
}

export async function shot(page, name) {
  if (SCREENSHOT_DIR) await page.screenshot({ path: join(SCREENSHOT_DIR, `${name}.png`) });
}

export function check(condition, message) {
  if (!condition) throw new Error(`Assertion failed at "${step}": ${message}`);
  console.log(`  ✓ ${message}`);
}

export const byId = (page, id) => page.getByTestId(id);
/** Text inside a specific screen (other screens can stay mounted, hidden, in the DOM on web). */
export const within = (page, screenId, value, options) => byId(page, screenId).getByText(value, options).first();
export const text = async (page, id) => (await byId(page, id).first().innerText()).trim();

export async function waitText(page, id, predicate, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  let last = '';
  while (Date.now() < deadline) {
    last = await text(page, id).catch(() => '');
    if (predicate(last)) return last;
    await page.waitForTimeout(100);
  }
  throw new Error(`Timed out at "${step}" waiting on ${id} (last value: "${last}")`);
}

/** Runs a test body, reporting failure with a screenshot and always cleaning up. */
export async function run(name, body) {
  try {
    await body();
    console.log(`\n${name} passed.`);
  } catch (error) {
    console.error(`\n${name} FAILED: ${error.message}`);
    if (session.page) await shot(session.page, 'failure').catch(() => undefined);
    process.exitCode = 1;
  } finally {
    await session.context?.close().catch(() => undefined);
    if (server.listening) server.close();
    rmSync(profile, { recursive: true, force: true });
  }
}

/**
 * From the planner screen: adds a place by name (as a main destination, or
 * inside `parent`), optionally flipping the "Add to route" toggle away from
 * its default (on for main destinations, off inside a place).
 */
export async function plannerAdd(page, name, { parent, toggleRoute = false } = {}) {
  if (parent) {
    await byId(page, `plan-more-${parent}`).click();
    await byId(page, 'sheet-action-add-inside').click();
  } else {
    await byId(page, 'planner-add').click();
  }
  await byId(page, 'plan-add').waitFor();
  await byId(page, 'plan-add-name').fill(name);
  if (toggleRoute) await byId(page, 'plan-add-route').click();
  await byId(page, 'plan-add-save').click();
  await byId(page, 'planner-screen').waitFor();
  await byId(page, `plan-row-${name}`).waitFor();
}

/** Moves a planner place up or down among its siblings through its action menu (accessible path). */
export async function plannerMove(page, name, direction) {
  await byId(page, `plan-more-${name}`).click();
  await byId(page, `sheet-action-${direction}`).click();
  await byId(page, 'plan-node-actions').waitFor({ state: 'hidden' });
}
