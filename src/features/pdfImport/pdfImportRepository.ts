import type { Database } from '@/db/types';

import type { ItineraryDraft } from './itinerary';

export type ImportStatus = 'extracting' | 'needs_text' | 'draft' | 'imported' | 'failed';

export interface PdfImport {
  id: string;
  tripId: string;
  fileName: string;
  fileUri: string | null;
  status: ImportStatus;
  text: string;
  draft: ItineraryDraft | null;
  error: string | null;
  summary: string;
  createdAt: string;
  updatedAt: string;
}

interface Row {
  id: string;
  trip_id: string;
  file_name: string;
  file_uri: string | null;
  status: ImportStatus;
  text: string;
  draft: string;
  error: string | null;
  summary: string;
  created_at: string;
  updated_at: string;
}

const toImport = (r: Row): PdfImport => {
  let draft: ItineraryDraft | null = null;
  try {
    const parsed: unknown = JSON.parse(r.draft);
    draft = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as ItineraryDraft) : null;
  } catch {
    draft = null;
  }
  return { id: r.id, tripId: r.trip_id, fileName: r.file_name, fileUri: r.file_uri, status: r.status, text: r.text, draft, error: r.error, summary: r.summary, createdAt: r.created_at, updatedAt: r.updated_at };
};

/** Imported PDFs and their drafts, kept on the device (in the account's own database) until confirmed. */
export function createPdfImportRepository(db: Database, deps: { createId: () => string; now?: () => Date }) {
  const now = () => (deps.now ?? (() => new Date()))().toISOString();
  return {
    async create(tripId: string, fileName: string, fileUri: string | null): Promise<PdfImport> {
      const id = deps.createId();
      const t = now();
      await db.runAsync('INSERT INTO pdf_imports (id, trip_id, file_name, file_uri, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [id, tripId, fileName.slice(0, 200), fileUri, 'extracting', t, t]);
      return (await this.get(id)) as PdfImport;
    },
    async get(id: string): Promise<PdfImport | null> {
      const row = await db.getFirstAsync<Row>('SELECT * FROM pdf_imports WHERE id = ?', [id]);
      return row ? toImport(row) : null;
    },
    async list(tripId: string): Promise<PdfImport[]> {
      return (await db.getAllAsync<Row>('SELECT * FROM pdf_imports WHERE trip_id = ? ORDER BY created_at DESC', [tripId])).map(toImport);
    },
    async update(id: string, patch: Partial<Pick<PdfImport, 'status' | 'text' | 'draft' | 'error' | 'summary'>>): Promise<void> {
      const current = await this.get(id);
      if (!current) return;
      const next = { ...current, ...patch };
      await db.runAsync('UPDATE pdf_imports SET status = ?, text = ?, draft = ?, error = ?, summary = ?, updated_at = ? WHERE id = ?', [
        next.status,
        next.text.slice(0, 500_000),
        JSON.stringify(next.draft ?? []),
        next.error,
        next.summary,
        now(),
        id,
      ]);
    },
    async setFile(id: string, fileUri: string): Promise<void> {
      await db.runAsync('UPDATE pdf_imports SET file_uri = ?, updated_at = ? WHERE id = ?', [fileUri, now(), id]);
    },
    async remove(id: string): Promise<string | null> {
      const current = await this.get(id);
      await db.runAsync('DELETE FROM pdf_imports WHERE id = ?', [id]);
      return current?.fileUri ?? null;
    },
  };
}

export type PdfImportRepository = ReturnType<typeof createPdfImportRepository>;
