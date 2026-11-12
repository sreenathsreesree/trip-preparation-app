import { useEffect } from 'react';
import { AppState } from 'react-native';

import { useAuthStore } from '@/features/auth/authStore';

import { useSharingStore } from './sharingStore';

const EVERY_MS = 2 * 60_000;

/** Syncs shared trips on launch, on return to the app and every two minutes while open. Renders nothing. */
export function SharedTripsWatcher() {
  const userId = useAuthStore((s) => s.user?.id ?? null);
  useEffect(() => {
    if (!userId) return;
    void useSharingStore.getState().syncAll();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void useSharingStore.getState().syncAll();
    });
    const timer = setInterval(() => {
      if (AppState.currentState === 'active') void useSharingStore.getState().syncAll();
    }, EVERY_MS);
    return () => {
      sub.remove();
      clearInterval(timer);
    };
  }, [userId]);
  return null;
}
