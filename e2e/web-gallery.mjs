// Memories gallery: several original photos picked at once (no crop, exact
// pixel size kept), thumbnail grid grouped by trip, full-screen viewer with
// swipe and counter, close returns to the same scroll position, empty state,
// restart persistence — at 360 px.
//
//   npx expo export --platform web --output-dir dist && npm run e2e:gallery
import { deflateSync } from 'node:zlib';

import { BASE, byId, check, iso, launch, run, setStep, shot, text, waitText } from './harness.mjs';

/** A real PNG of the given size (solid colour), so pixel dimensions can be checked end to end. */
function png(width, height, rgb) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 0).map((_, i) => rgb[i % 3])]);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const now = new Date();
const day = (d) => new Date(now.getFullYear(), now.getMonth() + 1, d);
const PHOTOS = [
  { name: 'portrait.png', w: 30, h: 60 },
  { name: 'landscape.png', w: 80, h: 40 },
  { name: 'large.png', w: 2400, h: 1600 },
  ...Array.from({ length: 12 }, (_, i) => ({ name: `p${i}.png`, w: 20, h: 20 })),
].map((p, i) => ({ ...p, buffer: png(p.w, p.h, [40 + i * 10, 120, 200 - i * 10]) }));

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

/** Natural pixel size of the image the current viewer page shows. */
const viewerImageSize = (page) =>
  page.evaluate(() => {
    const pages = [...document.querySelectorAll('[data-testid^="viewer-page-"]')];
    const viewer = document.querySelector('[data-testid="photo-viewer"]').getBoundingClientRect();
    const visible = pages.find((p) => {
      const r = p.getBoundingClientRect();
      return Math.abs(r.left - viewer.left) < 5;
    });
    const img = visible?.querySelector('img');
    return img && img.complete ? { w: img.naturalWidth, h: img.naturalHeight } : null;
  });

await run('Gallery test', async () => {
  let { context, page, errors, dialogs } = await launch();

  setStep('empty gallery');
  await page.goto(`${BASE}/gallery`);
  await byId(page, 'gallery-empty').waitFor({ timeout: 60_000 });

  setStep('pick several originals at once into a journal entry');
  const trip = await createTrip(page, 'Kerala Photos');
  await page.goto(`${trip}/journal`);
  await byId(page, 'journal-new').click();
  await byId(page, 'journal-editor').waitFor();
  await byId(page, 'journal-title').fill('Hills');
  const chooser = page.waitForEvent('filechooser');
  await byId(page, 'journal-photo').click();
  const fc = await chooser;
  check(fc.isMultiple(), 'the picker allows several photos at once');
  await fc.setFiles(PHOTOS.map((p) => ({ name: p.name, mimeType: 'image/png', buffer: p.buffer })));
  await page.waitForFunction((n) => document.querySelectorAll('[data-testid="journal-editor"] img').length >= n, PHOTOS.length, { timeout: 20_000 });
  check(!(await page.getByText(/crop/i).count()), 'no crop step');
  await byId(page, 'journal-save').click();
  await byId(page, 'journal-screen').waitFor();

  setStep('gallery grid grouped by trip');
  await byId(page, 'journal-gallery').click();
  await byId(page, 'gallery-grid').waitFor();
  check((await page.locator('[data-testid^="gallery-photo-"]:not([data-testid$="-cloud"])').count()) >= 9, 'thumbnail grid shows the photos');
  check((await page.getByText('Kerala Photos').count()) >= 1, 'grouped under the trip');
  const cell = await byId(page, 'gallery-photo-0').boundingBox();
  check(cell && cell.width > 90 && cell.width < 120, `3 columns at 360 px (cell ${cell?.width}px)`);
  await shot(page, 'gallery-01-grid');

  setStep('full-screen viewer keeps the original pixels');
  await byId(page, 'gallery-photo-0').click();
  await byId(page, 'photo-viewer').waitFor();
  await waitText(page, 'viewer-counter', (v) => v === `1 / ${PHOTOS.length}`);
  await page.waitForFunction(() => document.querySelector('[data-testid="photo-viewer"] img')?.complete, null, { timeout: 10_000 });
  const first = await viewerImageSize(page);
  check(first?.w === 30 && first?.h === 60, `portrait original kept at 30×60 (${JSON.stringify(first)})`);
  await shot(page, 'gallery-02-viewer');

  setStep('swipe to the next photos');
  const swipe = async () => {
    await page.evaluate(() => {
      const viewer = document.querySelector('[data-testid="photo-viewer"]');
      const scroller = [...viewer.querySelectorAll('div')].find((d) => d.scrollWidth > d.clientWidth + 10);
      scroller.scrollBy({ left: scroller.clientWidth, behavior: 'instant' });
    });
  };
  await swipe();
  await waitText(page, 'viewer-counter', (v) => v === `2 / ${PHOTOS.length}`);
  await page.waitForTimeout(400);
  const second = await viewerImageSize(page);
  check(second?.w === 80 && second?.h === 40, `landscape original kept at 80×40 (${JSON.stringify(second)})`);
  await swipe();
  await waitText(page, 'viewer-counter', (v) => v === `3 / ${PHOTOS.length}`);
  await page.waitForTimeout(600);
  const third = await viewerImageSize(page);
  check(third?.w === 2400 && third?.h === 1600, `large original kept at 2400×1600, not downscaled (${JSON.stringify(third)})`);

  setStep('close returns to the same place in the grid');
  await byId(page, 'viewer-close').click();
  await byId(page, 'photo-viewer').waitFor({ state: 'detached' }).catch(() => undefined);
  const grid = byId(page, 'gallery-grid');
  await grid.evaluate((el) => {
    const s = (() => { const inner = [el, ...el.querySelectorAll('div')].find((d) => d.scrollHeight > d.clientHeight + 10); if (inner) return inner; let p = el.parentElement; while (p && !(p.scrollHeight > p.clientHeight + 10)) p = p.parentElement; return p; })();
    s.scrollTop = s.scrollHeight;
  });
  await page.waitForTimeout(300);
  const before = await grid.evaluate((el) => (() => { const inner = [el, ...el.querySelectorAll('div')].find((d) => d.scrollHeight > d.clientHeight + 10); if (inner) return inner; let p = el.parentElement; while (p && !(p.scrollHeight > p.clientHeight + 10)) p = p.parentElement; return p; })().scrollTop);
  const last = PHOTOS.length - 1;
  await byId(page, `gallery-photo-${last}`).click();
  await waitText(page, 'viewer-counter', (v) => v === `${PHOTOS.length} / ${PHOTOS.length}`);
  await byId(page, 'viewer-close').click();
  await page.waitForTimeout(300);
  const after = await grid.evaluate((el) => (() => { const inner = [el, ...el.querySelectorAll('div')].find((d) => d.scrollHeight > d.clientHeight + 10); if (inner) return inner; let p = el.parentElement; while (p && !(p.scrollHeight > p.clientHeight + 10)) p = p.parentElement; return p; })().scrollTop);
  check(before > 0 && Math.abs(after - before) < 2, `scroll position kept (${before} → ${after})`);

  setStep('removing a photo not in Drive warns that it is the only copy');
  await page.goto(`${trip}/journal`);
  await byId(page, 'journal-entry-Hills').click();
  await byId(page, 'journal-editor').waitFor();
  const dialogsBefore = dialogs.length;
  await page.getByLabel('Remove photo 1').first().click();
  await page.waitForTimeout(300);
  check(dialogs.length === dialogsBefore + 1 && /only one/.test(dialogs.at(-1)), `removal warning shown (${dialogs.at(-1)})`);
  await byId(page, 'journal-save').click().catch(() => undefined);
  await page.goto(`${trip}/gallery`);
  await byId(page, 'gallery-grid').waitFor();

  setStep('by-day grouping and the all-trips gallery after a restart');
  await page.getByText('By day').click();
  await byId(page, 'gallery-photo-0').waitFor();
  await context.close();
  ({ context, page, errors, dialogs } = await launch());
  await page.goto(`${BASE}/profile`);
  await byId(page, 'profile-gallery').click();
  await byId(page, 'gallery-grid').waitFor({ timeout: 60_000 });
  check((await page.locator('[data-testid^="gallery-photo-"]').count()) >= 9, 'photos persisted across a restart (one removed)');
  check(errors.length === 0, `no uncaught page errors (${errors.join(' | ') || 'none'})`);
  await context.close();
});
