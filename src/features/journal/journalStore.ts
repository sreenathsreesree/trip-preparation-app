import { create } from 'zustand';

import { getRepositories } from '@/db/repositories';
import { toErrorMessage } from '@/lib/errors';
import { deleteStoredImage } from '@/lib/imageStore';

import type { EntryInput, JournalEntry, MemoryItem } from './model';

export interface TripJournal {
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  entries: JournalEntry[];
  memories: MemoryItem[];
}

const EMPTY: TripJournal = { status: 'idle', error: null, entries: [], memories: [] };

interface JournalState {
  byTrip: Record<string, TripJournal>;
  load: (tripId: string) => Promise<void>;
  create: (tripId: string, input: EntryInput) => Promise<JournalEntry>;
  update: (tripId: string, id: string, input: EntryInput) => Promise<JournalEntry>;
  remove: (tripId: string, id: string) => Promise<void>;
  addPhoto: (tripId: string, entryId: string, uri: string) => Promise<void>;
  removePhoto: (tripId: string, photoId: string) => Promise<void>;
}

export const useJournalStore = create<JournalState>()((set, get) => {
  const put = (tripId: string, patch: Partial<TripJournal>) =>
    set((s) => ({ byTrip: { ...s.byTrip, [tripId]: { ...(s.byTrip[tripId] ?? EMPTY), ...patch } } }));

  async function refresh(tripId: string) {
    const { journal } = await getRepositories();
    const [entries, memories] = await Promise.all([journal.list(tripId), journal.memories(tripId)]);
    put(tripId, { status: 'ready', error: null, entries, memories });
  }

  async function write<T>(tripId: string, fn: (repo: Awaited<ReturnType<typeof getRepositories>>['journal']) => Promise<T>): Promise<T> {
    const { journal } = await getRepositories();
    try {
      return await fn(journal);
    } finally {
      await refresh(tripId).catch(() => undefined);
    }
  }

  return {
    byTrip: {},
    async load(tripId) {
      if (!get().byTrip[tripId]?.entries.length) put(tripId, { status: 'loading', error: null });
      try {
        await refresh(tripId);
      } catch (error) {
        put(tripId, { status: 'error', error: toErrorMessage(error, 'Could not load the journal.') });
      }
    },
    create: (tripId, input) => write(tripId, (repo) => repo.create(tripId, input)),
    update: (tripId, id, input) => write(tripId, (repo) => repo.update(id, input)),
    remove: (tripId, id) =>
      write(tripId, async (repo) => {
        for (const uri of await repo.remove(id)) deleteStoredImage(uri);
      }),
    addPhoto: (tripId, entryId, uri) =>
      write(tripId, async (repo) => {
        await repo.addPhoto(entryId, uri);
      }),
    removePhoto: (tripId, photoId) =>
      write(tripId, async (repo) => {
        deleteStoredImage(await repo.removePhoto(photoId));
      }),
  };
});

export function useTripJournal(tripId: string | undefined): TripJournal {
  return useJournalStore((s) => (tripId ? s.byTrip[tripId] : undefined) ?? EMPTY);
}
