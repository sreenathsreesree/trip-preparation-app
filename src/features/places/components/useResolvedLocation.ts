import { useEffect, useState } from 'react';

import { placesProvider } from '../config';
import { parseCoordinates, resolveShare, type ResolvedShare } from '../sharedLocation';

const LINKISH = /(?:https?:\/\/|geo:)\S+/i;
export const isLocationText = (text: string) => LINKISH.test(text) || parseCoordinates(text.trim()) !== null;

/** A pasted Maps link or typed coordinates, resolved automatically (debounced) — no extra Search button. */
export function useResolvedLocation(text: string): { status: 'idle' | 'loading' } | { status: 'done'; result: ResolvedShare } {
  const value = text.trim();
  const active = isLocationText(value);
  const [state, setState] = useState<{ key: string; result: ResolvedShare } | null>(null);
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      resolveShare(value, { provider: placesProvider, signal: controller.signal })
        .then((result) => !controller.signal.aborted && setState({ key: value, result }))
        .catch(() => !controller.signal.aborted && setState({ key: value, result: { status: 'unresolved', reason: 'That location couldn’t be read. Check your connection and try again.' } }));
    }, 500);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [active, value]);
  if (!active) return { status: 'idle' };
  return state?.key === value ? { status: 'done', result: state.result } : { status: 'loading' };
}
