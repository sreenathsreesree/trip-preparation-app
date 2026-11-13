import type { Database } from '@/db/types';

export interface AutoCover {
  subjectType: 'trip' | 'node';
  subjectId: string;
  query: string;
  status: 'found' | 'none';
  imageUrl: string | null;
  localUri: string | null;
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
  return { subjectType: r.subject_type, subjectId: r.subject_id, query: r.query, status: r.status, imageUrl: r.image_url, localUri: r.local_uri, title: r.title, credit: r.credit, license: r.license, sourceUrl: r.source_url, skipped, fetchedAt: r.fetched_at };
};

/** Automatically chosen covers, in the account's own database. Own cover photos are stored elsewhere and never touched here. */
export function createCoverRepository(db: Database) {
  return {
    async get(subjectType: 'trip' | 'node', subjectId: string): Promise<AutoCover | null> {
      const row = await db.getFirstAsync<Row>('SELECT * FROM auto_covers WHERE subject_type = ? AND subject_id = ?', [subjectType, subjectId]);
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
    },
  };
}

export type CoverRepository = ReturnType<typeof createCoverRepository>;
