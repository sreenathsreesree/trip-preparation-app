import { useEffect } from 'react';
import { AppState } from 'react-native';

import { useAuthStore } from '@/features/auth/authStore';

import { usePhotoUploadStore } from '../drive/photoUploadStore';

const RECHECK_MS = 60_000;

/**
 * Keeps the Drive photo queue moving: on launch, when the app comes back to
 * the foreground, when the signed-in account changes, and every minute while
 * photos are waiting (covers coming back online). Renders nothing.
 */
export function PhotoUploadWatcher() {
  const userId = useAuthStore((s) => s.user?.id ?? null);
  useEffect(() => {
    const store = usePhotoUploadStore.getState();
    void store.refresh().then(() => store.process());
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void usePhotoUploadStore.getState().process();
    });
    const timer = setInterval(() => {
      const s = usePhotoUploadStore.getState();
      if (s.counts.pending > 0 && AppState.currentState === 'active') void s.process();
    }, RECHECK_MS);
    return () => {
      sub.remove();
      clearInterval(timer);
    };
  }, [userId]);
  return null;
}
