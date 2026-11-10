import { Alert, Platform } from 'react-native';

interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel: string;
  destructive?: boolean;
}

/**
 * Cross-platform confirmation dialog. React Native Web's `Alert` cannot show
 * buttons, so the browser's native confirm dialog is used there.
 */
export function confirmAction({
  title,
  message,
  confirmLabel,
  destructive = false,
}: ConfirmOptions): Promise<boolean> {
  if (Platform.OS === 'web') {
    const confirmFn = (globalThis as { confirm?: (text: string) => boolean }).confirm;
    return Promise.resolve(confirmFn ? confirmFn(`${title}\n\n${message}`) : false);
  }

  return new Promise((resolve) => {
    Alert.alert(
      title,
      message,
      [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
        {
          text: confirmLabel,
          style: destructive ? 'destructive' : 'default',
          onPress: () => resolve(true),
        },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}
