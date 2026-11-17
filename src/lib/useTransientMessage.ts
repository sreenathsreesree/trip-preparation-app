import { useEffect, useState } from 'react';

import { createTransientMessage, TRANSIENT_MESSAGE_MS, type TransientMessage } from './transientMessage';

/** A success message that dismisses itself after 3 s (or on close); state lives only in this component. */
export function useTransientMessage<T = string>(duration = TRANSIENT_MESSAGE_MS): [T | null, TransientMessage<T>] {
  const [value, setValue] = useState<T | null>(null);
  // Created once; `setValue` is stable, so the controller never goes stale.
  const [controller] = useState(() => createTransientMessage<T>(setValue, duration));
  useEffect(() => () => controller.dispose(), [controller]);
  return [value, controller];
}
