import { useCallback, useEffect, useState } from 'react';

import { getRepositories } from '@/db/repositories';
import { imageExists, saveImageBytes } from '@/lib/imageStore';

import type { AutoCover } from './coverRepository';
import { ensureAutoCover } from './coverService';
import type { CoverQuery } from './wikimedia';

async function download(url: string): Promise<string | null> {
  const r = await fetch(url);
  if (!r.ok) return null;
  return saveImageBytes(new Uint8Array(await r.arrayBuffer()), r.headers.get('Content-Type') ?? 'image/jpeg');
}

export type CoverState = { status: 'loading' } | { status: 'ready'; cover: AutoCover; uri: string | null } | { status: 'error' };

/**
 * The automatic cover for a subject, from the account's own database (works
 * offline once downloaded); searched for in the background when missing.
 * `query` null (e.g. the user has their own cover) means do nothing.
 */
export function useAutoCover(subject: { type: 'trip' | 'node'; id: string }, query: CoverQuery | null) {
  const [state, setState] = useState<{ key: string; value: CoverState } | null>(null);
  const [busy, setBusy] = useState(false);
  const key = query ? `${subject.type}:${subject.id}:${query.wikipedia ?? ''}:${query.name}:${query.context}` : null;

  const run = useCallback(
    async (refresh: boolean) => {
      if (!query || !key) return;
      const { covers } = await getRepositories();
      const cover = await ensureAutoCover({ type: subject.type, id: subject.id }, query, { repo: covers, fetchImpl: (...a) => fetch(...a), download }, { refresh });
      // Prefer the device copy; the URL is used only while online and not yet downloaded.
      const uri = cover.localUri && imageExists(cover.localUri) ? cover.localUri : cover.imageUrl;
      setState({ key, value: { status: 'ready', cover, uri } });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  );

  useEffect(() => {
    if (!key) return;
    let live = true;
    void getRepositories()
      .then(({ covers }) => covers.get(subject.type, subject.id))
      .then((stored) => {
        if (!live) return;
        if (stored && stored.status === 'found') {
          const uri = stored.localUri && imageExists(stored.localUri) ? stored.localUri : stored.imageUrl;
          setState({ key, value: { status: 'ready', cover: stored, uri } });
        }
        return run(false);
      })
      .catch(() => live && setState((s) => (s?.key === key && s.value.status === 'ready' ? s : { key, value: { status: 'error' } })));
    return () => {
      live = false;
    };
  }, [key, run, subject.type, subject.id]);

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      await run(true);
    } finally {
      setBusy(false);
    }
  }, [run]);

  const current: CoverState = key && state?.key === key ? state.value : { status: 'loading' };
  return { state: current, refresh, busy };
}
