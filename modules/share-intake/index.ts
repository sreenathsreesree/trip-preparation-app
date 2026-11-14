import { requireOptionalNativeModule, type EventSubscription } from 'expo';

export type SharedText = { text: string; subject: string | null };

type NativeShareIntake = {
  getInitialShare(): { text: string; subject?: string | null } | null;
  clearInitialShare(): void;
  addListener(event: 'onShare', listener: (payload: { text: string; subject?: string | null }) => void): EventSubscription;
};

// Null on web, in Jest and in builds made before the module was added.
const native = requireOptionalNativeModule<NativeShareIntake>('ShareIntake');

export const isShareIntakeAvailable = native != null;

/** The text shared to Trip Prep that launched it, consumed so it is offered once. */
export function takeInitialShare(): SharedText | null {
  if (!native) return null;
  const share = native.getInitialShare();
  if (!share) return null;
  native.clearInitialShare();
  return { text: share.text, subject: share.subject ?? null };
}

export function addShareListener(listener: (share: SharedText) => void): () => void {
  if (!native) return () => undefined;
  const sub = native.addListener('onShare', (p) => listener({ text: p.text, subject: p.subject ?? null }));
  return () => sub.remove();
}
