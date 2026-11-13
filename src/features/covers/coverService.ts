import type { CoverRepository, AutoCover } from './coverRepository';
import { findCover, type CoverQuery } from './wikimedia';

/** A search that found nothing is retried after a week (new photos get added to Commons). */
export const NONE_RETRY_MS = 7 * 24 * 60 * 60 * 1000;

export const fileFromSource = (sourceUrl: string) => {
  const i = sourceUrl.indexOf('File:');
  return i < 0 ? null : decodeURIComponent(sourceUrl.slice(i + 5));
};

export const queryText = (q: CoverQuery) => [q.wikipedia ?? '', q.name, q.context].filter(Boolean).join(' | ');

/**
 * The automatic cover for a trip or destination: the stored one when there is
 * one for the same query, else a new search. `refresh` ("Change") moves on to
 * the next suitable image. The chosen image is downloaded once and kept on the
 * device for offline use. Never called when the user has their own cover.
 */
export async function ensureAutoCover(
  subject: { type: 'trip' | 'node'; id: string },
  q: CoverQuery,
  deps: { repo: CoverRepository; fetchImpl: typeof fetch; download: (url: string) => Promise<string | null>; now?: Date },
  options: { refresh?: boolean } = {},
): Promise<AutoCover> {
  const now = deps.now ?? new Date();
  const query = queryText(q);
  const existing = await deps.repo.get(subject.type, subject.id);
  if (existing && existing.query === query && !options.refresh) {
    if (existing.status === 'found') return existing;
    if (now.getTime() - Date.parse(existing.fetchedAt) < NONE_RETRY_MS) return existing;
  }
  const current = existing?.status === 'found' ? fileFromSource(existing.sourceUrl) : null;
  const skipped = existing && existing.query === query ? [...existing.skipped, ...(options.refresh && current ? [current] : [])] : [];
  const found = await findCover(q, { fetchImpl: deps.fetchImpl, skip: skipped });
  const base = { subjectType: subject.type, subjectId: subject.id, query, skipped, fetchedAt: now.toISOString() };
  if (!found) {
    // "Change" with nothing else suitable keeps the current image.
    if (options.refresh && existing?.status === 'found') return { ...existing, skipped };
    const none: AutoCover = { ...base, status: 'none', imageUrl: null, localUri: null, title: '', credit: '', license: '', sourceUrl: '' };
    await deps.repo.save(none);
    return none;
  }
  const localUri = await deps.download(found.imageUrl).catch(() => null);
  const cover: AutoCover = { ...base, status: 'found', imageUrl: found.imageUrl, localUri, title: found.title, credit: found.credit, license: found.license, sourceUrl: found.sourceUrl };
  await deps.repo.save(cover);
  return cover;
}
