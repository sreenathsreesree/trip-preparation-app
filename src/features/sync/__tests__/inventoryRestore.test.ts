import { fakeSyncServer } from '../../../../test/fakeSyncServer';
import { itemInput, setupRepositories } from '../../../../test/fixtures';
import { openTestDatabase } from '../../../../test/nodeSqliteDatabase';
import { linkAccount, runSync } from '../syncEngine';

const ASHA = 'asha-0000-4000-8000-000000000001';
const device = (name: string) => setupRepositories(openTestDatabase(), '2026-11-15T08:00:00.000Z', name);
type Device = Awaited<ReturnType<typeof device>>;
const sync = (d: Device, server: ReturnType<typeof fakeSyncServer>) => runSync(d.database, server.apiFor(ASHA), { accountId: ASHA, createId: d.deps.createId, now: d.deps.now });

it('restores the whole inventory on a fresh install', async () => {
  const server = fakeSyncServer();
  const phone = await device('p');
  const cats = await phone.inventory.listCategories();
  const footwear = cats.find((c) => /foot/i.test(c.name))!;
  await phone.inventory.createItem(itemInput({ name: 'Trail shoes', categoryId: footwear.id, quantity: 2 }));
  const custom = await phone.inventory.createCategory({ name: 'Camera gear', icon: footwear.icon, color: footwear.color, parentId: null, coverImageUri: null });
  await phone.inventory.createItem(itemInput({ name: 'GoPro', categoryId: custom.id }));
  await linkAccount(phone.database, ASHA);
  await sync(phone, server);

  const fresh = await device('f');
  await linkAccount(fresh.database, ASHA);
  const result = await sync(fresh, server);
  const items = await fresh.inventory.listItems();
  expect({ downloaded: result.downloaded > 0, items: items.map((i) => [i.name, i.categoryId === undefined ? null : (cats.find((c) => c.id === i.categoryId)?.name ?? (i.categoryId === custom.id ? 'Camera gear' : i.categoryId))]).sort() }).toEqual({
    downloaded: true,
    items: [['GoPro', 'Camera gear'], ['Trail shoes', footwear.name]],
  });
  expect((await fresh.inventory.listCategories()).filter((c) => c.name === footwear.name)).toHaveLength(1);
});

it('explains “Choose a valid category”: starter categories take the cloud’s ids on first sync, so ids loaded before it go stale', async () => {
  const server = fakeSyncServer();
  const first = await device('p1');
  await linkAccount(first.database, ASHA);
  await sync(first, server); // the account's starter categories now have p1's ids

  const second = await device('p2');
  const before = (await second.inventory.listCategories()).find((c) => c.systemKey === 'footwear')!;
  await linkAccount(second.database, ASHA);
  await sync(second, server);
  const after = (await second.inventory.listCategories()).find((c) => c.systemKey === 'footwear')!;
  expect(after.id).not.toBe(before.id);
  // An id held from before the sync is rejected (what the stale screen did) …
  await expect(second.inventory.createItem(itemInput({ name: 'Sandals', categoryId: before.id }))).rejects.toThrow('Choose a valid category.');
  // … and the reloaded id saves, survives a reopen and a restore elsewhere.
  const saved = await second.inventory.createItem(itemInput({ name: 'Sandals', categoryId: after.id }));
  expect((await second.inventory.getItem(saved.id))?.categoryId).toBe(after.id);
  expect((await second.inventory.listCategories()).filter((c) => c.systemKey === 'footwear')).toHaveLength(1);
  await sync(second, server);
  const third = await device('p3');
  await linkAccount(third.database, ASHA);
  await sync(third, server);
  const restored = (await third.inventory.listItems()).find((i) => i.name === 'Sandals')!;
  expect(restored.categoryId).toBe(after.id);
});

it('restores items without a category and custom subcategories', async () => {
  const server = fakeSyncServer();
  const phone = await device('q');
  const footwear = (await phone.inventory.listCategories()).find((c) => c.systemKey === 'footwear')!;
  const sub = await phone.inventory.createCategory({ name: 'Hiking boots', icon: footwear.icon, color: footwear.color, parentId: footwear.id, coverImageUri: null });
  await phone.inventory.createItem(itemInput({ name: 'Boots', categoryId: footwear.id, subcategoryId: sub.id }));
  await phone.inventory.createItem(itemInput({ name: 'Loose item', categoryId: null }));
  await linkAccount(phone.database, ASHA);
  await sync(phone, server);
  const fresh = await device('r');
  await linkAccount(fresh.database, ASHA);
  await sync(fresh, server);
  const items = await fresh.inventory.listItems();
  expect(items.map((i) => [i.name, i.categoryId, i.subcategoryId]).sort()).toEqual([
    ['Boots', footwear.id, sub.id],
    ['Loose item', null, null],
  ]);
});
