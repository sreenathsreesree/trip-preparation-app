// End-to-end test of the inventory and packing engine against the web export.
//
//   npx expo export --platform web --output-dir dist
//   npm run e2e:inventory
//
// In a small-phone viewport: set up categories and items (with an approved
// illustration), use the three inventory views, search/filter/adjust/duplicate/
// archive; plan two overlapping trips and pack them from the inventory,
// confirming one (reservation) and showing the other cannot over-book; review,
// accept, skip and regenerate rule-based suggestions; buy, then add a purchase
// to the inventory and the trip; fill a bag and read its weight estimate;
// restart the browser to check persistence; delete a trip and keep its
// shopping history. See harness.mjs for the shared helpers.

import { BASE, byId, check, iso, launch, plannerAdd, run, setStep, shot, text, waitText, within } from './harness.mjs';

const now = new Date();
const month = now.getMonth() + 1; // trips next month
const day = (d) => new Date(now.getFullYear(), month, d);

async function createTrip(page, { name, place, category, from, to, travellers, transport }) {
  await page.goto(`${BASE}/trips/new`);
  await byId(page, 'trip-name-input').waitFor();
  await byId(page, 'trip-name-input').fill(name);
  await byId(page, `category-${category}`).click();
  await byId(page, 'wizard-next').click();
  await byId(page, 'trip-calendar-next-month').click();
  await byId(page, `calendar-day-${iso(day(from))}`).click();
  await byId(page, `calendar-day-${iso(day(to))}`).click();
  for (const [index, traveller] of travellers.entries()) {
    if (index > 0) await byId(page, 'traveller-add').click();
    await byId(page, `traveller-name-${index}`).fill(traveller.name);
    if (traveller.child) await byId(page, `traveller-kind-${index}`).click();
  }
  await byId(page, 'wizard-next').click();
  await byId(page, `transport-${transport}`).click();
  await byId(page, 'wizard-create').click();
  await byId(page, 'trip-dashboard').waitFor();
  const url = page.url().split('?')[0];
  // Destinations are planned in the planner.
  await page.goto(`${url}/plan`);
  await byId(page, 'planner-screen').waitFor();
  await plannerAdd(page, place);
  await page.goto(url);
  await byId(page, 'trip-dashboard').waitFor();
  return url;
}

async function addItem(page, { name, category, quantity = 1, weight, damaged, acceptSuggestion }) {
  await page.goto(`${BASE}/inventory/item/new`);
  await byId(page, 'item-form').waitFor();
  await byId(page, 'item-name-input').fill(name);
  if (acceptSuggestion) {
    await byId(page, 'image-suggestion-accept').click();
    await byId(page, 'image-remove').waitFor(); // a picture is now set
  }
  await byId(page, 'item-form').getByText(category, { exact: true }).click();
  for (let i = 1; i < quantity; i += 1) await byId(page, 'item-quantity-increment').click();
  if (weight) await byId(page, 'item-weight-input').fill(weight);
  if (damaged) await byId(page, 'item-availability-damaged').click();
  await byId(page, 'item-save').click();
  await byId(page, 'item-detail').waitFor();
  await within(page, 'item-detail', name, { exact: true }).waitFor();
  return page.url();
}

/** A category row on the packing list (level 1), found by its visible name. */
const categoryRow = (page, name) =>
  byId(page, 'items-tab').locator('[data-testid^="packing-category-"]', { hasText: name }).first();

const packingTab = async (page, tab) => {
  await byId(page, 'packing-screen').getByTestId(`segment-${tab}`).click();
  await byId(page, `${tab === 'buy' ? 'buy' : tab}-tab`).waitFor();
};

await run('Inventory & packing test', async () => {
  // ---------------------------------------------------------------- Session 1
  let { context, page, errors, dialogs } = await launch();

  setStep('inventory: empty with starter categories');
  await page.goto(`${BASE}/inventory`);
  await byId(page, 'inventory-empty').waitFor({ timeout: 60_000 });
  check(true, 'empty inventory explains what it is for');
  await byId(page, 'manage-categories').click();
  await byId(page, 'categories-screen').waitFor();
  for (const name of ['Clothing', 'Medicines and first aid', 'Camping and outdoor', 'Food and essentials', 'Miscellaneous']) {
    await within(page, 'categories-screen', name, { exact: true }).waitFor();
  }
  check(true, 'starter categories exist');

  setStep('custom category with a subcategory');
  await byId(page, 'category-new').click();
  await byId(page, 'category-form').waitFor();
  await byId(page, 'category-name-input').fill('Climbing');
  await byId(page, 'category-color-4').click();
  await shot(page, 'm4-01-category-form');
  await byId(page, 'category-save').click();
  await byId(page, 'categories-screen').waitFor();
  await within(page, 'categories-screen', 'Climbing', { exact: true }).waitFor();
  await byId(page, 'add-subcategory-Climbing').click();
  await byId(page, 'category-name-input').fill('Ropes');
  await byId(page, 'category-save').click();
  await byId(page, 'categories-screen').waitFor();
  await within(page, 'categories-screen', 'Ropes', { exact: true }).waitFor();
  await shot(page, 'm4-01b-categories');
  check(true, 'custom category and subcategory created');

  setStep('add items');
  await page.goto(`${BASE}/inventory/item/new`);
  await byId(page, 'item-name-input').fill('Merino T-shirt');
  await byId(page, 'image-suggestion').waitFor();
  check(
    await byId(page, 'item-form').getByText('No picture yet', { exact: false }).isVisible(),
    'a matching illustration is offered, not applied',
  );
  await shot(page, 'm4-02-item-form-suggestion');
  const merinoUrl = await addItem(page, { name: 'Merino T-shirt', category: 'Clothing', quantity: 3, weight: '180 g', acceptSuggestion: true });
  check(
    await within(page, 'item-detail', 'Illustration (not a photo of the item)').isVisible(),
    'approved illustration is labelled as not a photo',
  );
  await shot(page, 'm4-03-item-detail');
  await addItem(page, { name: 'Rain jacket', category: 'Clothing', weight: '400' });
  const cameraUrl = await addItem(page, { name: 'Camera', category: 'Photography', weight: '1.2 kg' });
  await addItem(page, { name: 'Headlamp', category: 'Electronics', damaged: true });
  check(true, 'four items added (one marked damaged)');

  setStep('three views stay in sync');
  await page.goto(`${BASE}/inventory`);
  await byId(page, 'inventory-screen').waitFor();
  await byId(page, 'segment-folders').click();
  const clothingFolder = await byId(page, 'folder-clothing').getAttribute('aria-label');
  check(clothingFolder?.startsWith('Clothing, 2 items'), `folder view counts items ("${clothingFolder}")`);
  await shot(page, 'm4-04-folders');
  await byId(page, 'segment-gallery').click();
  await byId(page, 'inventory-result-count').waitFor();
  check((await page.locator('[data-testid^="item-card-"]').count()) === 4, 'gallery shows all four items');
  await page.waitForTimeout(400);
  await shot(page, 'm4-05-gallery');
  await byId(page, 'segment-list').click();
  check((await page.locator('[data-testid^="item-row-"]').count()) === 4, 'list shows all four items');
  await byId(page, 'inventory-search').fill('camera');
  await waitText(page, 'inventory-result-count', (v) => v.startsWith('1 '));
  check(true, 'search narrows the list');
  await byId(page, 'inventory-search').fill('');
  await byId(page, 'status-filter-damaged').click();
  await waitText(page, 'inventory-result-count', (v) => v.startsWith('1 '));
  check(await within(page, 'inventory-screen', 'Headlamp', { exact: true }).isVisible(), 'status filter finds the damaged item');
  await byId(page, 'status-filter-active').click();
  await waitText(page, 'inventory-result-count', (v) => v.startsWith('4 '));
  await page.waitForTimeout(300);
  await shot(page, 'm4-06-list');

  setStep('quantity, duplicate, archive, delete');
  const rainRow = page.locator('[data-testid^="item-row-"]', { hasText: 'Rain jacket' });
  await rainRow.locator('[data-testid$="-plus"]').click();
  await rainRow.getByText('2', { exact: true }).waitFor();
  check(true, 'quantity adjusted inline');
  await rainRow.locator('[data-testid^="item-more-"]').click();
  await byId(page, 'sheet-action-duplicate').click();
  await byId(page, 'item-detail').waitFor();
  await within(page, 'item-detail', 'Rain jacket (copy)').waitFor();
  check(true, 'duplicate opens the copy');
  await byId(page, 'item-actions').click();
  await byId(page, 'sheet-action-archive').click();
  await within(page, 'item-detail', 'Archived').waitFor();
  check(true, 'copy archived');
  await byId(page, 'item-actions').click();
  await byId(page, 'sheet-action-delete').click();
  await byId(page, 'inventory-screen').waitFor();
  check(dialogs.some((d) => d.includes('Rain jacket (copy)') && d.includes('permanently')), 'delete asked first');

  setStep('plan two overlapping trips');
  const tripA = await createTrip(page, {
    name: 'Ladakh Trek',
    place: 'Leh',
    category: 'mountains',
    from: 5,
    to: 9,
    travellers: [{ name: 'Asha' }, { name: 'Kabir', child: true }],
    transport: 'flight',
  });
  await byId(page, 'packing-summary').waitFor();
  check(true, 'dashboard shows the packing card');
  await shot(page, 'm4-07-dashboard-card');
  const tripB = await createTrip(page, {
    name: 'Photo Walk',
    place: 'Jaipur',
    category: 'leisure',
    from: 7,
    to: 8,
    travellers: [{ name: 'Asha' }],
    transport: 'car',
  });
  check(true, 'two trips with overlapping dates');

  setStep('pack trip A from the inventory');
  await page.goto(`${tripA}/packing`);
  await byId(page, 'items-tab').waitFor();
  await categoryRow(page, 'Clothing').getByRole('button', { name: 'Add items' }).click();
  await byId(page, 'packing-add').waitFor();
  await byId(page, 'pick-Merino T-shirt').click();
  await byId(page, 'pick-qty-Merino T-shirt-plus').click();
  await byId(page, 'packing-add-search').fill('head');
  await byId(page, 'packing-add-inventory-other').waitFor();
  check(await byId(page, 'pick-Headlamp').isDisabled(), 'damaged items cannot be picked');
  await byId(page, 'packing-add-search').fill('camera');
  await byId(page, 'pick-Camera').click();
  check(await within(page, 'packing-add', '1 of 1 free for these dates').isVisible(), 'shows what is free for the dates');
  await shot(page, 'm4-08-add-from-inventory');
  await byId(page, 'packing-add-confirm').click();
  await byId(page, 'items-tab').waitFor();
  await categoryRow(page, 'Food and essentials').getByRole('button', { name: 'Add items' }).click();
  await byId(page, 'packing-add').waitFor();
  await byId(page, 'packing-add-search').fill('Sandwiches');
  await byId(page, 'packing-create').click();
  await byId(page, 'packing-add-confirm').click();
  await byId(page, 'items-tab').waitFor();
  check((await text(page, 'packing-categories')).includes('Photography'), 'an item from another category keeps its own category');
  await categoryRow(page, 'Food and essentials').click();
  await within(page, 'packing-category-screen', 'Sandwiches').waitFor();
  await within(page, 'packing-category-screen', 'Trip only', { exact: false }).waitFor();
  check(true, 'inventory items and a trip-only item on the list');
  await page.goto(`${tripA}/packing`);
  await byId(page, 'items-tab').waitFor();
  await categoryRow(page, 'Photography').click();
  await page.getByRole('checkbox', { name: 'Camera packed' }).click();
  await waitText(page, 'category-progress', (v) => v.includes('1 of 1 packed'));
  await byId(page, 'packing-category-screen').getByTestId('header-back').click();
  await waitText(page, 'packing-screen', (v) => v.includes('1 of 3 items packed'));
  check(true, 'packing progress counts items across categories');

  setStep('confirm trip A (reserves)');
  await byId(page, 'packing-confirm').click();
  await within(page, 'packing-screen', 'Confirmed · inventory reserved for these dates').waitFor();
  await shot(page, 'm4-09-packing-confirmed');
  await page.goto(cameraUrl);
  await byId(page, 'item-detail').waitFor();
  await within(page, 'item-detail', '1 of 1 reserved for upcoming trips').waitFor();
  await within(page, 'item-detail', 'Ladakh Trek').waitFor();
  check(true, 'inventory shows the reservation and the trip');

  setStep('trip B cannot over-book the camera');
  await page.goto(`${tripB}/packing`);
  await byId(page, 'items-tab').waitFor();
  await categoryRow(page, 'Photography').getByRole('button', { name: 'Add items' }).click();
  await byId(page, 'packing-add').waitFor();
  check(await within(page, 'packing-add', '0 of 1 free for these dates').isVisible(), 'camera shows as taken for these dates');
  await byId(page, 'pick-Camera').click();
  await byId(page, 'packing-add-confirm').click();
  await byId(page, 'items-tab').waitFor();
  await categoryRow(page, 'Photography').waitFor();
  check((await text(page, 'packing-categories')).includes('1 item'), 'a draft list may still include it');
  await byId(page, 'packing-confirm').click();
  await byId(page, 'packing-conflicts').waitFor();
  check((await text(page, 'packing-conflicts')).includes('Camera: 1 needed, only 0 free'), 'confirming explains the clash');
  await within(page, 'packing-screen', 'Draft · nothing reserved yet').waitFor();
  await shot(page, 'm4-10-conflict');
  await categoryRow(page, 'Photography').click();
  await byId(page, 'packing-category-screen').waitFor();
  await byId(page, 'packing-category-screen').locator('[data-testid^="entry-menu-"]').first().click();
  await byId(page, 'sheet-action-edit').click();
  await byId(page, 'entry-editor').waitFor();
  await shot(page, 'm4-10b-entry-editor');
  await byId(page, 'entry-remove').click();
  await byId(page, 'packing-category-screen').waitFor();
  check(dialogs.some((d) => d.includes('stays in your inventory')), 'removing explains the item stays in the inventory');
  await within(page, 'packing-category-screen', 'Nothing in Photography yet').waitFor();
  check(true, 'entry removed');

  setStep('suggestions for trip A');
  await page.goto(`${tripA}/packing?tab=suggest`);
  await byId(page, 'suggest-tab').waitFor();
  await byId(page, 'activity-trekking').click();
  await byId(page, 'suggest-generate').click();
  await byId(page, 'suggestion-medicines.first_aid').waitFor();
  check(
    await within(page, 'suggest-tab', 'Medicines and first aid ·', { exact: false }).isVisible(),
    'suggestions are grouped by category',
  );
  check(true, 'deterministic suggestions generated for review');
  check(
    (await text(page, 'suggestion-electronics.headlamp')).includes('marked damaged'),
    'owned-but-damaged item is pointed out',
  );
  await shot(page, 'm4-11-suggestions');
  await byId(page, 'suggestion-electronics.headlamp').scrollIntoViewIfNeeded();
  await shot(page, 'm4-11b-suggestion-cards');
  await byId(page, 'suggestion-accept-medicines.first_aid').click();
  await byId(page, 'accepted-medicines.first_aid').waitFor();
  check(true, 'accepted suggestion added to the list');
  await byId(page, 'suggestion-reject-electronics.power_bank').click();
  await byId(page, 'suggest-show-skipped').waitFor();
  check(true, 'skipped suggestion recorded');
  await byId(page, 'suggestion-buy-electronics.headlamp').click();
  await within(page, 'suggest-tab', 'added to the shopping list').waitFor();
  check(true, 'suggestion sent to the shopping list');

  setStep('regenerate after changing the trip profile');
  await byId(page, 'activity-photography').click();
  await page.waitForTimeout(300);
  await byId(page, 'suggest-generate').click();
  await byId(page, 'suggest-plan').waitFor();
  const plan = await text(page, 'suggest-plan');
  check(plan.includes('new suggestion') && plan.includes('stay skipped'), `regeneration is previewed ("${plan.split('\n').find((l) => l.includes('new')) ?? ''}")`);
  await shot(page, 'm4-12-regenerate-preview');
  await byId(page, 'suggest-apply').click();
  // The camera is already on the list, so its suggestion waits under "Already on your list".
  await byId(page, 'suggest-covered').waitFor();
  await byId(page, 'suggest-show-covered').click();
  await byId(page, 'suggestion-photography.camera').waitFor();
  check(
    (await text(page, 'suggestion-photography.camera')).includes('Already on your list'),
    'owned camera already on the list is recognised',
  );
  await byId(page, 'suggestion-accept-photography.camera').click();
  await byId(page, 'accepted-photography.camera').waitFor();
  await byId(page, 'suggest-show-skipped').click();
  await byId(page, 'suggestion-restore-electronics.power_bank').waitFor();
  check(true, 'skipped suggestion stays skipped after regenerating');
  await packingTab(page, 'items');
  await categoryRow(page, 'Photography').click();
  await byId(page, 'packing-category-screen').waitFor();
  check(
    (await byId(page, 'packing-category-screen').getByText('Camera', { exact: true }).count()) === 1,
    'linking did not duplicate the camera entry',
  );
  await byId(page, 'packing-category-screen').getByTestId('header-back').click();

  setStep('shopping list lifecycle');
  await packingTab(page, 'buy');
  await within(page, 'buy-tab', 'Torch or headlamp').waitFor();
  await byId(page, 'purchase-name-input').fill('Travel adapter');
  await byId(page, 'purchase-add').click();
  await byId(page, 'purchase-Travel adapter').waitFor();
  await byId(page, 'purchase-name-input').fill('travel adapter');
  await byId(page, 'purchase-add').click();
  await within(page, 'buy-tab', 'already on this shopping list').waitFor();
  check(true, 'duplicate purchases are prevented');
  await byId(page, 'purchase-Travel adapter').click();
  await byId(page, 'sheet-action-status-purchased').click();
  await within(page, 'buy-tab', 'Purchased (1)').waitFor();
  await byId(page, 'purchase-Travel adapter').click();
  await byId(page, 'sheet-action-inventory').click();
  await within(page, 'buy-tab', 'Travel adapter added to your inventory.').waitFor();
  await byId(page, 'purchase-Travel adapter').click();
  await byId(page, 'sheet-action-trip').click();
  await within(page, 'buy-tab', 'Travel adapter added to the packing list.').waitFor();
  await byId(page, 'purchase-Torch or headlamp').click();
  await byId(page, 'sheet-action-status-borrowed').click();
  await within(page, 'buy-tab', 'Borrowing (1)').waitFor();
  await byId(page, 'purchase-actions').waitFor({ state: 'hidden' });
  await page.waitForTimeout(300);
  await shot(page, 'm4-13-buy');
  await packingTab(page, 'items');
  await categoryRow(page, 'Uncategorised').click();
  await byId(page, 'packing-category-screen').waitFor();
  const adapter = page.getByRole('checkbox', { name: 'Travel adapter packed' });
  check(!(await adapter.isChecked()), 'a purchase is added unpacked');
  await byId(page, 'packing-category-screen').getByTestId('header-back').click();
  await byId(page, 'items-tab').waitFor();

  setStep('luggage');
  await packingTab(page, 'bags');
  await byId(page, 'add-bag-cabin').click();
  await byId(page, 'bag-editor').waitFor();
  await byId(page, 'bag-entry-Camera').click();
  await byId(page, 'bag-entry-Merino T-shirt').click();
  await shot(page, 'm4-14a-bag-editor');
  await byId(page, 'bag-save').click();
  await byId(page, 'bags-tab').waitFor();
  const weight = await waitText(page, 'bag-weight-Cabin bag', (v) => v.length > 0);
  check(weight === 'About 1.6 kg', `bag weight estimated from known weights ("${weight}")`);
  await byId(page, 'add-bag-daypack').click();
  await byId(page, 'bag-editor').waitFor();
  await byId(page, 'bag-entry-Sandwiches').click();
  await byId(page, 'bag-save').click();
  await byId(page, 'bags-tab').waitFor();
  const unknown = await waitText(page, 'bag-weight-Daypack', (v) => v.length > 0);
  check(unknown.startsWith('Weight unknown'), `unknown weights are not guessed ("${unknown}")`);
  await page.waitForTimeout(300);
  await shot(page, 'm4-14-bags');
  check(errors.length === 0, `no uncaught page errors (${errors.join(' | ') || 'none'})`);
  await context.close();

  // ---------------------------------------------- Session 2: full restart
  setStep('after restart');
  ({ context, page, errors, dialogs } = await launch());
  await page.goto(`${tripA}/packing`);
  await byId(page, 'packing-screen').waitFor({ timeout: 60_000 });
  await within(page, 'packing-screen', 'Confirmed · inventory reserved for these dates').waitFor();
  await categoryRow(page, 'Uncategorised').click();
  await within(page, 'packing-category-screen', 'Travel adapter').waitFor();
  check(true, 'packing list and confirmation persisted');
  await byId(page, 'packing-category-screen').getByTestId('header-back').click();
  await byId(page, 'items-tab').waitFor();
  await packingTab(page, 'bags');
  await byId(page, 'bag-Cabin bag').waitFor();
  check(true, 'bags persisted');
  await page.goto(merinoUrl);
  await byId(page, 'item-detail').waitFor();
  await within(page, 'item-detail', 'Illustration (not a photo of the item)').waitFor();
  check(true, 'item and its illustration persisted');
  await page.goto(`${BASE}/inventory`);
  await byId(page, 'segment-list').click();
  await within(page, 'inventory-screen', 'Travel adapter').waitFor();
  check(true, 'purchased item is in the inventory');

  setStep('delete trip A: reservations end, shopping history stays');
  await page.goto(tripA);
  await byId(page, 'trip-dashboard').waitFor();
  await byId(page, 'trip-actions').click();
  await byId(page, 'sheet-action-delete').click();
  await byId(page, 'trips-screen').waitFor();
  await page.goto(cameraUrl);
  await byId(page, 'item-detail').waitFor();
  await within(page, 'item-detail', 'Not on any packing list yet', { exact: false }).waitFor();
  check(
    (await within(page, 'item-detail', 'reserved for upcoming trips').count()) === 0,
    'deleting the trip released the camera',
  );
  await page.goto(`${BASE}/inventory/shopping`);
  await byId(page, 'shopping-screen').waitFor();
  await byId(page, 'segment-all').click();
  await within(page, 'shopping-screen', 'Ladakh Trek (trip deleted)').waitFor();
  check(true, 'shopping history kept for the deleted trip');
  await page.waitForTimeout(300);
  await shot(page, 'm4-15-shopping-history');
  check(errors.length === 0, `no uncaught page errors after restart (${errors.join(' | ') || 'none'})`);
  await context.close();
});
