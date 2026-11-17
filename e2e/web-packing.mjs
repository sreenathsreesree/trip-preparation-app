// Two-level packing: the trip's category list (level 1) and a category's own
// item list (level 2), with inventory reuse across trips.
//
//   npx expo export --platform web --output-dir dist && npm run e2e:packing
//   SCREENSHOT_DIR=/tmp/shots npm run e2e:packing

import { BASE, byId, check, dragElement, expand, iso, launch, run, setStep, shot, text, touchDragElement, touchTap, waitText, within } from './harness.mjs';

async function waitFor(fn, timeout = 15_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('condition not met in time');
}

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
  const { context, page, errors, dialogs, dismissNext } = await launch();

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
  await byId(page, 'category-delete-target').waitFor();
  check(dialogs.some((d) => d.includes('1 trip packing item')), 'delete explains that items are kept and asks where they go');
  await page.getByText('Move them to Miscellaneous', { exact: true }).click();
  await page.waitForTimeout(500);
  await page.goto(`${tripA}/packing`);
  await byId(page, 'items-tab').waitFor();
  await categoryRow(page, 'Miscellaneous').click();
  await within(page, 'packing-category-screen', 'Lens cloth').waitFor();
  check(true, 'trip item moved to the chosen category, nothing deleted');
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

  setStep('Clothing lives in Packing: groups, filters, move to group');
  const tripBId = new URL(tripB).pathname.split('/').pop();
  await page.goto(tripB);
  await byId(page, 'trip-clothing').click();
  await byId(page, 'packing-category-screen').waitFor({ timeout: 60_000 });
  check(/Clothing/.test(await text(page, 'packing-category-screen')) && page.url().includes(tripBId), 'the dashboard’s Clothing opens Packing → Clothing for this trip');
  await byId(page, 'quick-owned-Merino T-shirt').click();
  await within(page, 'packing-category-screen', 'Merino T-shirt').waitFor();
  await byId(page, 'category-groups-toggle').click();
  await byId(page, 'category-group-input').fill('Sleepwear');
  await byId(page, 'category-group-add').click();
  await byId(page, 'category-group-rename-Sleepwear').click();
  await byId(page, 'category-group-rename-input').fill('Nightwear');
  await byId(page, 'category-group-rename-save').click();
  await byId(page, 'category-group-Nightwear').waitFor();
  check(true, 'a group is created and renamed with the user’s own name');
  await byId(page, 'packing-category-screen').locator('[data-testid^="entry-menu-"]').first().click();
  await byId(page, 'sheet-action-move').click();
  await page.getByText('Nightwear', { exact: true }).last().click();
  await byId(page, 'category-block-Nightwear').waitFor();
  check(/Nightwear · 1/i.test(await text(page, 'category-block-Nightwear')), 'the item moved into the group');
  await byId(page, 'category-filter-packed').click();
  check((await byId(page, 'packing-category-screen').locator('[data-testid^="entry-menu-"]').count()) === 0, 'Packed shows only packed items');
  await byId(page, 'category-filter-all').click();
  await byId(page, 'category-group-delete-Nightwear').click();
  await page.getByText('Keep them in Clothing', { exact: true }).click();
  await page.waitForTimeout(400);
  check((await byId(page, 'category-group-Nightwear').count()) === 0 && (await within(page, 'packing-category-screen', 'Merino T-shirt').count()) > 0, 'deleting a group keeps its items');

  setStep('Templates: packing sections become packing items, with approval');
  await page.goto(`${BASE}/checklists`);
  await byId(page, 'segment-templates').click();
  await byId(page, 'templates-new').click();
  await byId(page, 'template-name-input').fill('Old clothes');
  await byId(page, 'template-save').click();
  await byId(page, 'template-editor').waitFor();
  await byId(page, 'add-section-input').fill('Clothing');
  await byId(page, 'add-section-button').click();
  for (const task of ['Rain jacket', 'Sun hat']) {
    await byId(page, 'add-task-Clothing-input').fill(task);
    await byId(page, 'add-task-Clothing-button').click();
    await within(page, 'template-editor', task).waitFor();
  }
  const applyOldClothes = async () => {
    await page.goto(tripB);
    await byId(page, 'open-checklist').click();
    await byId(page, `checklist-trip-sections-${tripBId}`).waitFor({ timeout: 60_000 });
    await byId(page, 'apply-templates').click();
    await page.locator('[data-testid^="template-option-"]').first().click();
    await byId(page, 'apply-templates-confirm').click();
    await byId(page, 'apply-packing-result').waitFor();
    return text(page, 'apply-packing-result');
  };
  let asked = dialogs.length;
  dismissNext();
  check(/2 packing items not added/.test(await applyOldClothes()) && dialogs.length > asked && /Add the packing items to Packing/.test(dialogs.at(-1) ?? ''), 'applying asks first; declining adds nothing');
  check((await byId(page, 'apply-result').count()) === 0, 'no checklist tasks were created from the packing section');
  check(/Added 2 packing items to Packing/.test(await applyOldClothes()), 'approving adds them to Packing');
  check(/already on the list/.test(await applyOldClothes()), 'applying again adds no duplicates');
  await page.goto(`${tripB}/packing`);
  await byId(page, 'items-tab').waitFor({ timeout: 60_000 });
  await categoryRow(page, 'Clothing').click();
  await within(page, 'packing-category-screen', 'Rain jacket').waitFor();
  check((await within(page, 'packing-category-screen', 'Sun hat').count()) > 0, 'the template’s clothes are Clothing packing items');

  setStep('From your old checklist: move or keep, each confirmed');
  // An old-style Clothing checklist section with tasks, as earlier versions created it.
  await page.goto(`${BASE}/checklists`);
  await byId(page, `checklist-trip-toggle-${tripBId}`).waitFor({ timeout: 60_000 });
  if ((await byId(page, `checklist-trip-sections-${tripBId}`).count()) === 0) await byId(page, `checklist-trip-toggle-${tripBId}`).click();
  await byId(page, 'section-add-open').click();
  await byId(page, 'section-form-name').fill('Clothing');
  await byId(page, 'section-form-starter').fill('Wool scarf\nSun cap');
  await byId(page, 'section-form-save').click();
  await byId(page, `checklist-trip-sections-${tripBId}`).getByTestId('section-card-clothing').waitFor();
  await page.goto(`${tripB}/packing`);
  await byId(page, 'old-checklist').waitFor({ timeout: 60_000 });
  asked = dialogs.length;
  await byId(page, 'old-task-move-Wool scarf').click();
  await byId(page, 'old-checklist-message').waitFor();
  check(dialogs.length > asked && /Move “Wool scarf” to the packing list/.test(dialogs.at(-1) ?? ''), 'moving asks for confirmation first');
  check((await byId(page, 'old-task-Wool scarf').count()) === 0, 'the moved task is no longer offered');
  await byId(page, 'old-task-keep-Sun cap').click();
  await page.waitForTimeout(400);
  check((await byId(page, 'old-checklist').count()) === 0 || (await byId(page, 'old-task-Sun cap').count()) === 0, 'a kept task is not offered again');
  await categoryRow(page, 'Clothing').click();
  await within(page, 'packing-category-screen', 'Wool scarf').waitFor();
  check(true, 'the moved task is now a Clothing packing item');
  await page.goto(`${BASE}/checklists`);
  await byId(page, `checklist-trip-toggle-${tripBId}`).click();
  const kept = byId(page, `checklist-trip-sections-${tripBId}`).getByRole('button', { name: /^Clothing:/ });
  await kept.first().waitFor();
  check((await kept.count()) === 1, 'the old Clothing section stays while it still has a (kept) task');
  await kept.first().click();
  await byId(page, 'section-old-packing').waitFor();
  check(/Sun cap/.test(await text(page, 'section-screen-custom')) && !/Wool scarf/.test(await text(page, 'section-screen-custom')), 'the kept task is still in the checklist; the moved one is not');

  setStep('Checklist: compact trip cards, one open at a time');
  const tripAId = new URL(tripA).pathname.split('/').pop();
  await page.goto(`${BASE}/checklists`);
  await byId(page, `checklist-trip-toggle-${tripAId}`).waitFor({ timeout: 60_000 });
  check((await page.locator('[data-testid^="checklist-trip-sections-"]').count()) === 0, 'several upcoming trips start collapsed');
  const collapsedCount = await text(page, `checklist-trip-count-${tripAId}`);
  await byId(page, `checklist-trip-toggle-${tripAId}`).click();
  await byId(page, `checklist-trip-sections-${tripAId}`).waitFor();
  const sums = await byId(page, `checklist-trip-sections-${tripAId}`).locator('[data-testid^="section-card-"], [data-testid="checklist-packing-row"]').allInnerTexts();
  const totals = sums.map((t) => /(\d+)\/(\d+)/.exec(t)).filter(Boolean).reduce((a, m) => [a[0] + Number(m[1]), a[1] + Number(m[2])], [0, 0]);
  check(collapsedCount.startsWith(`${totals[0]}/${totals[1]}`), `collapsed figure ${collapsedCount} matches the sections (${totals[0]}/${totals[1]})`);
  await byId(page, `checklist-trip-toggle-${tripBId}`).click();
  await byId(page, `checklist-trip-sections-${tripBId}`).waitFor();
  check((await byId(page, `checklist-trip-sections-${tripAId}`).count()) === 0, 'opening another trip closes the first');
  await byId(page, `checklist-trip-toggle-${tripBId}`).click();
  check((await page.locator('[data-testid^="checklist-trip-sections-"]').count()) === 0, 'tapping the open trip closes it');
  await byId(page, `checklist-trip-toggle-${tripAId}`).click();
  await byId(page, `checklist-trip-sections-${tripAId}`).locator('[data-testid="section-card-documents"]').click();
  await byId(page, 'section-screen-documents').waitFor();
  check(page.url().includes(tripAId), 'a section opens for the right trip');

  setStep('Checklist: sections managed inline (add, rename, reorder, delete, from Inventory)');
  await page.goto(`${BASE}/checklists`);
  await byId(page, `checklist-trip-toggle-${tripAId}`).waitFor({ timeout: 60_000 });
  await byId(page, `checklist-trip-toggle-${tripAId}`).click();
  const panel = byId(page, `sections-panel-${tripAId}`);
  await panel.waitFor();
  check((await byId(page, 'manage-sections').count()) === 0, 'no separate Manage sections button');
  const order = async () => (await panel.locator('[data-testid^="section-card-"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid'))));
  await byId(page, 'section-add-open').click();
  await byId(page, 'section-form-name').fill('Camera kit');
  await byId(page, 'section-form-description').fill('Lenses and batteries');
  await byId(page, 'section-form-starter').fill('Charge batteries\nClean lens');
  await byId(page, 'section-form-save').click();
  await byId(page, 'section-card-camera-kit').waitFor();
  check((await text(page, 'section-card-camera-kit')).includes('0/2'), 'new section with its two starter tasks');
  await byId(page, 'section-add-open').click();
  await byId(page, 'section-form-name').fill('camera KIT');
  await byId(page, 'section-form-save').click();
  await byId(page, 'section-form-error').waitFor();
  check(true, 'a duplicate section name is refused');
  await byId(page, 'section-form').getByRole('button', { name: 'Cancel' }).click();
  await byId(page, 'section-menu-Camera kit').click();
  await byId(page, 'sheet-action-edit').click();
  await byId(page, 'section-form-name').fill('Camera gear');
  await byId(page, 'section-form-save').click();
  await byId(page, 'section-card-camera-gear').waitFor();
  check(true, 'section renamed inline');
  const before = await order();
  await byId(page, 'section-menu-Camera gear').click();
  await byId(page, 'sheet-action-up').click();
  await waitFor(async () => (await order()).indexOf('section-card-camera-gear') === before.indexOf('section-card-camera-gear') - 1);
  check(true, 'Move up reorders the sections');
  await page.reload();
  await byId(page, `checklist-trip-toggle-${tripAId}`).waitFor({ timeout: 60_000 });
  await byId(page, `checklist-trip-toggle-${tripAId}`).click();
  await panel.waitFor();
  check((await order()).indexOf('section-card-camera-gear') === before.indexOf('section-card-camera-gear') - 1, 'the new order survives a reload');
  await byId(page, 'section-from-category').click();
  await byId(page, 'section-category-Electronics').click();
  await byId(page, 'section-inventory').waitFor();
  await byId(page, 'section-inventory-item-Phone charger').click();
  await byId(page, 'section-inventory-add').click();
  await waitText(page, 'sections-message', (v) => v.includes('1 added from Inventory'));
  check(true, 'an Inventory category becomes a section with the chosen item');
  await byId(page, 'section-card-electronics').waitFor();
  check((await text(page, 'section-card-electronics')).includes('0/1'), 'the Electronics section holds the item');
  await byId(page, 'section-from-category').click();
  await byId(page, 'section-category-Electronics').click();
  await byId(page, 'section-inventory').waitFor();
  check(await byId(page, 'section-inventory-item-Phone charger').isDisabled(), 'the same category reuses its section; linked items cannot be added twice');
  await panel.getByRole('button', { name: 'Done' }).last().click();
  const dialogsBefore = dialogs.length;
  await byId(page, 'section-menu-Camera gear').click();
  await byId(page, 'sheet-action-delete').click();
  await waitFor(async () => (await byId(page, 'section-card-camera-gear').count()) === 0);
  check(dialogs.length > dialogsBefore && dialogs.at(-1).includes('Camera gear'), 'deleting a section asks first');

  setStep('Checklist: sections reorder by drag-and-drop');
  await page.goto(`${BASE}/checklists`);
  await byId(page, `checklist-trip-toggle-${tripAId}`).waitFor({ timeout: 60_000 });
  await byId(page, `checklist-trip-toggle-${tripAId}`).click();
  await panel.waitFor();
  const firstRow = panel.locator('[data-testid^="section-row-"]').first();
  const firstName = (await firstRow.getAttribute('data-testid')).slice('section-row-'.length);
  await dragElement(page, byId(page, 'section-row-Electronics').locator('[data-testid^="drag-"]'), byId(page, `section-row-${firstName}`), 'before');
  await waitFor(async () => (await order())[0] === 'section-card-electronics');
  check(true, 'dragging a section moves it to the top');

  setStep('Section screen: arrange groups and tasks, menus, unified editor');
  await byId(page, 'section-card-electronics').click();
  const sectionScreen = byId(page, 'section-screen-custom');
  await sectionScreen.waitFor();
  for (const title of ['Travel adapter', 'Power bank']) {
    await byId(page, 'add-item-input').fill(title);
    await byId(page, 'add-item-button').click();
    await within(page, 'section-screen-custom', title).waitFor();
  }
  await expand(page, 'section-groups-section');
  for (const g of ['Cables', 'Batteries']) {
    await byId(page, 'section-group-input').fill(g);
    await byId(page, 'section-group-add').click();
    await byId(page, `section-group-block-${g}`).waitFor();
  }
  await byId(page, 'toggle-reorder').click();
  await byId(page, 'section-arrange').waitFor();
  await dragElement(page, byId(page, 'arrange-task-Power bank').locator('[data-testid^="drag-"]'), byId(page, 'arrange-group-Batteries'), 'inside');
  const arranged = async () => page.evaluate(() => [...document.querySelectorAll('[data-testid^="arrange-group-"], [data-testid^="arrange-task-"]')].map((e) => e.getAttribute('data-testid').replace(/^arrange-(group|task)-/, '')));
  await waitFor(async () => { const o = await arranged(); return o.indexOf('Power bank') === o.indexOf('Batteries') + 1; });
  check(true, 'a task dragged onto a group moves into it');
  await byId(page, 'arrange-down-Cables').click();
  await waitFor(async () => { const o = await arranged(); return o.indexOf('Batteries') < o.indexOf('Cables'); });
  check(true, 'Move down reorders the groups');
  await dragElement(page, byId(page, 'arrange-task-Power bank').locator('[data-testid^="drag-"]'), byId(page, 'arrange-task-Travel adapter'), 'after');
  await waitFor(async () => { const o = await arranged(); return o.indexOf('Power bank') > o.indexOf('Travel adapter') && o.indexOf('Travel adapter') > o.indexOf('Cables'); });
  check(true, 'a task dragged below the groups leaves its group');
  await byId(page, 'toggle-reorder').click();
  await waitFor(async () => (await byId(page, 'section-group-block-Not in a group').count()) > 0 && /Power bank/.test(await text(page, 'section-group-block-Not in a group')));
  check(true, 'it shows under “Not in a group”');

  await byId(page, 'task-menu-Travel adapter').click();
  check((await byId(page, 'task-menu-sheet').innerText()).includes('Move to another section'), 'the task menu says what each action does');
  await byId(page, 'sheet-action-group').click();
  await byId(page, 'task-move-sheet').getByText('Cables', { exact: true }).click();
  await waitFor(async () => /Travel adapter/.test(await text(page, 'section-group-block-Cables')));
  check(true, 'Move to a group');
  await byId(page, 'task-menu-Travel adapter').click();
  await byId(page, 'sheet-action-section').click();
  await byId(page, 'task-section-sheet').getByText('Documents', { exact: true }).click();
  await waitText(page, 'section-message', (v) => v.includes('Moved “Travel adapter” to Documents'));
  await waitFor(async () => (await page.getByRole('button', { name: 'Travel adapter. Edit task' }).count()) === 0);
  check(true, 'Move to another section');

  await page.getByRole('button', { name: 'Phone charger. Edit task' }).click();
  await byId(page, 'task-editor').waitFor();
  await byId(page, 'task-inventory-source').waitFor();
  await byId(page, 'task-quantity-plus').click();
  check((await text(page, 'task-quantity-value')) === '2', 'the editor changes the quantity');
  await byId(page, 'task-save').click();
  await sectionScreen.waitFor();
  await waitFor(async () => (await text(page, 'task-qty-Phone charger-value')) === '2');
  check(true, 'the new quantity shows on the row');
  await page.getByRole('button', { name: 'Power bank. Edit task' }).click();
  await byId(page, 'task-editor').waitFor();
  await byId(page, 'task-inventory-search').fill('Merino');
  await byId(page, 'task-inventory-option-Merino T-shirt').click();
  await byId(page, 'task-inventory-source').waitFor();
  await byId(page, 'task-save').click();
  await sectionScreen.waitFor();
  await within(page, 'section-screen-custom', 'From Inventory · ×1').first().waitFor();
  check((await byId(page, 'task-qty-Power bank-value').count()) === 1, 'a task can be linked to an Inventory item in the editor');
  await page.getByRole('button', { name: 'Power bank. Edit task' }).click();
  await byId(page, 'task-inventory-unlink').click();
  await byId(page, 'task-save').click();
  await sectionScreen.waitFor();
  await waitFor(async () => (await byId(page, 'task-qty-Power bank-value').count()) === 0);
  check(true, 'and unlinked again (the Inventory item is untouched)');

  const before3 = dialogs.length;
  await byId(page, 'task-menu-Power bank').click();
  await byId(page, 'sheet-action-delete').click();
  await waitFor(async () => (await page.getByRole('button', { name: 'Power bank. Edit task' }).count()) === 0);
  check(dialogs.length > before3 && /Remove this task from the trip/.test(dialogs.at(-1) ?? ''), 'removing a task asks first');

  setStep('Inventory picker: browse by category, no duplicates');
  await byId(page, 'section-add-from-inventory').click();
  await byId(page, 'section-inventory').waitFor();
  await byId(page, 'section-inventory-category-Clothing').click();
  await byId(page, 'section-inventory-item-Merino T-shirt').waitFor();
  check((await byId(page, 'section-inventory-item-Phone charger').count()) === 0, 'browsing Clothing shows only Clothing items');
  await byId(page, 'section-inventory-category-all').click();
  check(await byId(page, 'section-inventory-item-Phone charger').isDisabled(), 'an item already in the section cannot be picked again');
  await byId(page, 'section-inventory-category-Clothing').click();
  await byId(page, 'section-inventory-item-Merino T-shirt').click();
  await byId(page, 'section-inventory-add').click();
  await waitText(page, 'section-message', (v) => v.includes('1 added from Inventory'));
  check(true, 'the chosen item is added, linked to Inventory');

  setStep('Success notifications: dismiss after 3 s or on close; data stays');
  await page.goto(`${BASE}/checklists`);
  await byId(page, `checklist-trip-toggle-${tripAId}`).waitFor({ timeout: 60_000 });
  await byId(page, `checklist-trip-toggle-${tripAId}`).click();
  await panel.waitFor();
  const addSection = async (name) => {
    await byId(page, 'section-add-open').click();
    await byId(page, 'section-form-name').fill(name);
    await byId(page, 'section-form-save').click();
  };
  await addSection('Snacks');
  await waitText(page, 'sections-message', (v) => v.includes('Snacks'));
  await byId(page, 'sections-message-dismiss').click();
  await waitFor(async () => (await byId(page, 'sections-message').count()) === 0);
  check((await byId(page, 'section-card-snacks').count()) === 1, 'closing the message keeps the new section');
  await addSection('Maps');
  await waitText(page, 'sections-message', (v) => v.includes('Maps'));
  const shownAt = Date.now();
  await waitFor(async () => (await byId(page, 'sections-message').count()) === 0, 8000);
  const shownFor = Date.now() - shownAt;
  check(shownFor > 2000 && shownFor < 5000, `the message dismisses itself after about 3 s (${shownFor} ms)`);
  check((await byId(page, 'section-card-maps').count()) === 1, 'and the section stays');
  await addSection('Tolls');
  await waitText(page, 'sections-message', (v) => v.includes('Tolls'));
  await addSection('Fuel');
  await waitText(page, 'sections-message', (v) => v.includes('Fuel'));
  check((await byId(page, 'sections-message').count()) === 1 && !(await text(page, 'sections-message')).includes('Tolls'), 'a second operation replaces the first message (never two)');
  await page.waitForTimeout(3600);
  check((await byId(page, 'sections-message').count()) === 0, 'and its own timer still hides it');
  await addSection('fuel');
  await byId(page, 'section-form-error').waitFor();
  check((await byId(page, 'sections-message').count()) === 0, 'a failed operation shows an error, not a success message');
  await byId(page, 'section-form').getByRole('button', { name: 'Cancel' }).click();
  await addSection('Ferry');
  await waitText(page, 'sections-message', (v) => v.includes('Ferry'));
  await byId(page, `checklist-trip-toggle-${tripAId}`).click();
  await byId(page, `checklist-trip-toggle-${tripAId}`).click();
  await panel.waitFor();
  check((await byId(page, 'sections-message').count()) === 0 && (await byId(page, 'section-card-ferry').count()) === 1, 'reopening the trip card shows no old message; the section is there');
  for (const name of ['Snacks', 'Maps', 'Tolls', 'Fuel', 'Ferry']) {
    await byId(page, `section-menu-${name}`).click();
    await byId(page, 'sheet-action-delete').click();
    await waitFor(async () => (await byId(page, `section-card-${name.toLowerCase()}`).count()) === 0);
  }

  setStep('Documents: groups, add here, fold, counts, move, safe delete');
  await byId(page, 'section-card-documents').click();
  await byId(page, 'section-screen-documents').waitFor();
  await byId(page, 'section-add-group').click();
  for (const g of ['Identity documents', 'Tickets and bookings']) {
    await byId(page, 'section-group-input').fill(g);
    await byId(page, 'section-group-add').click();
    await byId(page, `section-group-block-${g}`).waitFor();
  }
  await byId(page, 'section-group-up-Tickets and bookings').click();
  const blocks = async () => page.evaluate(() => [...document.querySelectorAll('[data-testid^="section-group-block-"]')].map((e) => e.getAttribute('data-testid').slice('section-group-block-'.length)));
  await waitFor(async () => (await blocks())[0] === 'Tickets and bookings');
  check(true, 'Move up reorders the groups');
  await byId(page, 'section-group-addhere-Identity documents').click();
  await byId(page, 'add-item-input').fill('Passport copy');
  await byId(page, 'add-item-button').click();
  await waitFor(async () => /Passport copy/.test(await text(page, 'section-group-block-Identity documents')));
  check(true, '“+” on a group adds the next task there');
  check((await text(page, 'section-group-count-Identity documents')) === '0/1', 'the group shows its count');
  await byId(page, 'section-group-toggle-Identity documents').click();
  await waitFor(async () => !/Passport copy/.test(await text(page, 'section-group-block-Identity documents')));
  await byId(page, 'section-group-toggle-Identity documents').click();
  await waitFor(async () => /Passport copy/.test(await text(page, 'section-group-block-Identity documents')));
  check(true, 'a group folds and unfolds');
  await byId(page, 'task-menu-Passport copy').click();
  await byId(page, 'sheet-action-group').click();
  await byId(page, 'task-move-sheet').getByText('Tickets and bookings', { exact: true }).click();
  await waitFor(async () => /Passport copy/.test(await text(page, 'section-group-block-Tickets and bookings')));
  check(true, 'a task moves between groups from its menu');
  await byId(page, 'section-group-delete-Tickets and bookings').click();
  await byId(page, 'section-group-delete-sheet').waitFor();
  check(/It has 1 task/.test(await text(page, 'section-group-delete-sheet')), 'deleting a group with tasks says how many and asks where they go');
  await byId(page, 'sheet-action-none').click();
  await waitFor(async () => (await byId(page, 'section-group-block-Tickets and bookings').count()) === 0);
  check(/Passport copy/.test(await text(page, 'section-screen-documents')), 'its task is kept, ungrouped');
  const before4 = dialogs.length;
  await byId(page, 'section-group-delete-Identity documents').click();
  await waitFor(async () => (await byId(page, 'section-group-block-Identity documents').count()) === 0);
  check(dialogs.length > before4 && /Delete the empty group/.test(dialogs.at(-1) ?? ''), 'an empty group is deleted after a confirmation');

  setStep('Documents Arrange with touch input (drag handle and arrows)');
  if ((await byId(page, 'section-group-input').count()) === 0) await byId(page, 'section-add-group').click();
  await byId(page, 'section-group-input').fill('Visas');
  await byId(page, 'section-group-add').click();
  await byId(page, 'section-group-block-Visas').waitFor();
  await byId(page, 'toggle-reorder').click();
  await byId(page, 'section-arrange').waitFor();
  const arrangedDocs = async () => page.evaluate(() => [...document.querySelectorAll('[data-testid^="arrange-group-"], [data-testid^="arrange-task-"]')].map((e) => e.getAttribute('data-testid').replace(/^arrange-(group|task)-/, '')));
  await touchDragElement(page, byId(page, 'arrange-task-Passport copy').locator('[data-testid^="drag-"]'), byId(page, 'arrange-group-Visas'), 'inside');
  await waitFor(async () => { const o = await arrangedDocs(); return o.indexOf('Passport copy') === o.indexOf('Visas') + 1; });
  check(true, 'a touch drag on the handle moves a task into a group');
  const loose = (await arrangedDocs()).filter((n) => n !== 'Visas' && n !== 'Passport copy');
  if (loose.length >= 2) {
    await touchTap(page, page.getByRole('button', { name: `Move ${loose[0]} down` }).or(byId(page, `arrange-down-${loose[0]}`)).first());
    await waitFor(async () => { const o = await arrangedDocs(); return o.indexOf(loose[0]) > o.indexOf(loose[1]); });
    check(true, 'tapping Move down reorders tasks');
  }
  await byId(page, 'toggle-reorder').click();
  await waitFor(async () => /Passport copy/.test(await text(page, 'section-group-block-Visas')));
  check(true, 'the touch arrangement is saved');

  setStep('Dashboard 2.0: overview only, six shortcuts, weather folded');
  await page.goto(tripA);
  await byId(page, 'trip-dashboard').waitFor();
  check((await byId(page, 'trip-hero').count()) === 1 && (await byId(page, 'trip-cover-error').count()) === 0, 'compact header without a photo-error panel');
  await byId(page, 'trip-hero-fallback').waitFor();
  check(/days/.test(await text(page, 'trip-hero-dates')), 'header shows dates and length');
  check((await page.locator('[data-testid="trip-dashboard"] [data-testid^="section-card-"]').count()) === 0, 'no checklist sections on the dashboard');
  check((await byId(page, 'trip-quick-links').locator('[role="link"]').count()) === 6, 'exactly six shortcuts');
  const weather = byId(page, 'trip-weather-section-toggle');
  check((await weather.getAttribute('aria-expanded')) === 'false', 'weather starts folded');
  await weather.click();
  await page.waitForFunction(() => document.querySelector('[data-testid="trip-weather-section-toggle"]')?.getAttribute('aria-expanded') === 'true');
  await weather.click();
  await page.waitForFunction(() => document.querySelector('[data-testid="trip-weather-section-toggle"]')?.getAttribute('aria-expanded') === 'false');
  check(true, 'weather expands inline and folds again');
  for (const [id, screen] of [
    ['trip-calculator', 'calc-quick'],
    ['trip-clothing', 'packing-category-screen'],
    ['journal-open', 'journal-screen'],
    ['trip-memories', 'memories-screen'],
    ['trip-group', 'group-trip-screen'],
    ['trip-mine', 'my-trip-screen'],
  ]) {
    await page.goto(tripA);
    await byId(page, id).click();
    await byId(page, screen).waitFor({ timeout: 30_000 });
    check(page.url().includes(tripAId), `${id} opens this trip’s ${screen}`);
  }
  await page.goto(tripA);
  await byId(page, 'journey-button').click();
  await page.waitForURL(/\/plan/);
  check(page.url().includes(tripAId) && page.url().includes('navigation'), 'Start journey opens the journey view; nothing navigates by itself');
  await page.goto(tripA);
  await byId(page, 'open-checklist').click();
  await byId(page, `checklist-trip-sections-${tripAId}`).waitFor();
  check(true, 'Open preparation checklist opens this trip on the Checklist tab');

  setStep('offline: packing keeps working');
  await page.goto(`${tripB}/packing`);
  await byId(page, 'items-tab').waitFor();
  // The web export loads each screen's code on first visit (native builds bundle everything),
  // so open the screens once while online, then cut the network.
  await categoryRow(page, 'Toiletries').click();
  await byId(page, 'packing-category-screen').waitFor();
  await byId(page, 'category-add-item').click();
  await byId(page, 'packing-add').waitFor();
  await page.goBack();
  await byId(page, 'packing-category-screen').waitFor();
  await context.setOffline(true);
  await byId(page, 'quick-suggested-Toothbrush').click();
  await within(page, 'packing-category-screen', 'Toothbrush').waitFor();
  await page.getByRole('checkbox', { name: 'Toothbrush packed' }).click();
  await waitText(page, 'category-progress', (v) => v.includes('1 of 1 packed'));
  await byId(page, 'category-add-item').click();
  await byId(page, 'packing-add').waitFor();
  await byId(page, 'packing-add-search').fill('Travel pillow');
  await byId(page, 'packing-create').click();
  await byId(page, 'packing-add-confirm').click();
  await byId(page, 'packing-category-screen').waitFor();
  await waitText(page, 'category-progress', (v) => v.includes('1 of 2 packed'));
  check(true, 'add, pack and create work with no network');
  await context.setOffline(false);

  check(errors.length === 0, `no uncaught page errors (${errors.join('; ') || 'none'})`);
});
