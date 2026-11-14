import type { GalleryPhoto } from '../../journal/gallery';
import { groupByDay, groupByPlace } from '../grouping';

const photo = (key: string, date: string, nodeId: string | null, place: string | null): GalleryPhoto => ({
  key,
  uri: `file:///${key}.jpg`,
  tripId: 't',
  tripName: 'Kerala',
  tripStart: '2026-12-01',
  date,
  source: nodeId ? 'memory' : 'journal',
  caption: '',
  place,
  nodeId,
});

describe('Memories grouping', () => {
  const photos = [photo('a', '2026-12-03', 'n2', 'Thekkady'), photo('b', '2026-12-01', 'n1', 'Munnar'), photo('c', '2026-12-02', null, null), photo('d', '2026-12-02', 'n1', 'Munnar')];
  it('groups by destination in plan order, journal last, with date ranges', () => {
    const groups = groupByPlace(photos, ['n1', 'n2']);
    expect(groups.map((g) => g.title)).toEqual(['Munnar', 'Thekkady', 'Journal']);
    expect(groups[0]?.photos.map((p) => p.key)).toEqual(['b', 'd']);
    expect(groups[0]?.subtitle).toBe('2 photos · 1 Dec 2026 – 2 Dec 2026');
  });
  it('groups by day with the places visited', () => {
    const groups = groupByDay(photos);
    expect(groups.map((g) => g.photos.length)).toEqual([1, 2, 1]);
    expect(groups[1]?.subtitle).toBe('2 photos · Munnar');
  });
});
