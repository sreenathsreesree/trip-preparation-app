import * as Location from 'expo-location';
import { create } from 'zustand';

import { getRepositories } from '@/db/repositories';
import { toErrorMessage } from '@/lib/errors';

import {
  DEFAULT_ARRIVAL,
  emptyArrivalState,
  snooze,
  updateArrival,
  type ArrivalPrompt,
  type ArrivalSettings,
  type ArrivalState,
  type ArrivalTarget,
  type PositionFix,
} from './arrival';
import { usePlannerStore } from './plannerStore';

export type LocationPermission = 'unknown' | 'granted' | 'denied';

interface ArrivalStore {
  settings: ArrivalSettings;
  loaded: boolean;
  permission: LocationPermission;
  /** The question currently shown ("You've reached X. Mark as visited?"). */
  prompt: (ArrivalPrompt & { tripId: string }) | null;
  machine: ArrivalState;
  lastFix: PositionFix | null;
  error: string | null;
  load: () => Promise<void>;
  /** Turning on asks for location permission (only now, never before). */
  setEnabled: (enabled: boolean) => Promise<void>;
  onFix: (tripId: string, fix: PositionFix, targets: readonly ArrivalTarget[]) => void;
  /** Yes marks the place visited (the only way GPS ever changes a status); Not yet keeps it upcoming. */
  answer: (markVisited: boolean) => Promise<void>;
}

export const useArrivalStore = create<ArrivalStore>()((set, get) => ({
  settings: DEFAULT_ARRIVAL,
  loaded: false,
  permission: 'unknown',
  prompt: null,
  machine: emptyArrivalState(),
  lastFix: null,
  error: null,

  async load() {
    try {
      const { companion } = await getRepositories();
      const settings = await companion.arrivalSettings();
      let permission: LocationPermission = 'unknown';
      if (settings.enabled) {
        // Only checks (never prompts): the user turned this on earlier.
        const status = await Location.getForegroundPermissionsAsync().catch(() => null);
        permission = status?.granted ? 'granted' : 'denied';
      }
      set({ settings, permission, loaded: true });
    } catch (error) {
      set({ loaded: true, error: toErrorMessage(error, 'Could not load arrival settings.') });
    }
  },

  async setEnabled(enabled) {
    set({ error: null });
    const { companion } = await getRepositories();
    if (!enabled) {
      set({ settings: await companion.saveArrivalSettings({ ...get().settings, enabled: false }), prompt: null, machine: emptyArrivalState() });
      return;
    }
    let granted = false;
    try {
      granted = (await Location.requestForegroundPermissionsAsync()).granted;
    } catch {
      granted = false;
    }
    if (!granted) {
      set({ permission: 'denied', error: 'Location permission was not given, so arrival prompts stay off. You can always mark places visited yourself.' });
      return;
    }
    set({ permission: 'granted', settings: await companion.saveArrivalSettings({ ...get().settings, enabled: true }) });
  },

  onFix(tripId, fix, targets) {
    const { settings, prompt } = get();
    if (!settings.enabled) return;
    const result = updateArrival(get().machine, fix, targets, settings);
    set({ machine: result.state, lastFix: fix });
    if (result.prompt && !prompt) set({ prompt: { ...result.prompt, tripId } });
  },

  async answer(markVisited) {
    const prompt = get().prompt;
    if (!prompt) return;
    set({ prompt: null });
    if (markVisited) {
      await usePlannerStore.getState().setVisited(prompt.tripId, prompt.nodeId, true);
    } else {
      set({ machine: snooze(get().machine, prompt.nodeId, Date.now()) });
    }
  },
}));
