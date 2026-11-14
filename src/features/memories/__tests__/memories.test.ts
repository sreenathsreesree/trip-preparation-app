import { setupRepositories, tripInput } from '../../../../test/fixtures';
import { createMemoriesRepository } from '../memoriesRepository';

async function setup() {
  const repos = await setupRepositories();
  const memories = createMemoriesRepository(repos.database, { createId: repos.deps.createId });
  const trip = await repos.trips.create(tripInput({ name: 'Kerala' }), { sections: [] });
  return { ...repos, memories, trip };
}

describe('Memories albums', () => {
  it('creates albums, adds photos once each, and reports counts and a cover', async () => {
    const { memories, trip } = await setup();
    const id = await memories.createAlbum(trip.id, ' Tea gardens ');
    expect(await memories.addToAlbum(id, ['file:///a.jpg', 'drive:1', 'file:///a.jpg'])).toBe(2);
    expect(await memories.addToAlbum(id, ['drive:1', 'file:///b.jpg'])).toBe(1);
    expect(await memories.albumPhotos(id)).toEqual(['file:///a.jpg', 'drive:1', 'file:///b.jpg']);
    expect(await memories.albums(trip.id)).toEqual([expect.objectContaining({ name: 'Tea gardens', count: 3, coverUri: 'file:///a.jpg' })]);
    await expect(memories.createAlbum(trip.id, '  ')).rejects.toThrow(/name/);
  });

  it('removing photos or deleting the album never touches the photos themselves', async () => {
    const { memories, trip, companion, planner, database } = await setup();
    const added = await planner.addNode(trip.id, { parentId: null, name: 'Munnar', addToRoute: false });
    await companion.saveMemory(added.node.id, { photos: ['file:///a.jpg', 'file:///b.jpg'] });
    const id = await memories.createAlbum(trip.id, 'Best');
    await memories.addToAlbum(id, ['file:///a.jpg', 'file:///b.jpg']);
    await memories.removeFromAlbum(id, ['file:///a.jpg']);
    await memories.deleteAlbum(id);
    expect(await memories.albums(trip.id)).toEqual([]);
    expect((await companion.node(added.node.id)).memory?.photos).toEqual(['file:///a.jpg', 'file:///b.jpg']);
    expect((await database.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM memory_album_photos', []))?.n).toBe(0);
  });

  it('keeps a caption and favourite per photo', async () => {
    const { memories, trip } = await setup();
    await memories.setNote(trip.id, 'drive:9', { caption: ' Sunrise at Top Station ', favourite: true });
    await memories.setNote(trip.id, 'drive:9', { caption: 'Sunrise', favourite: false });
    expect(await memories.notes(trip.id)).toEqual({ 'drive:9': { caption: 'Sunrise', favourite: false } });
  });
});
