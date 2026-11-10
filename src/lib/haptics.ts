import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

const supported = Platform.OS === 'ios' || Platform.OS === 'android';

/** Light selection tick. Haptics are best-effort and never throw. */
export function selectionFeedback(): void {
  if (!supported) return;
  Haptics.selectionAsync().catch(() => undefined);
}

export function impactFeedback(): void {
  if (!supported) return;
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
}

export function successFeedback(): void {
  if (!supported) return;
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
}
