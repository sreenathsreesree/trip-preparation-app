import { migrate } from '@/db/migrate';
import { migrations } from '@/db/migrations';

import { openTestDatabase, sequentialIds } from '../../../../test/nodeSqliteDatabase';
import { usePrepStore } from '../../preparation/prepStore';
import { createPrepItemRepository } from '../../preparation/prepItemRepository';
import type { NewTripInput } from '../model';
import { createTripRepository } from '../tripRepository';
import { useTripsStore } from '../tripsStore';

// Point the stores at an in-memory SQLite database instead of expo-sqlite.
const mockState: { repos: unknown; fail: boolean } = { repos: null, fail: false };
jest.mock('@/db/repositories', () => ({
  getRepositories: async () => {
    if (mockState.fail) throw new Error('disk unavailable');
    return mockState.repos;
  },
}));

const input: NewTripInput = {
  name: 'Ladakh ride',
  destination: 'Leh',
  startDate: '2027-06-01',
  endDate: '2027-06-10',
  travellers: { adults: 2, children: 0 },
  transportMode: 'bike',
  category: 'mountains',
};

beforeEach(async () => {
  const db = openTestDatabase();
  await migrate(db, migrations);
  const deps = { createId: sequentialIds() };
  mockState.repos = {
    trips: createTripRepository(db, deps),
    prepItems: createPrepItemRepository(db, deps),
  };
  mockState.fail = false;
  useTripsStore.setState({ trips: [], status: 'idle', error: null });
  usePrepStore.setState({ byTrip: {} });
});

describe('trips store', () => {
  it('loads, creates and removes trips', async () => {
    await useTripsStore.getState().load();
    expect(useTripsStore.getState()).toMatchObject({ status: 'ready', trips: [] });

    const trip = await useTripsStore.getState().create(input, { withStarterChecklist: true });
    expect(useTripsStore.getState().trips.map((t) => t.id)).toEqual([trip.id]);
    expect(trip.progress.total).toBeGreaterThan(0);

    await useTripsStore.getState().remove(trip.id);
    expect(useTripsStore.getState().trips).toEqual([]);
  });

  it('can create a trip without the starter checklist', async () => {
    const trip = await useTripsStore.getState().create(input, { withStarterChecklist: false });
    expect(trip.progress).toEqual({ total: 0, done: 0 });
  });

  it('exposes load failures as an error state', async () => {
    mockState.fail = true;
    await useTripsStore.getState().load();
    expect(useTripsStore.getState()).toMatchObject({ status: 'error', error: 'disk unavailable' });
  });
});

describe('prep store', () => {
  it('keeps trip progress in sync with checklist edits', async () => {
    const trip = await useTripsStore.getState().create(input, { withStarterChecklist: false });
    const prep = usePrepStore.getState();

    await prep.loadTrip(trip.id);
    await prep.addItem(trip.id, 'vehicle', 'Check chain tension');
    await prep.addItem(trip.id, 'packing', 'Riding gloves');

    const progress = () => useTripsStore.getState().trips[0]?.progress;
    expect(progress()).toEqual({ total: 2, done: 0 });

    const [first] = usePrepStore.getState().byTrip[trip.id]?.items ?? [];
    if (!first) throw new Error('expected an item');
    await prep.toggleItem(trip.id, first.id);
    expect(progress()).toEqual({ total: 2, done: 1 });

    await prep.removeItem(trip.id, first.id);
    expect(progress()).toEqual({ total: 1, done: 0 });

    // The database agrees with the store.
    await useTripsStore.getState().load();
    expect(progress()).toEqual({ total: 1, done: 0 });
  });

  it('reverts an optimistic toggle when the write fails', async () => {
    const trip = await useTripsStore.getState().create(input, { withStarterChecklist: false });
    const prep = usePrepStore.getState();
    await prep.addItem(trip.id, 'packing', 'Helmet');
    const item = usePrepStore.getState().byTrip[trip.id]?.items[0];
    if (!item) throw new Error('expected an item');

    mockState.fail = true;
    await expect(prep.toggleItem(trip.id, item.id)).rejects.toThrow('disk unavailable');
    expect(usePrepStore.getState().byTrip[trip.id]?.items[0]?.isDone).toBe(false);
  });
});
