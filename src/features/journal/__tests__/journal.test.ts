import { setupRepositories, tripInput } from '../../../../test/fixtures';
import { buildTimeline, defaultEntryDate, parseBackup, planRestore, toBackup, validateEntry, type JournalEntry } from '../model';

async function setup() {
  const repos = await setupRepositories();
  const trip = await repos.trips.create(
    tripInput({ name: 'Kerala', destinations: [], startDate: '2026-12-20', endDate: '2026-12-24' }),
    { sections: [] },
  );
  const munnar = (await repos.planner.addNode(trip.id, { name: 'Munnar', parentId: null, addToRoute: true })).node;
  return { ...repos, trip, munnar };
}

describe('journal entries', () => {
  it('validates entries', () => {
    expect(validateEntry({ entryDate: '2026-12-20', title: 'Arrival' })).toBeNull();
    expect(validateEntry({ entryDate: '2026-12-20' })).toMatch(/title or a few words/);
    expect(validateEntry({ entryDate: '2026-02-30', body: 'x' })).toMatch(/valid date/);
    expect(validateEntry({ entryDate: '2026-12-20', body: 'x', mood: 'ecstatic' as never })).toMatch(/mood/);
  });

  it('creates private entries, edits them, links a destination and manages photos', async () => {
    const ctx = await setup();
    const entry = await ctx.journal.create(ctx.trip.id, { entryDate: '2026-12-21', title: '  Tea hills ', body: 'Misty morning', mood: 'great', nodeId: ctx.munnar.id });
    expect(entry).toMatchObject({ title: 'Tea hills', visibility: 'private', nodeId: ctx.munnar.id, mood: 'great' });

    const photo = await ctx.journal.addPhoto(entry.id, 'file:///a.jpg', 'View');
    await ctx.journal.addPhoto(entry.id, 'file:///b.jpg');
    expect((await ctx.journal.get(entry.id))?.photos.map((p) => [p.uri, p.position])).toEqual([
      ['file:///a.jpg', 0],
      ['file:///b.jpg', 1],
    ]);
    expect(await ctx.journal.removePhoto(photo.id)).toBe('file:///a.jpg');

    const updated = await ctx.journal.update(entry.id, { entryDate: '2026-12-22', title: 'Tea hills', body: 'Misty', mood: null, nodeId: null });
    expect(updated).toMatchObject({ entryDate: '2026-12-22', mood: null, nodeId: null });
    expect((await ctx.journal.setVisibility(entry.id, 'shared')).visibility).toBe('shared');

    await expect(ctx.journal.create(ctx.trip.id, { entryDate: '2026-12-21', title: 'x', nodeId: 'not-a-node' })).rejects.toThrow(/no longer in this trip/);
    expect(await ctx.journal.remove(entry.id)).toEqual(['file:///b.jpg']);
    expect(await ctx.journal.list(ctx.trip.id)).toEqual([]);
  });

  it('keeps an entry when its destination is removed, and removes entries with the trip', async () => {
    const ctx = await setup();
    const entry = await ctx.journal.create(ctx.trip.id, { entryDate: '2026-12-21', title: 'Echo', nodeId: ctx.munnar.id });
    await ctx.planner.removeNode(ctx.munnar.id, 'withChildren');
    expect((await ctx.journal.get(entry.id))?.nodeId).toBeNull();
    await ctx.trips.remove(ctx.trip.id);
    expect(await ctx.journal.get(entry.id)).toBeNull();
  });

  it('builds a day-by-day timeline with destination memories', async () => {
    const ctx = await setup();
    await ctx.journal.create(ctx.trip.id, { entryDate: '2026-12-21', title: 'Day two' });
    await ctx.journal.create(ctx.trip.id, { entryDate: '2026-12-20', title: 'Arrival' });
    await ctx.journal.create(ctx.trip.id, { entryDate: '2026-12-26', title: 'Back home' });
    await ctx.companion.saveMemory(ctx.munnar.id, { visitedOn: '2026-12-21', rating: 5, notes: 'Lovely' });
    const memories = await ctx.journal.memories(ctx.trip.id);
    expect(memories).toEqual([{ nodeId: ctx.munnar.id, nodeName: 'Munnar', visitedOn: '2026-12-21', rating: 5, notes: 'Lovely', photos: [] }]);

    const days = buildTimeline(await ctx.journal.list(ctx.trip.id), memories, ctx.trip);
    expect(days.map((d) => [d.date, d.dayNumber, d.items.map((i) => i.kind)])).toEqual([
      ['2026-12-26', null, ['entry']],
      ['2026-12-21', 2, ['memory', 'entry']],
      ['2026-12-20', 1, ['entry']],
    ]);
    expect(defaultEntryDate(ctx.trip, '2026-12-01')).toBe('2026-12-20');
    expect(defaultEntryDate(ctx.trip, '2026-12-22')).toBe('2026-12-22');
    expect(defaultEntryDate(ctx.trip, '2027-01-05')).toBe('2026-12-24');
  });
});

describe('backup format and restore plan', () => {
  const entry = (id: string, over: Partial<JournalEntry> = {}): JournalEntry => ({
    id,
    tripId: 't',
    nodeId: null,
    entryDate: '2026-12-20',
    title: id,
    body: '',
    mood: null,
    visibility: 'private',
    photos: [],
    createdAt: '2026-12-20T00:00:00Z',
    updatedAt: '2026-12-20T00:00:00Z',
    ...over,
  });
  const photo = (id: string, entryId: string, uri = `file:///${id}.png`) => ({ id, entryId, uri, caption: '', position: 0, createdAt: '' });

  it('round-trips and rejects anything that is not a journal backup', () => {
    const backup = toBackup({ id: 't', name: 'Kerala' }, [entry('a', { photos: [photo('p1', 'a')] })], '2026-12-30T00:00:00Z');
    expect(backup.entries[0]?.photos[0]?.fileName).toBe('photo-p1.png');
    expect(parseBackup(JSON.parse(JSON.stringify(backup)))).toEqual(backup);
    expect(parseBackup({ format: 'other' })).toBeNull();
    expect(parseBackup({ ...backup, version: 99 })).toBeNull();
    expect(parseBackup({ ...backup, entries: [{ id: 'x', entryDate: 'bad' }] })?.entries).toEqual([]);
  });

  it('only adds: missing entries and photos are added, differing entries keep the device copy', () => {
    const backup = toBackup(
      { id: 't', name: 'Kerala' },
      [entry('same'), entry('changed', { body: 'from drive' }), entry('new'), entry('morephotos', { photos: [photo('p2', 'morephotos')] })],
      '',
    );
    const plan = planRestore([entry('same'), entry('changed', { body: 'on device' }), entry('morephotos'), entry('localonly')], backup);
    expect(plan.add.map((e) => e.id)).toEqual(['new']);
    expect(plan.conflicts.map((e) => e.id)).toEqual(['changed']);
    expect(plan.addPhotos).toEqual([{ entryId: 'morephotos', photo: expect.objectContaining({ id: 'p2' }) }]);
    expect(plan.unchanged).toBe(2);
  });
});
