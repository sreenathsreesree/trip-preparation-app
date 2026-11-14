import type { Database } from '@/db/types';

export interface AutoCover {
  subjectType: 'trip' | 'node';
  subjectId: string;
  query: string;
  status: 'found' | 'none';
  imageUrl: string | null;
  localUri: string | null;
  /** Small variant for cards (null for covers stored before thumbnails existed). */
  thumbUrl: string | null;
  thumbLocalUri: string | null;
  title: string;
  credit: string;
  license: string;
  sourceUrl: string;
  /** Commons file names the user moved past with "Change". */
  skipped: string[];
  fetchedAt: string;
}

interface Row {
  subject_type: 'trip' | 'node';
  subject_id: string;
  query: string;
  status: 'found' | 'none';
  image_url: string | null;
  local_uri: string | null;
  thumb_url: string | null;
  thumb_local_uri: string | null;
  title: string;
  credit: string;
  license: string;
  source_url: string;
  skipped: string;
  fetched_at: string;
}

const toCover = (r: Row): AutoCover => {
  let skipped: string[] = [];
  try {
    const parsed: unknown = JSON.parse(r.skipped);
    if (Array.isArray(parsed)) skipped = parsed.filter((x): x is string => typeof x === 'string');
  } catch {
    skipped = [];
  }
  return { subjectType: r.subject_type, subjectId: r.subject_id, query: r.query, status: r.status, imageUrl: r.image_url, localUri: r.local_uri, thumbUrl: r.thumb_url ?? null, thumbLocalUri: r.thumb_local_uri ?? null, title: r.title, credit: r.credit, license: r.license, sourceUrl: r.source_url, skipped, fetchedAt: r.fetched_at };
};

/** Automatically chosen covers, in the account's own database. Own cover photos are stored elsewhere and never touched here. */
export function createCoverRepository(db: Database) {
  return {
    async get(subjectType: 'trip' | 'node', subjectId: string): Promise<AutoCover | null> {
      const row = await db.getFirstAsync<Row>(
        `SELECT c.*, t.thumb_url, t.thumb_local_uri FROM auto_covers c
         LEFT JOIN auto_cover_thumbs t ON t.subject_type = c.subject_type AND t.subject_id = c.subject_id
         WHERE c.subject_type = ? AND c.subject_id = ?`,
        [subjectType, subjectId],
      );
      return row ? toCover(row) : null;
    },
    async save(c: AutoCover): Promise<void> {
      await db.runAsync(
        `INSERT INTO auto_covers (subject_type, subject_id, query, status, image_url, local_uri, title, credit, license, source_url, skipped, fetched_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (subject_type, subject_id) DO UPDATE SET query = excluded.query, status = excluded.status, image_url = excluded.image_url,
           local_uri = excluded.local_uri, title = excluded.title, credit = excluded.credit, license = excluded.license,
           source_url = excluded.source_url, skipped = excluded.skipped, fetched_at = excluded.fetched_at`,
        [c.subjectType, c.subjectId, c.query, c.status, c.imageUrl, c.localUri, c.title, c.credit, c.license, c.sourceUrl, JSON.stringify(c.skipped), c.fetchedAt],
      );
      await db.runAsync(
        `INSERT INTO auto_cover_thumbs (subject_type, subject_id, thumb_url, thumb_local_uri) VALUES (?, ?, ?, ?)
         ON CONFLICT (subject_type, subject_id) DO UPDATE SET thumb_url = excluded.thumb_url, thumb_local_uri = excluded.thumb_local_uri`,
        [c.subjectType, c.subjectId, c.thumbUrl, c.thumbLocalUri],
      );
    },
  };
}

export type CoverRepository = ReturnType<typeof createCoverRepository>;
