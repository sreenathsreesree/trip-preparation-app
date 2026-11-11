import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import * as WebBrowser from 'expo-web-browser';

import {
  createFakeSupabase,
  createMemorySecureStorage,
  makeSession,
  mockProviderSettings,
} from '../../../../test/fakeSupabase';
import { itemInput, setupRepositories, tripInput } from '../../../../test/fixtures';
import type { TestDatabase } from '../../../../test/nodeSqliteDatabase';
import { buildStarterChecklist } from '../../preparation/starter';
import { resetAuthServiceForTests } from '../authService';
import { resetAuthStoreForTests, useAuthStore } from '../authStore';

let mockSupabase = createFakeSupabase();
let mockStorage = createMemorySecureStorage();
const mockGetDatabase = jest.fn(() => {
  throw new Error('Authentication must not open the local database');
});

jest.mock('../supabase', () => ({
  getSupabase: () => mockSupabase.client,
  getAuthStorage: () => mockStorage.storage,
  isCloudConfigured: () => true,
}));
jest.mock('../config', () => ({
  ...jest.requireActual('../config'),
  supabaseConfig: { url: 'https://example.supabase.co', publishableKey: 'sb_publishable_test' },
}));
jest.mock('expo-web-browser', () => ({
  openAuthSessionAsync: jest.fn(),
  maybeCompleteAuthSession: jest.fn(() => ({ type: 'failed' })),
}));
jest.mock('@/db/client', () => ({ getDatabase: () => mockGetDatabase() }));

/** Every row of every table, for an exact before/after comparison. */
async function snapshot(db: TestDatabase) {
  const tables = await db.getAllAsync<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    [],
  );
  const result: Record<string, unknown[]> = {};
  for (const { name } of tables) result[name] = await db.getAllAsync(`SELECT * FROM "${name}" ORDER BY rowid`, []);
  return result;
}

const AUTH_DIR = join(__dirname, '..');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return entry === '__tests__' ? [] : sourceFiles(path);
    return /\.tsx?$/.test(entry) ? [path] : [];
  });
}

beforeEach(() => {
  mockSupabase = createFakeSupabase();
  mockStorage = createMemorySecureStorage();
  mockGetDatabase.mockClear();
  mockProviderSettings(true);
  resetAuthServiceForTests();
  resetAuthStoreForTests();
});

describe('guest data isolation', () => {
  it('leaves every local row untouched through sign-in, restore, expiry and sign-out', async () => {
    const { db, trips, inventory } = await setupRepositories();
    const input = tripInput();
    await trips.create(input, buildStarterChecklist(input));
    await inventory.createItem(itemInput({ name: 'Head torch' }));
    const before = await snapshot(db);
    expect(before.trips).toHaveLength(1);

    const store = useAuthStore.getState();
    await store.initialize();

    (WebBrowser.openAuthSessionAsync as jest.Mock).mockResolvedValue({ type: 'cancel' });
    await store.signIn();
    (WebBrowser.openAuthSessionAsync as jest.Mock).mockResolvedValue({
      type: 'success',
      url: 'tripprep://auth/callback?code=c1',
    });
    await store.signIn();
    expect(useAuthStore.getState().status).toBe('signedIn');
    mockSupabase.emit('TOKEN_REFRESHED', makeSession());
    mockSupabase.emit('SIGNED_OUT', null); // expiry
    await store.handleRedirect('auth/callback?code=c2');
    await store.signOut();

    expect(await snapshot(db)).toEqual(before);
    expect(mockGetDatabase).not.toHaveBeenCalled();
    expect(mockSupabase.forbiddenAccess).toEqual([]);
    db.close();
  });

  it('keeps auth code independent of the local database and feature data', () => {
    const files = sourceFiles(AUTH_DIR);
    expect(files.length).toBeGreaterThan(5);
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      expect({ file, imports: source.match(/from '@\/db[^']*'/g) ?? [] }).toEqual({ file, imports: [] });
      expect({
        file,
        imports: source.match(/from '@\/features\/(?!auth)[^']*'/g) ?? [],
      }).toEqual({ file, imports: [] });
      // No Supabase data APIs in G2: auth only.
      expect({ file, calls: source.match(/\.(from|rpc)\(/g) ?? [] }).toEqual({ file, calls: [] });
    }
  });
});
