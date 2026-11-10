// Generates the provisional Trip Prep app icon, Android adaptive icon layers,
// splash image and favicon from code (no design files needed).
//
//   node scripts/generate-app-icons.mjs
//
// Rasterises SVG with Playwright's Chromium, so Playwright must be resolvable
// (`require('playwright')`); it is intentionally not a project dependency.
// Output goes to assets/ and replaces the files referenced by app.json.
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require('playwright'));
} catch {
  console.error('Playwright is not installed. Install it (with Chromium) to regenerate icons.');
  process.exit(2);
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = join(ROOT, 'assets');

const C = {
  charcoal: '#202832',
  deep: '#1A2129',
  slate: '#34424E',
  lime: '#B8F36B',
  limeShade: '#86B84A',
  glacier: '#9DCBE5',
  glacierShade: '#6A98B2',
};

/**
 * Eight-point compass rose centred at (cx, cy). Cardinal points are long and
 * lime, ordinal points short and glacier blue; each point is split into a
 * light and a shaded facet for depth. `mono` renders a flat silhouette.
 */
function compassRose(cx, cy, radius, { mono = null, waistRatio = 0.22 } = {}) {
  const point = (angleDeg, r) => {
    const a = ((angleDeg - 90) * Math.PI) / 180;
    return `${(cx + Math.cos(a) * r).toFixed(2)},${(cy + Math.sin(a) * r).toFixed(2)}`;
  };
  const waist = radius * waistRatio;
  const facets = [];
  // Draw ordinal (short) points first so cardinal points overlap them.
  for (const cardinal of [false, true]) {
    for (let k = cardinal ? 0 : 1; k < 8; k += 2) {
      const angle = k * 45;
      const tip = point(angle, cardinal ? radius : radius * 0.58);
      const left = point(angle - 22.5, waist);
      const right = point(angle + 22.5, waist);
      const centre = `${cx},${cy}`;
      const light = mono ?? (cardinal ? C.lime : C.glacier);
      const shade = mono ?? (cardinal ? C.limeShade : C.glacierShade);
      facets.push(`<polygon points="${centre} ${left} ${tip}" fill="${light}"/>`);
      facets.push(`<polygon points="${centre} ${tip} ${right}" fill="${shade}"/>`);
    }
  }
  const hub = mono
    ? `<circle cx="${cx}" cy="${cy}" r="${radius * 0.075}" fill="${mono}"/>`
    : `<circle cx="${cx}" cy="${cy}" r="${radius * 0.085}" fill="${C.charcoal}"/>` +
      `<circle cx="${cx}" cy="${cy}" r="${radius * 0.04}" fill="${C.lime}"/>`;
  return facets.join('') + hub;
}

/** Subtle topographic contour rings (reuses the in-app pattern for texture). */
function contourLayer(size, opacity) {
  const pattern = readFileSync(join(ASSETS, 'images', 'topo-pattern.svg'), 'utf8');
  const href = `data:image/svg+xml;base64,${Buffer.from(pattern).toString('base64')}`;
  return `<image href="${href}" x="${-size * 0.35}" y="0" width="${size * 1.7}" height="${size}" preserveAspectRatio="xMidYMid slice" opacity="${opacity}"/>`;
}

function background(size, { contours = true } = {}) {
  return (
    `<defs><radialGradient id="bg" cx="50%" cy="38%" r="75%">` +
    `<stop offset="0%" stop-color="${C.slate}"/><stop offset="100%" stop-color="${C.deep}"/>` +
    `</radialGradient></defs>` +
    `<rect width="${size}" height="${size}" fill="url(#bg)"/>` +
    (contours ? contourLayer(size, 0.55) : '')
  );
}

const svg = (size, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${body}</svg>`;

// Android adaptive icons: 108dp canvas, launcher masks show the central 72dp,
// and only the central 66dp circle is guaranteed visible. Keep artwork inside it.
const ADAPTIVE_SAFE_RADIUS = (1024 * 66) / 108 / 2; // ≈ 313px

const ICONS = [
  {
    file: 'icon.png',
    size: 1024,
    transparent: false,
    body: (s) => background(s) + compassRose(s / 2, s / 2, s * 0.36),
  },
  {
    file: 'android-icon-background.png',
    size: 1024,
    transparent: false,
    body: (s) => background(s),
  },
  {
    file: 'android-icon-foreground.png',
    size: 1024,
    transparent: true,
    body: (s) => compassRose(s / 2, s / 2, ADAPTIVE_SAFE_RADIUS * 0.9),
  },
  {
    file: 'android-icon-monochrome.png',
    size: 1024,
    transparent: true,
    body: (s) => compassRose(s / 2, s / 2, ADAPTIVE_SAFE_RADIUS * 0.9, { mono: '#FFFFFF' }),
  },
  {
    // Android 12+ shows the splash icon inside a circle, so keep it compact.
    file: 'splash-icon.png',
    size: 1024,
    transparent: true,
    body: (s) => compassRose(s / 2, s / 2, s * 0.3),
  },
  {
    file: 'favicon.png',
    size: 48,
    transparent: true,
    body: (s) =>
      `<rect width="${s}" height="${s}" rx="${s * 0.22}" fill="${C.charcoal}"/>` +
      compassRose(s / 2, s / 2, s * 0.44, { waistRatio: 0.3 }),
  },
];

const browser = await chromium.launch();
try {
  for (const icon of ICONS) {
    const page = await browser.newPage({
      viewport: { width: icon.size, height: icon.size },
      deviceScaleFactor: 1,
    });
    await page.setContent(
      `<html><body style="margin:0;background:transparent">${svg(icon.size, icon.body(icon.size))}</body></html>`,
    );
    const png = await page.locator('svg').screenshot({ omitBackground: icon.transparent, type: 'png' });
    writeFileSync(join(ASSETS, icon.file), png);
    console.log(`Wrote assets/${icon.file} (${icon.size}×${icon.size})`);
    await page.close();
  }
} finally {
  await browser.close();
}
