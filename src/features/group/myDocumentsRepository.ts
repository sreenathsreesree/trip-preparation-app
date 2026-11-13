import type { Database } from '@/db/types';

/** My Trip: private trip documents. Stays on this device; never part of the Group Trip. */
export const PRIVATE_DOC_TYPES = ['passport', 'id', 'visa', 'insurance', 'medical', 'ticket', 'booking', 'other'] as const;
export type PrivateDocType = (typeof PRIVATE_DOC_TYPES)[number];

export interface MyDocument {
  id: string;
  tripId: string;
  title: string;
  type: PrivateDocType;
  date: string | null;
  reference: string;
  link: string;
  expiry: string | null;
  placeName: string;
  notes: string;
}

interface Row {
  id: string;
  trip_id: string;
  title: string;
  type: string;
  doc_date: string | null;
  reference: string;
  link: string;
  expiry: string | null;
  place_name: string;
  notes: string;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const toDoc = (r: Row): MyDocument => ({
  id: r.id,
  tripId: r.trip_id,
  title: r.title,
  type: (PRIVATE_DOC_TYPES as readonly string[]).includes(r.type) ? (r.type as PrivateDocType) : 'other',
  date: r.doc_date,
  reference: r.reference,
  link: r.link,
  expiry: r.expiry,
  placeName: r.place_name,
  notes: r.notes,
});

export function createMyDocumentsRepository(db: Database, deps: { createId: () => string; now?: () => Date }) {
  const now = () => (deps.now ?? (() => new Date()))().toISOString();
  return {
    async list(tripId: string): Promise<MyDocument[]> {
      return (await db.getAllAsync<Row>('SELECT * FROM my_documents WHERE trip_id = ? ORDER BY doc_date IS NULL, doc_date, created_at', [tripId])).map(toDoc);
    },
    async save(tripId: string, input: Omit<MyDocument, 'id' | 'tripId'> & { id?: string }): Promise<MyDocument> {
      const title = input.title.trim().slice(0, 120);
      if (!title) throw new Error('A document needs a title.');
      const date = input.date && DATE.test(input.date) ? input.date : null;
      const expiry = input.expiry && DATE.test(input.expiry) ? input.expiry : null;
      const id = input.id ?? deps.createId();
      const t = now();
      await db.runAsync(
        `INSERT INTO my_documents (id, trip_id, title, type, doc_date, reference, link, expiry, place_name, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET title = excluded.title, type = excluded.type, doc_date = excluded.doc_date, reference = excluded.reference,
           link = excluded.link, expiry = excluded.expiry, place_name = excluded.place_name, notes = excluded.notes, updated_at = excluded.updated_at`,
        [id, tripId, title, input.type, date, input.reference.slice(0, 80), input.link.slice(0, 500), expiry, input.placeName.slice(0, 80), input.notes.slice(0, 2000), t, t],
      );
      return toDoc((await db.getFirstAsync<Row>('SELECT * FROM my_documents WHERE id = ?', [id])) as Row);
    },
    async remove(id: string): Promise<void> {
      await db.runAsync('DELETE FROM my_documents WHERE id = ?', [id]);
    },
  };
}

export type MyDocumentsRepository = ReturnType<typeof createMyDocumentsRepository>;
