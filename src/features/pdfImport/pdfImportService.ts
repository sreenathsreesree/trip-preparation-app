import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

import { getRepositories } from '@/db/repositories';

import { applyDraft, type ImportSummary } from './applyDraft';
import { matchExisting, parseItinerary, type ItineraryDraft } from './itinerary';
import type { PdfImport } from './pdfImportRepository';
import { extractPdfText } from './pdfText';

export const MAX_PDF_BYTES = 25 * 1024 * 1024;
const PDF_DIR = 'pdf-imports';

/** Lets the main thread draw the "Reading…" state before the CPU-heavy work starts. */
const yieldToUi = () => new Promise((r) => setTimeout(r, 30));

async function keepOriginal(uri: string, id: string): Promise<string | null> {
  if (Platform.OS === 'web') return null; // browsers give no lasting file; the text and draft are kept.
  const dir = new Directory(Paths.document, PDF_DIR);
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  const target = new File(dir, `${id}.pdf`);
  await new File(uri).copy(target);
  return target.uri;
}

async function readBytes(uri: string): Promise<Uint8Array> {
  if (Platform.OS === 'web' || uri.startsWith('blob:') || uri.startsWith('data:')) return new Uint8Array(await (await fetch(uri)).arrayBuffer());
  return new File(uri).bytes();
}

/** Draft from text, with places the trip already has marked (exact, or to confirm). */
export async function draftFromText(tripId: string, text: string): Promise<ItineraryDraft> {
  const { planner } = await getRepositories();
  const plan = await planner.load(tripId);
  return matchExisting(parseItinerary(text), plan.nodes.map((n) => ({ id: n.id, name: n.name })));
}

/**
 * Picks a PDF and reads it on the device. Every step is saved, so a draft
 * survives closing the app, and a failure keeps the original PDF and lets the
 * user paste the text instead. Nothing is added to the trip here.
 */
export async function importPdf(tripId: string): Promise<PdfImport | null> {
  const picked = await DocumentPicker.getDocumentAsync({ type: 'application/pdf', copyToCacheDirectory: true, multiple: false });
  if (picked.canceled || !picked.assets[0]) return null;
  const asset = picked.assets[0];
  if (asset.size && asset.size > MAX_PDF_BYTES) throw new Error('This PDF is larger than 25 MB. Try a smaller file or paste the itinerary text.');
  const { pdfImports } = await getRepositories();
  const record = await pdfImports.create(tripId, asset.name ?? 'itinerary.pdf', null);
  try {
    // The original stays on the phone even if reading it fails.
    await keepOriginal(asset.uri, record.id)
      .then((uri) => (uri ? pdfImports.setFile(record.id, uri) : undefined))
      .catch(() => undefined);
    await yieldToUi();
    const result = extractPdfText(await readBytes(asset.uri));
    if (result.looksScanned) {
      await pdfImports.update(record.id, {
        status: 'needs_text',
        text: result.text,
        error: 'This PDF looks scanned (pictures of text). Text recognition (OCR) is not available in the app yet, so paste the itinerary text instead.',
      });
    } else {
      await pdfImports.update(record.id, { status: 'draft', text: result.text, draft: await draftFromText(tripId, result.text) });
    }
  } catch (e) {
    await pdfImports.update(record.id, { status: 'failed', error: e instanceof Error ? e.message : 'Could not read this PDF.' });
  }
  return pdfImports.get(record.id);
}

/** Uses pasted text (for scanned PDFs, or no PDF at all). */
export async function draftFromPastedText(tripId: string, importId: string | null, text: string): Promise<PdfImport> {
  const { pdfImports } = await getRepositories();
  const id = importId ?? (await pdfImports.create(tripId, 'Pasted itinerary', null)).id;
  await pdfImports.update(id, { status: 'draft', text, error: null, draft: await draftFromText(tripId, text) });
  return (await pdfImports.get(id)) as PdfImport;
}

export async function saveDraft(importId: string, draft: ItineraryDraft): Promise<void> {
  const { pdfImports } = await getRepositories();
  await pdfImports.update(importId, { draft });
}

/** Adds the reviewed draft to the trip (only adding) and records what was done. */
export async function confirmImport(tripId: string, importId: string, draft: ItineraryDraft): Promise<ImportSummary> {
  const { pdfImports, planner, companion, dayPlan } = await getRepositories();
  const summary = await applyDraft(tripId, draft, { planner, companion, dayPlan });
  await pdfImports.update(importId, {
    status: 'imported',
    draft,
    summary: `${summary.destinations} destinations and ${summary.places} places added, ${summary.reused} existing reused, ${summary.notes} notes`,
  });
  return summary;
}
