// Two-level packing: the trip's category list (level 1) and a category's own
// item list (level 2), with inventory reuse across trips.
//
//   npx expo export --platform web --output-dir dist && npm run e2e:packing
//   SCREENSHOT_DIR=/tmp/shots npm run e2e:packing

import { BASE, byId, check, iso, launch, run, setStep, shot, text, waitText, within } from './harness.mjs';

const now = new Date();
const day = (d) => new Date(now.getFullYear(), now.getMonth() + 1, d);

async function createTrip(page, name, from, to) {
  await page.goto(`${BASE}/trips/new`);
  await byId(page, 'trip-name-input').waitFor({ timeout: 60_000 });
  await byId(page, 'trip-name-input').fill(name);
  await byId(page, 'category-beach').click();
  await byId(page, 'wizard-next').click();
  await byId(page, 'trip-calendar-next-month').click();
  await byId(page, `calendar-day-${iso(day(from))}`).click();
  await byId(page, `calendar-day-${iso(day(to))}`).click();
  await byId(page, 'wizard-next').click();
  await byId(page, 'transport-car').click();
  await byId(page, 'wizard-create').click();
  await byId(page, 'trip-dashboard').waitFor();
  return page.url().split('?')[0];
}

async function addInventoryItem(page, name, category, quantity = 1) {
  await page.goto(`${BASE}/inventory/item/new`);
  await byId(page, 'item-form').waitFor({ timeout: 60_000 });
  await byId(page, 'item-name-input').fill(name);
  await byId(page, 'item-form').getByText(category, { exact: true }).click();
  for (let i = 1; i < quantity; i += 1) await byId(page, 'item-quantity-increment').click();
  await byId(page, 'item-save').click();
  await byId(page, 'item-detail').waitFor();
}

/** A category row on level 1, found by its visible name. */
const categoryRow = (page, name) =>
  byId(page, 'items-tab').locator('[data-testid^="packing-category-"]', { hasText: name }).first();

await run('Packing categories test', async () => {
  const { page, errors, dialogs } = await launch();

  setStep('inventory');
  await addInventoryItem(page, 'Merino T-shirt', 'Clothing', 5);
  await addInventoryItem(page, 'Phone charger', 'Electronics');
  check(true, 'two inventory items');

  setStep('trips');
  const tripA = await createTrip(page, 'Goa Beach', 3, 6);
  const tripB = await createTrip(page, 'Gokarna', 12, 14);

  setStep('level 1 lists every category');
  await page.goto(`${tripA}/packing`);
  await byId(page, 'items-tab').waitFor();
  await byId(page, 'packing-empty-categories').waitFor();
  for (const name of ['Clothing', 'Electronics', 'Toiletries', 'Travel accessories']) {
    await categoryRow(page, name).waitFor();
  }
  check((await byId(page, 'packing-categories').count()) === 0, 'no category has items yet');
  await shot(page, 'p-01-level1-empty');

  setStep('add from inventory into Clothing');
  await categoryRow(page, 'Clothing').getByRole('button', { name: 'Add items' }).click();
  await byId(page, 'packing-add').waitFor();
  await byId(page, 'pick-Merino T-shirt').click();
  await byId(page, 'pick-qty-Merino T-shirt-plus').click();
  await byId(page, 'packing-add-confirm').click();
  await byId(page, 'items-tab').waitFor();
  await byId(page, 'packing-categories').waitFor();
  check((await text(page, 'packing-categories')).includes('1 item · 0 packed'), 'Clothing now has 1 item, unpacked');
  await shot(page, 'p-02-level1-filled');

  setStep('level 2: category detail');
  await categoryRow(page, 'Clothing').click();
  await byId(page, 'packing-category-screen').waitFor();
  await within(page, 'packing-category-screen', 'Merino T-shirt').waitFor();
  await within(page, 'packing-category-screen', '×2 pcs').waitFor();
  check((await text(page, 'category-progress')).includes('0 of 1 packed'), 'new items start unpacked');
  // Tapping the item itself opens nothing.
  await byId(page, 'packing-category-screen').getByText('Merino T-shirt', { exact: true }).click();
  await page.waitForTimeout(400);
  check((await byId(page, 'entry-editor').count()) === 0, 'tapping the row does not open the edit form');
  await page.getByRole('checkbox', { name: 'Merino T-shirt packed' }).click();
  await waitText(page, 'category-progress', (v) => v.includes('1 of 1 packed · 0 left'));
  check(true, 'checkbox packs the item and progress updates');
  await shot(page, 'p-03-level2');

  setStep('menu: edit');
  await byId(page, 'packing-category-screen').locator('[data-testid^="entry-menu-"]').first().click();
  await byId(page, 'entry-actions').waitFor();
  await byId(page, 'sheet-action-edit').click();
  await byId(page, 'entry-editor').waitFor();
  await byId(page, 'entry-unit-sets').click();
  await byId(page, 'entry-notes-input').fill('Two for the beach');
  await byId(page, 'entry-save').click();
  await byId(page, 'packing-category-screen').waitFor();
  await within(page, 'packing-category-screen', '×2 sets').waitFor();
  await within(page, 'packing-category-screen', 'Two for the beach').waitFor();
  check(true, 'edit changes unit and notes');

  setStep('back to level 1');
  await byId(page, 'packing-category-screen').getByTestId('header-back').click();
  await byId(page, 'items-tab').waitFor();
  check((await text(page, 'packing-categories')).includes('100%'), 'level 1 shows the category complete');

  setStep('add screen: owned item, suggestion and a trip-only item');
  await categoryRow(page, 'Electronics').getByRole('button', { name: 'Add items' }).click();
  await byId(page, 'packing-add').waitFor();
  await byId(page, 'packing-add-inventory').getByText('Phone charger').waitFor();
  await byId(page, 'packing-add-suggestions').waitFor();
  await byId(page, 'pick-Phone charger').click();
  await byId(page, 'suggest-Power bank').click();
  await byId(page, 'suggest-qty-Power bank-plus').click();
  await byId(page, 'packing-add-search').fill('Universal plug');
  await byId(page, 'packing-create').click();
  await byId(page, 'new-Universal plug').waitFor();
  check((await byId(page, 'packing-add-search').inputValue()) === '', 'creating clears the search');
  await shot(page, 'p-04-add-screen');
  await byId(page, 'packing-add-confirm').click();
  await byId(page, 'items-tab').waitFor();
  await waitText(page, 'packing-categories', (v) => v.includes('3 items · 0 packed'));
  check(true, 'three items added to Electronics, none packed');

  setStep('category quick add hides what is already on the list');
  await categoryRow(page, 'Electronics').click();
  await byId(page, 'packing-category-screen').waitFor();
  await within(page, 'packing-category-screen', '×2 pcs').waitFor(); // power bank
  await byId(page, 'quick-suggested').waitFor();
  check((await byId(page, 'quick-suggested-Phone charger').count()) === 0, 'phone charger is not suggested again');
  check((await byId(page, 'quick-suggested-Power bank').count()) === 0, 'power bank is not suggested again');
  await byId(page, 'quick-suggested-Earphones').click();
  await within(page, 'packing-category-screen', '×1 pair').waitFor();
  await waitText(page, 'category-progress', (v) => v.includes('0 of 4 packed'));
  check((await byId(page, 'quick-suggested-Earphones').count()) === 0, 'a quick-added suggestion disappears from quick add');
  await shot(page, 'p-05-quick-add');
  await byId(page, 'packing-category-screen').getByTestId('header-back').click();
  await byId(page, 'items-tab').waitFor();

  setStep('the same inventory item on another trip');
  await page.goto(`${tripB}/packing`);
  await byId(page, 'items-tab').waitFor();
  await categoryRow(page, 'Clothing').getByRole('button', { name: 'Add items' }).click();
  await byId(page, 'packing-add').waitFor();
  await byId(page, 'pick-Merino T-shirt').click();
  await byId(page, 'packing-add-confirm').click();
  await byId(page, 'packing-categories').waitFor();
  check((await text(page, 'packing-categories')).includes('1 item · 0 packed'), 'packed state is per trip');

  setStep('menu: remove');
  await categoryRow(page, 'Clothing').click();
  await byId(page, 'packing-category-screen').waitFor();
  await byId(page, 'packing-category-screen').locator('[data-testid^="entry-menu-"]').first().click();
  await byId(page, 'sheet-action-remove').click();
  await within(page, 'packing-category-screen', 'Nothing in Clothing yet').waitFor();
  check(dialogs.some((d) => d.includes('stays in My Inventory')), 'remove confirms and keeps the inventory item');
  await page.goto(`${BASE}/inventory`);
  await byId(page, 'inventory-screen').waitFor();
  await within(page, 'inventory-screen', '2 items · 6 units', { exact: false }).waitFor();
  check(true, 'inventory unchanged (2 items, 6 units)');

  check(errors.length === 0, `no uncaught page errors (${errors.join('; ') || 'none'})`);
});
