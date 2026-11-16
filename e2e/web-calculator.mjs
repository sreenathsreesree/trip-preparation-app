// Trip Calculator: Home entry and trip selection (active trip highlighted),
// people, group expenses with equal / percentage / shares / exact splits,
// personal expenses that never touch balances, separate currencies, simplified
// debts and settlements, custom categories, budget with daily-limit warnings,
// fuel / per-person / road-trip calculators, offline use and restart
// persistence — at a 360 px phone width.
//
//   npx expo export --platform web --output-dir dist && npm run e2e:calculator

import { BASE, byId, check, iso, launch, run, setStep, shot, text, waitText } from './harness.mjs';

const now = new Date();
const later = (months, d) => new Date(now.getFullYear(), now.getMonth() + months, d);

async function createTrip(page, name, months) {
  await page.goto(`${BASE}/trips/new`);
  await byId(page, 'trip-name-input').waitFor({ timeout: 60_000 });
  await byId(page, 'trip-name-input').fill(name);
  await byId(page, 'category-mountains').click();
  await byId(page, 'wizard-next').click();
  for (let i = 0; i < months; i++) await byId(page, 'trip-calendar-next-month').click();
  await byId(page, `calendar-day-${iso(later(months, 10))}`).click();
  await byId(page, `calendar-day-${iso(later(months, 14))}`).click();
  await byId(page, 'wizard-next').click();
  await byId(page, 'transport-car').click();
  await byId(page, 'wizard-create').click();
  await byId(page, 'trip-dashboard').waitFor();
  return page.url().split('?')[0].split('/').pop();
}

async function addExpense(page, { title, amount, currency, payer, method, inputs, exclude = [], personal = false, category }) {
  await byId(page, 'calc-add').click();
  await byId(page, 'calc-editor').waitFor();
  if (personal) await byId(page, 'calc-editor').getByText('Personal', { exact: true }).first().click();
  await byId(page, 'calc-title').fill(title);
  await byId(page, 'calc-amount').fill(amount);
  if (currency) await byId(page, 'calc-currency-input').fill(currency);
  if (category) await byId(page, `calc-cat-${category}`).click();
  if (!personal) {
    if (payer) await byId(page, `calc-payer-${payer}`).click();
    for (const name of exclude) await byId(page, `calc-include-${name}`).click();
    if (method) await byId(page, `calc-method-${method}`).click();
    for (const [name, value] of Object.entries(inputs ?? {})) await byId(page, `calc-input-${name}`).fill(value);
  }
  await byId(page, 'calc-save').click();
  await byId(page, 'calc-workspace').waitFor();
  await byId(page, `calc-expense-${title}`).waitFor();
}

await run('Trip calculator test', async () => {
  let { context, page, errors, dialogs } = await launch();

  setStep('trips and the Home entry point');
  const goa = await createTrip(page, 'Goa Later', 3);
  const kerala = await createTrip(page, 'Kerala Soon', 1);
  await page.goto(BASE);
  await byId(page, 'home-calculator').click();
  await byId(page, 'calc-home').waitFor();
  const order = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="calc-trip-"]')].map((e) => e.getAttribute('data-testid')));
  check(order[0] === 'calc-trip-Kerala Soon' && order.includes('calc-trip-Goa Later'), 'the next trip is listed first');
  check((await text(page, 'calc-trip-Kerala Soon')).includes('Active trip'), 'the active trip is highlighted');
  await shot(page, 'calc-01-trips');
  await byId(page, 'calc-trip-Kerala Soon').click();
  await byId(page, 'calc-workspace').waitFor();
  check(page.url().includes(kerala) && !page.url().includes(goa), 'opens that trip’s own workspace');

  setStep('people');
  await byId(page, 'calc-panel-expenses').waitFor();
  await byId(page, 'calc-tab-balances').click();
  await byId(page, 'calc-people').waitFor();
  for (const name of ['Ben', 'Cy']) {
    await byId(page, 'calc-person-name').fill(name);
    await byId(page, 'calc-person-add').click();
    await byId(page, `calc-person-${name}`).waitFor();
  }
  check((await text(page, 'calc-people')).includes('Me (me)'), 'the trip’s traveller is “me”');
  await byId(page, 'calc-tab-expenses').click();

  setStep('group expense split equally, with a live preview');
  await byId(page, 'calc-add').click();
  await byId(page, 'calc-editor').waitFor();
  await byId(page, 'calc-title').fill('Houseboat');
  await byId(page, 'calc-amount').fill('9000');
  await waitText(page, 'calc-share-Ben', (v) => v.includes('3,000.00'));
  check(true, 'shows each person’s share before saving');
  await byId(page, 'calc-amount').fill('12.345');
  await byId(page, 'calc-save').click();
  await byId(page, 'calc-error').waitFor();
  check((await text(page, 'calc-error')).includes('at most 2 decimal'), 'refuses amounts with too many decimals');
  await byId(page, 'calc-amount').fill('9000');
  await byId(page, 'calc-cat-Stay').click();
  await byId(page, 'calc-save').click();
  await byId(page, 'calc-expense-Houseboat').waitFor();

  setStep('percentage split with validation');
  await byId(page, 'calc-add').click();
  await byId(page, 'calc-editor').waitFor();
  await byId(page, 'calc-title').fill('Dinner');
  await byId(page, 'calc-amount').fill('1000');
  await byId(page, 'calc-payer-Ben').click();
  await byId(page, 'calc-method-percent').click();
  await byId(page, 'calc-input-Me').fill('50');
  await byId(page, 'calc-input-Ben').fill('25');
  await byId(page, 'calc-input-Cy').fill('20');
  await waitText(page, 'calc-split-error', (v) => v.includes('95%, not 100%'));
  check(true, 'explains percentages that do not add up');
  await byId(page, 'calc-input-Cy').fill('25');
  await waitText(page, 'calc-share-Me', (v) => v.includes('500.00'));
  await byId(page, 'calc-save').click();
  await byId(page, 'calc-expense-Dinner').waitFor();

  setStep('shares, custom category, personal and another currency');
  await addExpense(page, { title: 'Snacks', amount: '300', payer: 'Cy', method: 'shares', inputs: { Me: '2', Ben: '1', Cy: '0' } });
  await byId(page, 'calc-add').click();
  await byId(page, 'calc-editor').waitFor();
  await byId(page, 'calc-cat-new').fill('Souvenirs');
  await byId(page, 'calc-cat-add').click();
  await byId(page, 'calc-cat-Souvenirs').waitFor();
  await byId(page, 'calc-editor').getByText('Personal', { exact: true }).first().click();
  await waitText(page, 'calc-scope-help', (v) => v.includes('never part of anyone’s balance'));
  await byId(page, 'calc-title').fill('Spice box');
  await byId(page, 'calc-amount').fill('750');
  await byId(page, 'calc-save').click();
  await byId(page, 'calc-expense-Spice box').waitFor();
  check((await text(page, 'calc-expense-Spice box')).includes('Private') && (await text(page, 'calc-expense-Spice box')).includes('Souvenirs'), 'personal expense is private, with its custom category');
  await addExpense(page, { title: 'Visa fee', amount: '50', currency: 'USD', payer: 'Ben', method: 'exact', inputs: { Me: '25', Ben: '0', Cy: '25' } });
  const totals = await text(page, 'calc-expenses');
  check(totals.includes('USD') && totals.includes('INR'), 'totals are kept per currency');
  check((await text(page, 'calc-total-INR')).includes('10,300.00'), 'group spending excludes personal expenses');
  await shot(page, 'calc-02-expenses');

  setStep('balances and simplified debts, per currency');
  await byId(page, 'calc-tab-balances').click();
  await byId(page, 'calc-balances').waitFor();
  // INR: Me paid 9000, owes 3000+500+200 = 3700 → +5300. Ben: paid 1000, owes 3000+250+100 = 3350 → −2350. Cy: paid 300, owes 3000+250 → −2950.
  check((await text(page, 'calc-debt-Cy-Me')).includes('2,950.00') && (await text(page, 'calc-debt-Ben-Me')).includes('2,350.00'), 'INR debts settle everyone in two payments');
  check((await text(page, 'calc-balance-USD')).includes('Me pays Ben') && (await text(page, 'calc-balance-USD')).includes('Cy pays Ben'), 'USD is settled separately');
  check(!(await text(page, 'calc-balances')).includes('750'), 'personal expenses are not in balances');
  await shot(page, 'calc-03-balances');

  setStep('record a settlement');
  await byId(page, 'calc-settle-Ben-Me').click();
  await byId(page, 'calc-settle').waitFor();
  check((await byId(page, 'calc-settle-amount').inputValue()) === '2350.00', 'payment form is prefilled from the debt');
  await byId(page, 'calc-settle-save').click();
  await byId(page, 'calc-balances').waitFor();
  await byId(page, 'calc-settlement-Ben-Me').waitFor();
  check((await byId(page, 'calc-debt-Ben-Me').count()) === 0, 'the settled debt is gone');
  check((await text(page, 'calc-debt-Cy-Me')).includes('2,950.00'), 'other debts are unchanged');

  setStep('budget, planned vs actual, daily limit warnings');
  await byId(page, 'calc-tab-budget').click();
  await byId(page, 'calc-budget').waitFor();
  await byId(page, 'calc-budget-edit').click();
  await byId(page, 'calc-budget-total').fill('12000');
  await byId(page, 'calc-budget-daily').fill('5000');
  await byId(page, 'calc-budget-line-stay').fill('8000');
  await byId(page, 'calc-budget-save').click();
  await byId(page, 'calc-budget-summary-INR').waitFor();
  await byId(page, 'calc-budget-warning').waitFor();
  check((await text(page, 'calc-budget-warning')).includes('Close to the budget'), 'warns near the total budget');
  check((await text(page, 'calc-budget-cat-stay')).includes('9,000.00') && (await text(page, 'calc-budget-cat-stay')).includes('8,000.00'), 'shows planned vs actual per category');
  check((await text(page, 'calc-budget-today')).includes('10,300.00'), 'today’s spending against the daily limit');
  await byId(page, 'calc-budget').getByText('My spending', { exact: true }).first().click();
  await waitText(page, 'calc-budget-total-bar', (v) => v.includes('4,450.00'));
  check(true, 'my spending = my shares (3,700) + personal (750)');
  await byId(page, 'calc-tab-expenses').click();
  await byId(page, 'calc-daily-warning-INR').waitFor();
  check((await text(page, 'calc-daily-warning-INR')).includes('Over today’s INR limit'), 'expenses screen warns about the daily limit');
  await shot(page, 'calc-04-budget');

  setStep('calculators');
  await byId(page, 'calc-tab-tools').click();
  await byId(page, 'calc-tools').waitFor();
  await byId(page, 'calc-fuel-distance').fill('300');
  await byId(page, 'calc-fuel-efficiency').fill('15');
  await byId(page, 'calc-fuel-price').fill('102.50');
  await waitText(page, 'calc-fuel-result', (v) => v.includes('20 L') && v.includes('2,050.00'));
  await byId(page, 'calc-fuel-round').click();
  await waitText(page, 'calc-fuel-result', (v) => v.includes('600 km') && v.includes('40 L') && v.includes('4,100.00'));
  await byId(page, 'calc-fuel-round').click();
  await waitText(page, 'calc-fuel-result', (v) => v.includes('2,050.00'));
  check(true, 'fuel: litres and cost, with a round-trip option');
  await byId(page, 'calc-tool-stay-toggle').click();
  await byId(page, 'calc-stay-cost').fill('2500');
  await byId(page, 'calc-stay-rooms').fill('2');
  await byId(page, 'calc-stay-nights').fill('3');
  await waitText(page, 'calc-stay-result', (v) => v.includes('15,000.00'));
  await byId(page, 'calc-tool-food-toggle').click();
  await byId(page, 'calc-food-daily').fill('800');
  await byId(page, 'calc-food-people').fill('3');
  await byId(page, 'calc-food-days').fill('5');
  await waitText(page, 'calc-food-result', (v) => v.includes('12,000.00'));
  check(true, 'accommodation and food estimates');
  await byId(page, 'calc-tool-estimate-toggle').click();
  await byId(page, 'calc-est-fill').click();
  await byId(page, 'calc-est-tolls').fill('350');
  await waitText(page, 'calc-est-result', (v) => v.includes('29,400.00'));
  check(true, 'total estimate combines the calculators (2,050 + 15,000 + 12,000 + 350)');
  await byId(page, 'calc-tool-split-toggle').click();
  await byId(page, 'calc-pp-total').fill('1000');
  await waitText(page, 'calc-pp-share-Me', (v) => v.includes('333.34'));
  await byId(page, 'calc-pp-method-percent').click();
  await byId(page, 'calc-pp-input-Me').fill('50');
  await byId(page, 'calc-pp-input-Ben').fill('30');
  await byId(page, 'calc-pp-input-Cy').fill('20');
  await waitText(page, 'calc-pp-share-Ben', (v) => v.includes('300.00'));
  check(true, 'per-person splitter uses the existing split methods');
  await byId(page, 'calc-tool-distance-toggle').click();
  await byId(page, 'calc-dist-none').waitFor();
  check(true, 'distance and time are not invented without located destinations');
  await byId(page, 'calc-fuel-add').click();
  await byId(page, 'calc-editor').waitFor();
  check((await byId(page, 'calc-title').inputValue()) === 'Fuel' && (await byId(page, 'calc-amount').inputValue()) === '2050.00', 'fuel cost becomes a prefilled expense');
  await byId(page, 'calc-save').click();
  await byId(page, 'calc-tools').waitFor();
  await byId(page, 'calc-tab-expenses').click();
  await byId(page, 'calc-expense-Fuel').waitFor();
  check((await byId(page, 'calc-expense-Accommodation').count()) === 0 && !(await text(page, 'calc-expenses')).includes('29,400'), 'estimates are never saved as expenses');

  setStep('quick calculator from the trip dashboard');
  await page.goto(`${BASE}/trips/${kerala}`);
  await byId(page, 'trip-calculator').click();
  await byId(page, 'calc-quick').waitFor();
  await context.setOffline(true);
  for (const key of ['1', '2', 'Plus', '3', '0', 'Multiply', '2', 'Equals']) await byId(page, `calc-key-${key}`).click();
  await waitText(page, 'calc-quick-display', (v) => v.trim() === '72');
  check(true, 'operator precedence: 12 + 30 × 2 = 72 (offline)');
  await byId(page, 'calc-history-72').waitFor();
  check((await text(page, 'calc-history')).includes('12 + 30 × 2'), 'the calculation is in this trip’s history');
  await byId(page, 'calc-key-Clear').click();
  await byId(page, 'calc-history-72').click();
  await byId(page, 'calc-key-Divide').click();
  await byId(page, 'calc-key-4').click();
  await byId(page, 'calc-key-Equals').click();
  await waitText(page, 'calc-quick-display', (v) => v.trim() === '18');
  check(true, 'reuses a previous result');
  await context.setOffline(false);
  await byId(page, 'calc-tab-expenses').click();
  check((await byId(page, 'calc-expense-Lunch').count()) === 0, 'a calculation is not an expense');
  await byId(page, 'calc-tab-calculator').click();
  await byId(page, 'calc-history-72').click();
  await byId(page, 'calc-key-Equals').click();
  await byId(page, 'calc-quick-add').click();
  await byId(page, 'calc-editor').waitFor();
  check((await byId(page, 'calc-amount').inputValue()) === '72.00', 'the result fills the expense amount');
  check((await text(page, 'calc-location')).includes('Entire trip'), 'location is optional (entire trip)');
  await byId(page, 'calc-editor').getByText('Personal', { exact: true }).first().click();
  await byId(page, 'calc-title').fill('Lunch');
  await byId(page, 'calc-save').click();
  await byId(page, 'calc-quick').waitFor();
  await byId(page, 'calc-tab-expenses').click();
  await byId(page, 'calc-expense-Lunch').waitFor();
  await shot(page, 'calc-05-quick');

  setStep('financial overview');
  await byId(page, 'calc-tab-overview').click();
  await byId(page, 'calc-overview').waitFor();
  // Group INR 9,000 + 1,000 + 300 + 2,050 = 12,350; personal 750 + 72 = 822.
  check((await text(page, 'calc-ov-actual')).includes('13,172.00'), 'actual spending counts every expense once');
  check((await text(page, 'calc-ov-planned')).includes('12,000.00'), 'planned budget is shown separately');
  check((await text(page, 'calc-ov-unassigned')).includes('13,172.00'), 'expenses without a location are listed under the entire trip');
  check((await text(page, 'calc-ov-personal')).includes('822.00') && (await text(page, 'calc-ov-group')).includes('12,350.00'), 'group and personal are separated');
  await shot(page, 'calc-06-overview');

  await byId(page, 'calc-tab-expenses').click();
  await byId(page, 'calc-panel-expenses').waitFor();

  setStep('offline, edit and delete');
  await context.setOffline(true);
  await addExpense(page, { title: 'Chai offline', amount: '60' });
  check(true, 'adds expenses offline');
  await context.setOffline(false);
  await byId(page, 'calc-expense-Chai offline').click();
  await byId(page, 'calc-delete').click();
  await byId(page, 'calc-workspace').waitFor();
  await page.waitForTimeout(300);
  check((await byId(page, 'calc-expense-Chai offline').count()) === 0 && dialogs.some((d) => d.includes('Delete this expense?')), 'deletes after confirming');
  check(errors.length === 0, `no uncaught page errors (${errors.join(' | ') || 'none'})`);
  await context.close();

  setStep('restart: everything persisted');
  ({ context, page, errors } = await launch());
  await page.goto(`${BASE}/calculator/${kerala}?tab=balances`);
  await byId(page, 'calc-balances').waitFor({ timeout: 60_000 });
  await byId(page, 'calc-settlement-Ben-Me').waitFor();
  // 2,950.00 + a third of the 2,050.00 fuel expense (683.33).
  check((await text(page, 'calc-debt-Cy-Me')).includes('3,633.33'), 'balances persisted');
  await page.goto(`${BASE}/calculator/${goa}`);
  await byId(page, 'calc-no-expenses').waitFor();
  check(true, 'each trip has its own workspace');
  await page.goto(`${BASE}/calculator/${kerala}?tab=calculator`);
  await byId(page, 'calc-history-72').waitFor({ timeout: 60_000 });
  check(true, 'calculation history persisted');
  await page.goto(`${BASE}/calculator/${goa}?tab=calculator`);
  await byId(page, 'calc-history-empty').waitFor({ timeout: 60_000 });
  check(true, 'another trip has its own (empty) history');
  check(errors.length === 0, `no uncaught page errors after restart (${errors.join(' | ') || 'none'})`);
});
