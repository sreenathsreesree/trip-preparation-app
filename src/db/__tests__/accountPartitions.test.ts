/**
 * Account isolation: every account (and the guest) has its own local
 * database. These tests drive the real client module against in-memory
 * SQLite files keyed by name, as expo-sqlite keys them on the phone.
 */
import { fakeSyncServer } from '../../../test/fakeSyncServer';
import { tripInput } from '../../../test/fixtures';
import { openTestDatabase, sequentialIds, type TestDatabase } from '../../../test/nodeSqliteDatabase';
import { linkAccount, linkedAccount, runSync, SyncAccountError } from '../../features/sync/syncEngine';
import { createPhotoUploadRepository } from '../../features/journal/drive/photoUploadRepository';
import { createGalleryRepository } from '../../features/journal/galleryRepository';
import { createJournalRepository } from '../../features/journal/journalRepository';
import { createTripRepository } from '../../features/trips/tripRepository';
import { migrate } from '../migrate';
import { migrations } from '../migrations';
import { copyDatabase, databaseNameFor, legacyOwner, partitionFor } from '../partitions';
import { serializeTransactions } from '../serialize';
import type { Database } from '../types';

const mockFiles = new Map<string, TestDatabase>();
jest.mock('expo-sqlite', () => ({
  openDatabaseAsync: async (name: string) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { openTestDatabase: open } = require('../../../test/nodeSqliteDatabase') as typeof import('../../../test/nodeSqliteDatabase');
    if (!mockFiles.has(name)) mockFiles.set(name, open());
    return mockFiles.get(name);
  },
}));
jest.mock('react-native', () => ({ Platform: { OS: 'android' } }));

const A = 'aaaaaaaa-0000-4000-8000-000000000001';
const B = 'bbbbbbbb-0000-4000-8000-000000000002';
const deps = () => ({ createId: sequentialIds(`t${Math.random().toString(36).slice(2, 6)}`), now: () => new Date('2026-11-13T08:00:00Z'), today: () => '2026-11-13' });
const tripsIn = (db: Database) => createTripRepository(db, deps());
const names = async (db: Database) => (await tripsIn(db).list()).map((t) => t.name).sort();

type Client = typeof import('../client');
async function freshClient(): Promise<Client> {
  jest.resetModules();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('../client') as Client;
}

/** The single shared database of app versions before partitioning, holding `trip`, optionally backed up to `account`. */
async function legacyPhone(trip: string, account: string | null) {
  const raw = openTestDatabase();
  mockFiles.set('trip-prep.db', raw);
  const db = serializeTransactions(raw);
  await migrate(db, migrations);
  await tripsIn(db).create(tripInput({ name: trip, destinations: [{ name: 'Kochi' }] }), { sections: [] });
  if (account) await linkAccount(db, account);
  return db;
}

beforeEach(() => mockFiles.clear());

describe('account partitions', () => {
  it('Account A → sign out → Account B → Account A: each sees only its own data', async () => {
    await legacyPhone('A’s Kerala trip', A);
    const client = await freshClient();

    client.setActiveAccount(A);
    expect(await names(await client.getDatabase())).toEqual(['A’s Kerala trip']);

    client.setActiveAccount(null); // signed out
    expect(await names(await client.getDatabase())).toEqual([]);

    client.setActiveAccount(B);
    const b = await client.getDatabase();
    expect(await names(b)).toEqual([]);
    await tripsIn(b).create(tripInput({ name: 'B’s Goa trip', destinations: [] }), { sections: [] });

    client.setActiveAccount(A);
    const a = await client.getDatabase();
    expect(await names(a)).toEqual(['A’s Kerala trip']);
    expect(await linkedAccount(a)).toBe(A);

    client.setActiveAccount(B);
    expect(await names(await client.getDatabase())).toEqual(['B’s Goa trip']);
    expect(await linkedAccount(await client.getDatabase())).toBeNull();
  });

  it('keeps every kind of personal record in its own partition', async () => {
    await legacyPhone('A trip', A);
    const client = await freshClient();
    const a = await client.getPartitionDatabase(partitionFor(A));
    const b = await client.getPartitionDatabase(partitionFor(B));
    const tables = (await a.getAllAsync<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'", [])).map((r) => r.name);
    // Every table of A that holds A's trip-owned rows is absent from B.
    const aTrip = (await tripsIn(a).list())[0]!.id;
    for (const t of tables) {
      const cols = (await a.getAllAsync<{ name: string }>(`PRAGMA table_info("${t}")`, [])).map((c) => c.name);
      if (!cols.includes('trip_id')) continue;
      expect([t, (await b.getFirstAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM "${t}" WHERE trip_id = ?`, [aTrip]))?.n]).toEqual([t, 0]);
    }
  });

  it('Account B cannot upload Account A’s records, and A’s database refuses to sync as B', async () => {
    await legacyPhone('A’s Kerala trip', A);
    const client = await freshClient();
    const server = fakeSyncServer();
    const b = await client.getPartitionDatabase(partitionFor(B));
    await linkAccount(b, B);
    await runSync(b, server.apiFor(B), { accountId: B, createId: sequentialIds('s') });
    expect(server.count(B, 'trips')).toBe(0);

    const a = await client.getPartitionDatabase(partitionFor(A));
    await expect(runSync(a, server.apiFor(B), { accountId: B, createId: sequentialIds('s') })).rejects.toBeInstanceOf(SyncAccountError);
    expect(server.count(B, 'trips')).toBe(0);

    await runSync(a, server.apiFor(A), { accountId: A, createId: sequentialIds('s') });
    expect(server.count(A, 'trips')).toBe(1);
    expect(server.count(B, 'trips')).toBe(0);
  });

  it('a phone that was never backed up keeps its data as the guest’s, never an account’s', async () => {
    await legacyPhone('Guest trip', null);
    const client = await freshClient();
    expect(await names(await client.getPartitionDatabase('guest'))).toEqual(['Guest trip']);
    expect(await names(await client.getPartitionDatabase(partitionFor(A)))).toEqual([]);
    client.setActiveAccount(A);
    const a = await client.getDatabase();
    expect(await names(a)).toEqual([]);
    expect(await linkedAccount(a)).toBeNull();
  });

  it('splits the old shared database once, losing nothing and leaving the original untouched', async () => {
    const legacy = await legacyPhone('A’s Kerala trip', A);
    const before = await legacy.getAllAsync<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table'", []);
    const legacyCounts = async () => {
      const out: Record<string, number> = {};
      for (const { name } of before) if (!name.startsWith('sqlite_')) out[name] = (await legacy.getFirstAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM "${name}"`, []))!.n;
      return out;
    };
    const original = await legacyCounts();

    let client = await freshClient();
    const a = await client.getPartitionDatabase(partitionFor(A));
    for (const [t, n] of Object.entries(original)) expect([t, (await a.getFirstAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM "${t}"`, []))!.n]).toEqual([t, n]);
    expect(await legacyCounts()).toEqual(original);

    // Restarting the app does not copy again (no duplicates, later edits kept).
    await tripsIn(a).create(tripInput({ name: 'Added after the split', destinations: [] }), { sections: [] });
    client = await freshClient();
    expect(await names(await client.getPartitionDatabase(partitionFor(A)))).toEqual(['Added after the split', 'A’s Kerala trip']);
    expect(await names(await client.getPartitionDatabase('guest'))).toEqual([]);
  });

  it('a failed copy leaves the target unchanged and is retried on the next launch', async () => {
    const source = serializeTransactions(openTestDatabase());
    await migrate(source, migrations);
    await tripsIn(source).create(tripInput({ name: 'Safe', destinations: [] }), { sections: [] });
    const target = serializeTransactions(openTestDatabase());
    await migrate(target, migrations);
    await target.execAsync('DROP TABLE trip_luggage');
    await expect(copyDatabase(source, target)).rejects.toThrow(/missing tables/);
    expect(await names(source)).toEqual(['Safe']);
  });

  it('Memories photos, Drive references and pending uploads stay with the account that added them', async () => {
    await legacyPhone('A’s trip', A);
    const client = await freshClient();
    const a = await client.getPartitionDatabase(partitionFor(A));
    const tripId = (await tripsIn(a).list())[0]!.id;
    const journal = createJournalRepository(a, deps());
    const entry = await journal.create(tripId, { entryDate: '2026-12-20', title: 'A’s day' });
    await journal.addPhoto(entry.id, 'file:///a/private.jpg');
    const aUploads = createPhotoUploadRepository(a, deps());
    await aUploads.enqueue({ accountId: A, tripId, source: 'journal', sourceId: 'x', localUri: 'file:///a/private.jpg', fileName: 'x.jpg' });
    await journal.saveDriveRecord({ kind: 'folder', localId: 'root', driveFileId: 'A-root-folder', contentHash: '' });

    // Signed out, then signed in as B (offline too: the partition comes from the saved session).
    client.setActiveAccount(null);
    client.setActiveAccount(B);
    const b = await client.getDatabase();
    expect(await createGalleryRepository(b).list()).toEqual([]);
    const bUploads = createPhotoUploadRepository(b, deps());
    // B's database has no queue rows at all, not even A's under A's id.
    expect(await bUploads.due(A, new Date('2030-01-01'))).toEqual([]);
    expect(await bUploads.due(B, new Date('2030-01-01'))).toEqual([]);
    expect(await createJournalRepository(b, deps()).driveRecord('folder', 'root')).toBeNull();

    // Back to A: everything is still there, still pending.
    client.setActiveAccount(A);
    const again = await client.getDatabase();
    expect((await createGalleryRepository(again).list()).map((p) => p.uri)).toEqual(['file:///a/private.jpg']);
    expect((await createPhotoUploadRepository(again, deps()).due(A, new Date('2030-01-01'))).map((r) => r.localUri)).toEqual(['file:///a/private.jpg']);
  });

  it('names one file per account and never reuses the old shared file', () => {
    expect(databaseNameFor('guest')).toBe('trip-prep-guest.db');
    expect(databaseNameFor(partitionFor(A))).toBe(`trip-prep-user-${A}.db`);
    expect(databaseNameFor(partitionFor(A))).not.toBe(databaseNameFor(partitionFor(B)));
    expect(new Set([databaseNameFor('guest'), databaseNameFor(partitionFor(A))]).has('trip-prep.db')).toBe(false);
  });

  it('works out the old database’s owner from its backup link', async () => {
    const db = await legacyPhone('x', B);
    expect(await legacyOwner(db)).toBe(partitionFor(B));
  });
});
