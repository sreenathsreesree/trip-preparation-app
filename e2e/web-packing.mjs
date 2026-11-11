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
  await page.waitForTimeout(600); // let the progress bar animate
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

  setStep('custom category from the packing screen');
  await byId(page, 'packing-add-category').click();
  await byId(page, 'category-form').waitFor();
  await byId(page, 'category-name-input').fill('Camera Gear');
  await byId(page, 'category-description-input').fill('Bodies, lenses and cleaning kit');
  await byId(page, 'category-color-3').click();
  await page.getByRole('button', { name: 'Icon camera outline' }).click();
  await byId(page, 'category-save').click();
  await byId(page, 'items-tab').waitFor();
  await categoryRow(page, 'Camera Gear').waitFor();
  check(true, 'custom category appears on the packing screen');
  await categoryRow(page, 'Camera Gear').getByRole('button', { name: 'Add items' }).click();
  await byId(page, 'packing-add').waitFor();
  check((await byId(page, 'packing-add-suggestions').count()) === 0, 'custom categories have no default suggestions');
  await byId(page, 'packing-add-search').fill('Lens cloth');
  await byId(page, 'packing-create').click();
  await byId(page, 'packing-add-confirm').click();
  await byId(page, 'items-tab').waitFor();
  await categoryRow(page, 'Camera Gear').click();
  await byId(page, 'packing-category-screen').waitFor();
  await within(page, 'packing-category-screen', 'Bodies, lenses and cleaning kit').waitFor();
  await within(page, 'packing-category-screen', 'Lens cloth').waitFor();
  check(true, 'custom category works like the defaults (description, items)');

  setStep('edit and protect categories');
  await byId(page, 'category-edit').click();
  await byId(page, 'category-form').waitFor();
  await byId(page, 'category-name-input').fill('Camera Kit');
  await byId(page, 'category-save').click();
  await byId(page, 'packing-category-screen').waitFor();
  await within(page, 'packing-category-screen', 'Camera Kit').waitFor();
  check(true, 'renamed from the category screen');
  await byId(page, 'packing-category-screen').getByTestId('header-back').click();
  await byId(page, 'items-tab').waitFor();
  await categoryRow(page, 'Clothing').click();
  await byId(page, 'packing-category-screen').waitFor();
  await byId(page, 'category-edit').click();
  await byId(page, 'category-protected').waitFor();
  check((await byId(page, 'category-delete').count()) === 0, 'starter categories cannot be deleted');
  await shot(page, 'p-06-starter-protected');
  await byId(page, 'category-form').getByTestId('header-back').click();
  await byId(page, 'packing-category-screen').getByTestId('header-back').click();
  await byId(page, 'items-tab').waitFor();

  setStep('reorder categories');
  await byId(page, 'packing-manage-categories').click();
  await byId(page, 'categories-screen').waitFor();
  const orderBefore = await text(page, 'categories-screen');
  check(orderBefore.indexOf('Camera Kit') > orderBefore.indexOf('Miscellaneous'), 'a new category starts at the end');
  for (let i = 0; i < 2; i += 1) {
    await byId(page, 'category-move-Camera Kit-up').click();
    await page.waitForTimeout(300);
  }
  const orderAfter = await text(page, 'categories-screen');
  check(
    orderAfter.indexOf('Camera Kit') < orderAfter.indexOf('Food and essentials') &&
      orderAfter.indexOf('Camera Kit') > orderAfter.indexOf('Photography'),
    'moved up two places',
  );
  await page.goto(`${tripA}/packing`);
  await byId(page, 'items-tab').waitFor();

  setStep('delete a custom category: items stay');
  await categoryRow(page, 'Camera Kit').click();
  await byId(page, 'category-edit').click();
  await byId(page, 'category-delete').click();
  await page.waitForTimeout(500);
  check(dialogs.some((d) => d.includes('1 trip packing item stays on its trip under “Uncategorised”')), 'delete explains what happens to trip items');
  await page.goto(`${tripA}/packing`);
  await byId(page, 'items-tab').waitFor();
  await categoryRow(page, 'Uncategorised').click();
  await within(page, 'packing-category-screen', 'Lens cloth').waitFor();
  check(true, 'trip item kept under Uncategorised');
  await page.goto(`${tripA}/packing`);
  await byId(page, 'items-tab').waitFor();

  setStep('need to buy → bought → keep → pack');
  await categoryRow(page, 'Toiletries').click();
  await byId(page, 'packing-category-screen').waitFor();
  await byId(page, 'quick-suggested-Shampoo').click();
  await within(page, 'packing-category-screen', 'Shampoo').waitFor();
  const menu = () => byId(page, 'packing-category-screen').locator('[data-testid^="entry-menu-"]').first().click();
  await menu();
  await byId(page, 'sheet-action-buy').click();
  await within(page, 'category-info', 'Shampoo added to the shopping list.').waitFor();
  await within(page, 'packing-category-screen', 'To buy', { exact: false }).waitFor();
  check(true, 'need to buy links a shopping-list entry');
  await menu();
  check((await byId(page, 'sheet-action-buy').count()) === 0, 'no second "Need to buy" for the same item');
  await byId(page, 'sheet-action-bought').click();
  await within(page, 'packing-category-screen', 'Bought · ready to pack', { exact: false }).waitFor();
  check(true, 'marked as bought from the packing list');
  await menu();
  await byId(page, 'sheet-action-keep').click();
  await within(page, 'category-info', 'Shampoo is now in My Inventory.').waitFor();
  await within(page, 'packing-category-screen', 'From inventory', { exact: false }).waitFor();
  await page.getByRole('checkbox', { name: 'Shampoo packed' }).click();
  await waitText(page, 'category-progress', (v) => v.includes('1 of 1 packed'));
  check(true, 'bought item kept in inventory and packed');
  await page.waitForTimeout(600);
  await shot(page, 'p-07-shopping');
  await page.goto(`${tripA}/packing?tab=buy`);
  await byId(page, 'buy-tab').waitFor();
  check((await byId(page, 'buy-tab').getByTestId('purchase-Shampoo').count()) === 1, 'one shopping-list entry for the item');
  await within(page, 'buy-tab', 'On packing list', { exact: false }).waitFor();
  check(true, 'shopping list shows it is on the packing list');
  await page.goto(`${tripA}/packing`);
  await byId(page, 'items-tab').waitFor();

  setStep('smart suggestions skip what is already on the list');
  await page.goto(`${tripA}/packing?tab=suggest`);
  await byId(page, 'suggest-tab').waitFor();
  await byId(page, 'suggest-generate').click();
  await byId(page, 'suggest-covered').waitFor();
  const review = await text(page, 'suggest-tab');
  const reviewPart = review.slice(0, review.indexOf('Already on your list'));
  check(!reviewPart.includes('Phone charger'), 'phone charger (added by hand) is not in the review list');
  check(!reviewPart.includes('Power bank'), 'power bank (added by hand) is not in the review list');
  await shot(page, 'p-08-suggestions-covered');
  await byId(page, 'suggest-link-covered').click();
  await byId(page, 'suggest-covered').waitFor({ state: 'detached' });
  check(true, 'covered suggestions linked without adding anything');
  await page.goto(`${tripA}/packing`);
  await byId(page, 'items-tab').waitFor();
  check((await text(page, 'packing-categories')).includes('4 items · 0 packed'), 'Electronics still has its 4 items (no duplicates)');

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
  await within(page, 'inventory-screen', '3 items · 7 units', { exact: false }).waitFor();
  check(true, 'inventory has the 2 original items and the bought shampoo; removing entries deleted nothing');

  check(errors.length === 0, `no uncaught page errors (${errors.join('; ') || 'none'})`);
});
