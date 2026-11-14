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

/**
 * Free public providers the app calls directly (OpenStreetMap Photon/Overpass,
 * Open-Meteo, Wikipedia/Wikimedia Commons) are answered with fixtures in their
 * documented response formats, so tests are deterministic and never hit the
 * real services. `providers.offline = true` makes every call fail like a lost
 * connection; `providers.calls` records what the app asked for.
 */
export const providers = { offline: false, calls: [] };
const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

function providerFixture(url, body) {
  const u = new URL(url);
  if (u.host === 'photon.komoot.io') {
    const q = u.searchParams.get('q') ?? 'Place';
    return { json: { features: [{ geometry: { coordinates: [77.0595, 10.0889] }, properties: { name: q, osm_id: 4242, osm_type: 'N', osm_key: 'place', osm_value: 'town', state: 'Kerala', country: 'India' } }] } };
  }
  if (u.host === 'overpass-api.de') {
    const data = decodeURIComponent(String(body ?? '').replace(/^data=/, '').replace(/\+/g, ' '));
    const m = /around:(\d+),([-\d.]+),([-\d.]+)/.exec(data);
    const lat = m ? Number(m[2]) : 10.0889;
    const lon = m ? Number(m[3]) : 77.0595;
    return {
      json: {
        elements: [
          { type: 'way', id: 101, center: { lat: lat + 0.02, lon: lon + 0.01 }, tags: { name: 'Lakkam Waterfalls', waterway: 'waterfall', wikipedia: 'en:Lakkam Waterfalls' } },
          { type: 'node', id: 102, lat: lat + 0.01, lon, tags: { name: 'Attukad Waterfalls', natural: 'waterfall' } },
          { type: 'node', id: 103, lat: lat + 0.3, lon, tags: { name: 'Distant Falls', natural: 'waterfall' } },
        ],
      },
    };
  }
  if (u.host === 'api.open-meteo.com') {
    const days = Array.from({ length: 16 }, (_, i) => new Date(Date.now() + i * 86_400_000).toISOString().slice(0, 10));
    return {
      json: {
        latitude: Number(u.searchParams.get('latitude')),
        longitude: Number(u.searchParams.get('longitude')),
        timezone: 'Asia/Kolkata',
        current: { time: `${days[0]}T09:00`, temperature_2m: 18.4, relative_humidity_2m: 82, weather_code: 61, wind_speed_10m: 9.5 },
        daily: {
          time: days,
          weather_code: days.map((_, i) => (i === 0 ? 61 : 2)),
          temperature_2m_max: days.map(() => 23),
          temperature_2m_min: days.map(() => 11),
          precipitation_probability_max: days.map((_, i) => (i === 0 ? 80 : 20)),
          wind_speed_10m_max: days.map(() => 12),
          uv_index_max: days.map(() => 7),
        },
      },
    };
  }
  if (u.host === 'en.wikipedia.org') {
    const title = u.searchParams.get('titles') ?? u.searchParams.get('gsrsearch') ?? 'Place';
    return { json: { query: { pages: [{ title, pageimage: 'Fixture_photo.png', index: 1 }] } } };
  }
  if (u.host === 'commons.wikimedia.org') {
    return {
      json: {
        query: {
          pages: [
            {
              title: 'File:Fixture_photo.png',
              imageinfo: [{ thumburl: 'https://upload.wikimedia.org/fixture.png', descriptionurl: 'https://commons.wikimedia.org/wiki/File:Fixture_photo.png', extmetadata: { LicenseShortName: { value: 'CC BY-SA 4.0' }, Artist: { value: 'Fixture Photographer' } } }],
            },
          ],
        },
      },
    };
  }
  if (u.host === 'upload.wikimedia.org') return { png: true };
  if (u.host === 'router.project-osrm.org') {
    const n = u.pathname.split('/driving/')[1].split(';').length;
    if (u.pathname.startsWith('/trip/')) {
      // Keeps first and last, reverses the middle (a different, "shorter" order).
      const idx = Array.from({ length: n }, (_, i) => (i === 0 || i === n - 1 ? i : n - 1 - i));
      return { json: { code: 'Ok', waypoints: idx.map((w) => ({ waypoint_index: w })) } };
    }
    return { json: { code: 'Ok', routes: [{ legs: Array.from({ length: n - 1 }, (_, i) => ({ distance: 12000 + i * 1000, duration: 1500 + i * 60 })) }] } };
  }
  return null;
}

export async function launch() {
  const context = await chromium.launchPersistentContext(profile, { viewport });
  session.context = context;
  await context.route(/^https:\/\/(photon\.komoot\.io|overpass-api\.de|api\.open-meteo\.com|en\.wikipedia\.org|commons\.wikimedia\.org|upload\.wikimedia\.org|router\.project-osrm\.org)\//, async (route) => {
    const request = route.request();
    providers.calls.push(new URL(request.url()).host);
    if (providers.offline) return route.abort('internetdisconnected');
    const fixture = providerFixture(request.url(), request.postData());
    if (!fixture) return route.abort();
    if (fixture.png) return route.fulfill({ status: 200, contentType: 'image/png', body: PNG_1PX, headers: { 'Access-Control-Allow-Origin': '*' } });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fixture.json), headers: { 'Access-Control-Allow-Origin': '*' } });
  });
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

/** Switches the destination planner to a tab ('destinations', 'route' or 'navigation'). */
export async function plannerTab(page, tab) {
  await byId(page, 'planner-screen').getByTestId(`segment-${tab}`).click();
  await byId(page, tab === 'route' ? 'plan-route' : tab === 'navigation' ? 'plan-navigation' : 'planner-add').waitFor();
}

/**
 * Drags `handle` onto `target`: 'before' (top of the row), 'inside' (middle) or 'after' (bottom).
 * The handle is first brought to the middle of the screen, away from the auto-scroll edges.
 */
export async function dragElement(page, handle, target, position) {
  await handle.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(200);
  const hb = await handle.boundingBox();
  const tb = await target.boundingBox();
  if (!hb || !tb) throw new Error('drag: element not visible');
  const fraction = position === 'before' ? 0.1 : position === 'inside' ? 0.5 : 0.92;
  const x = hb.x + hb.width / 2;
  await page.mouse.move(x, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(x, hb.y + hb.height / 2 + 6, { steps: 3 });
  await page.mouse.move(x, tb.y + tb.height * fraction, { steps: 14 });
  await page.waitForTimeout(150);
  if (process.env.DEBUG_DRAG) await page.screenshot({ path: `${process.env.DEBUG_DRAG}/drag-${Date.now()}.png` });
  await page.mouse.up();
  await page.waitForTimeout(500);
}

/** Drags a route stop onto another stop ('before' or 'after'). */
export async function dragRouteStop(page, from, to, position) {
  const handle = byId(page, `route-stop-${from}`).locator('[data-testid^="drag-"]');
  await dragElement(page, handle, byId(page, `route-stop-${to}`), position);
}

/** Opens a collapsible section (testID of the section) if it is closed. */
export async function expand(page, section) {
  const toggle = page.getByTestId(`${section}-toggle`);
  await toggle.waitFor();
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
}
