import { useCallback, useEffect, useState } from 'react';

import { getRepositories } from '@/db/repositories';
import { imageExists, saveImageBytes } from '@/lib/imageStore';

import type { AutoCover } from './coverRepository';
import { ensureAutoCover } from './coverService';
import type { CoverQuery } from './wikimedia';

const IMAGE_MAX_BYTES = 4 * 1024 * 1024;

/** Downloads one (already size-limited) Commons image; refuses anything that isn't an image or is unexpectedly large. */
async function download(url: string): Promise<string | null> {
  const r = await fetch(url);
  if (!r.ok) return null;
  const type = r.headers.get('Content-Type') ?? 'image/jpeg';
  if (!type.startsWith('image/')) return null;
  const bytes = new Uint8Array(await r.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > IMAGE_MAX_BYTES) return null;
  return saveImageBytes(bytes, type);
}

/** At most two cover searches at a time, so a list of destinations doesn't flood Wikimedia. */
let running = 0;
const waiting: (() => void)[] = [];
async function limited<T>(task: () => Promise<T>): Promise<T> {
  if (running >= 2) await new Promise<void>((resolve) => waiting.push(resolve));
  running++;
  try {
    return await task();
  } finally {
    running--;
    waiting.shift()?.();
  }
}

export type CoverState = { status: 'loading' } | { status: 'ready'; cover: AutoCover; uri: string | null; thumbUri: string | null } | { status: 'error' };

/** The device copy when it's there; otherwise the web URL (shown while online, cached by expo-image). */
const pick = (local: string | null, remote: string | null) => (local && imageExists(local) ? local : remote);
const uris = (c: AutoCover) => ({ uri: pick(c.localUri, c.imageUrl), thumbUri: pick(c.thumbLocalUri, c.thumbUrl) ?? pick(c.localUri, c.imageUrl) });

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
      const cover = await limited(() => ensureAutoCover({ type: subject.type, id: subject.id }, query, { repo: covers, fetchImpl: (...a) => fetch(...a), download, exists: imageExists }, { refresh }));
      setState({ key, value: { status: 'ready', cover, ...uris(cover) } });
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
        if (stored && stored.status === 'found') setState({ key, value: { status: 'ready', cover: stored, ...uris(stored) } });
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
