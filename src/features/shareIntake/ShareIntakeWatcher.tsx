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

export function ShareIntakeWatcher() {
  useEffect(() => {
    const initial = takeInitialShare();
    // Let the navigator mount before pushing the screen.
    const timer = initial ? setTimeout(() => routeShare(initial), 0) : null;
    const unsubscribe = addShareListener(routeShare);
    return () => {
      if (timer) clearTimeout(timer);
      unsubscribe();
    };
  }, []);
  return null;
}
