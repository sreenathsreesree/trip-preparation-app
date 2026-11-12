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

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Base64 → bytes without depending on atob (not available everywhere). */
export function base64ToBytes(base64: string): Uint8Array {
  const clean = base64.replace(/[^A-Za-z0-9+/]/g, '');
  const bytes = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let buffer = 0;
  let bits = 0;
  let index = 0;
  for (const char of clean) {
    buffer = (buffer << 6) | BASE64.indexOf(char);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[index++] = (buffer >> bits) & 0xff;
    }
  }
  return bytes.subarray(0, index);
}

export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] as number;
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    out += BASE64[a >> 2];
    out += BASE64[((a & 3) << 4) | ((b ?? 0) >> 4)];
    out += b === undefined ? '=' : BASE64[((b & 15) << 2) | ((c ?? 0) >> 6)];
    out += c === undefined ? '=' : BASE64[c & 63];
  }
  return out;
}

/** Bytes and type of a stored photo (app copy or web data URI), for backups. */
export async function readImageBytes(uri: string): Promise<{ bytes: Uint8Array; mimeType: string }> {
  const data = /^data:([^;,]+);base64,(.*)$/s.exec(uri);
  if (data) return { mimeType: data[1] as string, bytes: base64ToBytes(data[2] as string) };
  const extension = uri.split('.').pop()?.toLowerCase() ?? 'jpg';
  const mimeType = extension === 'png' ? 'image/png' : extension === 'webp' ? 'image/webp' : extension === 'heic' ? 'image/heic' : 'image/jpeg';
  return { bytes: await new File(uri).bytes(), mimeType };
}

/** Stores downloaded photo bytes as an app-owned image (restore from a backup). */
export async function saveImageBytes(bytes: Uint8Array, mimeType: string): Promise<string> {
  if (Platform.OS === 'web') return `data:${mimeType};base64,${bytesToBase64(bytes)}`;
  const directory = new Directory(Paths.document, IMAGE_DIR);
  if (!directory.exists) directory.create({ intermediates: true, idempotent: true });
  const extension = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : mimeType === 'image/heic' ? 'heic' : 'jpg';
  const file = new File(directory, `${createId()}.${extension}`);
  await file.write(bytes);
  return file.uri;
}

/** Whether a stored photo is still on this device (data URIs are always present). */
export function imageExists(uri: string): boolean {
  if (!uri.startsWith('file:')) return true;
  try {
    return new File(uri).exists;
  } catch {
    return false;
  }
}
