import { router } from 'expo-router';
import { useEffect } from 'react';

import { addShareListener, takeInitialShare, type SharedText } from '../../../modules/share-intake';
import { parseInviteToken } from '../sharing/inviteLinks';

/**
 * Opens the "Add to a trip" screen when text is shared to Trip Prep from
 * another Android app (e.g. Google Maps → Share → Trip Prep). A shared
 * invitation link opens the join screen instead. Nothing is saved here.
 */
export function routeShare(share: SharedText) {
  if (/join/.test(share.text)) {
    const token = parseInviteToken(share.text);
    if (token) {
      router.push({ pathname: '/join/[token]', params: { token } });
      return;
    }
  }
  router.push({ pathname: '/share/place', params: { text: share.text.slice(0, 2000), subject: share.subject?.slice(0, 200) ?? '' } });
}

/**
 * Cold start: the share that launched the app is taken once and routed after the
 * navigator mounts. Warm start: shares arriving while the app runs come through the
 * listener. Returns the cleanup.
 */
export function watchShares(
  source: { takeInitial: () => SharedText | null; addListener: (fn: (share: SharedText) => void) => () => void },
  route: (share: SharedText) => void = routeShare,
): () => void {
  const initial = source.takeInitial();
  const timer = initial ? setTimeout(() => route(initial), 0) : null;
  const unsubscribe = source.addListener(route);
  return () => {
    if (timer) clearTimeout(timer);
    unsubscribe();
  };
}

export function ShareIntakeWatcher() {
  useEffect(() => watchShares({ takeInitial: takeInitialShare, addListener: addShareListener }), []);
  return null;
}
