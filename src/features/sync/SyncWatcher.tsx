import { useEffect } from 'react';
import { AppState } from 'react-native';

import { useAuthStore } from '@/features/auth/authStore';

import { useSyncStore } from './syncStore';

const EVERY_MS = 5 * 60_000;

/**
 * Backs up and restores automatically while the app is open: after sign-in, on
 * launch, when the app returns to the foreground and every five minutes.
 * Renders nothing. Not real-time: edits reach other phones on their next run.
 */
export function SyncWatcher() {
  const userId = useAuthStore((s) => s.user?.id ?? null);
  useEffect(() => {
    if (!userId) {
      void useSyncStore.getState().refresh();
      return;
    }
    void useSyncStore.getState().syncNow();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void useSyncStore.getState().syncNow();
    });
    const timer = setInterval(() => {
      if (AppState.currentState === 'active') void useSyncStore.getState().syncNow();
    }, EVERY_MS);
    return () => {
      sub.remove();
      clearInterval(timer);
    };
  }, [userId]);
  return null;
}
