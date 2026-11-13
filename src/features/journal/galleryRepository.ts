import type { Database } from '@/db/types';

import type { GalleryPhoto } from './gallery';

/**
 * Reads the gallery from the account's own database (account partitions mean
 * another account's photos are never in it). Memories photos are stored as a
 * JSON list per destination; journal photos as rows.
 */
export function createGalleryRepository(db: Database) {
  return {
    async list(tripId?: string): Promise<GalleryPhoto[]> {
      const where = tripId ? 'WHERE t.id = ?' : '';
      const params = tripId ? [tripId] : [];
      const journal = await db.getAllAsync<{ id: string; uri: string; caption: string; trip_id: string; name: string; start_date: string; entry_date: string }>(
        `SELECT p.id, p.uri, p.caption, t.id AS trip_id, t.name, t.start_date, e.entry_date
         FROM journal_photos p JOIN journal_entries e ON e.id = p.entry_id JOIN trips t ON t.id = e.trip_id ${where}
         ORDER BY e.entry_date, e.created_at, p.position`,
        params,
      );
      const memories = await db.getAllAsync<{ node_id: string; photos: string; visited_on: string | null; created_at: string; trip_id: string; name: string; start_date: string; place: string }>(
        `SELECT m.node_id, m.photos, m.visited_on, m.created_at, t.id AS trip_id, t.name, t.start_date, n.name AS place
         FROM plan_node_memories m JOIN trips t ON t.id = m.trip_id JOIN trip_plan_nodes n ON n.id = m.node_id ${where}`,
        params,
      );
      const out: GalleryPhoto[] = journal.map((r) => ({
        key: `j:${r.id}`,
        uri: r.uri,
        tripId: r.trip_id,
        tripName: r.name,
        tripStart: r.start_date,
        date: r.entry_date,
        source: 'journal',
        caption: r.caption,
        place: null,
      }));
      for (const m of memories) {
        let uris: unknown;
        try {
          uris = JSON.parse(m.photos);
        } catch {
          uris = [];
        }
        if (!Array.isArray(uris)) continue;
        uris.forEach((uri, i) => {
          if (typeof uri !== 'string' || !uri) return;
          out.push({
            key: `m:${m.node_id}:${i}`,
            uri,
            tripId: m.trip_id,
            tripName: m.name,
            tripStart: m.start_date,
            date: m.visited_on ?? m.created_at.slice(0, 10),
            source: 'memory',
            caption: '',
            place: m.place,
          });
        });
      }
      return out;
    },
  };
}

export type GalleryRepository = ReturnType<typeof createGalleryRepository>;
