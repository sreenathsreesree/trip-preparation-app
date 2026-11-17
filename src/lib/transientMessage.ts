/** How long a success message stays before it dismisses itself. */
export const TRANSIENT_MESSAGE_MS = 3000;

export interface TransientMessage<T> {
  /** Shows `value`, replacing any message on screen and restarting the timer (one timer at a time). */
  show: (value: T) => void;
  /** Hides it now (the close button). Never touches what the operation saved. */
  dismiss: () => void;
  /** Stops the timer (the screen went away). */
  dispose: () => void;
}

/**
 * A short-lived UI message: shown after a successful operation, gone after `duration` or when
 * dismissed. Kept only in memory — never in the database or local storage — so reopening a
 * screen never shows an old message.
 */
export function createTransientMessage<T>(
  onChange: (value: T | null) => void,
  duration = TRANSIENT_MESSAGE_MS,
  timers: { set: (fn: () => void, ms: number) => unknown; clear: (handle: unknown) => void } = {
    set: (fn, ms) => setTimeout(fn, ms),
    clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  },
): TransientMessage<T> {
  let handle: unknown = null;
  const stop = () => {
    if (handle !== null) timers.clear(handle);
    handle = null;
  };
  return {
    show(value) {
      stop();
      onChange(value);
      handle = timers.set(() => {
        handle = null;
        onChange(null);
      }, duration);
    },
    dismiss() {
      stop();
      onChange(null);
    },
    dispose: stop,
  };
}
