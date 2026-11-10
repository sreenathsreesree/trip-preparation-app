import { Directory, File, Paths } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';

import { createId } from './id';

const IMAGE_DIR = 'inventory-images';

/** True for photos this app copied into its own storage (and may delete). */
export function isManagedImageUri(uri: string | null | undefined): uri is string {
  return typeof uri === 'string' && uri.startsWith('file:') && uri.includes(`/${IMAGE_DIR}/`);
}

export type PickSource = 'camera' | 'library';

export class ImagePickError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImagePickError';
  }
}

/**
 * Lets the user take or choose a photo and stores a private copy.
 * Returns a persistent URI, or null if the user cancelled.
 * - Android/iOS: copied into the app's document directory (survives restarts).
 * - Web: stored as a data URI (blob URLs do not survive a reload).
 */
export async function pickAndStoreImage(source: PickSource): Promise<string | null> {
  const web = Platform.OS === 'web';
  if (source === 'camera' && !web) {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      throw new ImagePickError('Camera access was not allowed. You can enable it in system settings.');
    }
  }
  const options: ImagePicker.ImagePickerOptions = {
    mediaTypes: ['images'],
    allowsEditing: !web,
    aspect: [1, 1],
    quality: web ? 0.5 : 0.7,
    base64: web,
  };
  const result =
    source === 'camera'
      ? await ImagePicker.launchCameraAsync(options)
      : await ImagePicker.launchImageLibraryAsync(options);
  if (result.canceled) return null;
  const asset = result.assets[0];
  if (!asset) return null;

  if (web) {
    if (asset.base64) return `data:${asset.mimeType ?? 'image/jpeg'};base64,${asset.base64}`;
    if (asset.uri.startsWith('data:')) return asset.uri;
    throw new ImagePickError('This browser did not return image data.');
  }

  const directory = new Directory(Paths.document, IMAGE_DIR);
  if (!directory.exists) directory.create({ intermediates: true, idempotent: true });
  const extension = asset.uri.split('.').pop()?.toLowerCase();
  const safeExtension = extension && /^(jpe?g|png|webp|heic)$/.test(extension) ? extension : 'jpg';
  const destination = new File(directory, `${createId()}.${safeExtension}`);
  await new File(asset.uri).copy(destination);
  return destination.uri;
}

/** Deletes a stored photo. Only files inside the app's own image folder are ever touched. */
export function deleteStoredImage(uri: string | null | undefined): void {
  if (Platform.OS === 'web' || !isManagedImageUri(uri)) return;
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // A missing file is fine: the reference is already gone.
  }
}
