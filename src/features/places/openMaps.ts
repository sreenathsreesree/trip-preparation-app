import { startActivityAsync } from 'expo-intent-launcher';
import { Linking, Platform } from 'react-native';

/** The Google Maps app on Android and the activity that handles `https://www.google.com/maps/…` links. */
export const GOOGLE_MAPS_PACKAGE = 'com.google.android.apps.maps';
export const GOOGLE_MAPS_ACTIVITY = 'com.google.android.maps.MapsActivity';
const FLAG_ACTIVITY_NEW_TASK = 0x10000000;

/** Whether links built for the `app` target (up to 8 waypoints) can be tried on this platform. */
export const canTargetMapsApp = Platform.OS === 'android';

/**
 * Opens a directions link in the Google Maps app itself — never a browser,
 * which would keep only 3 waypoints and silently drop the rest. Resolves false
 * when the app is missing or disabled (the caller then switches to
 * browser-sized legs). FLAG_ACTIVITY_NEW_TASK opens Maps in its own task, and
 * Android then returns a "cancelled" result at once, so the promise does not
 * wait for the user to come back.
 */
export async function openInMapsApp(url: string): Promise<boolean> {
  if (!canTargetMapsApp) return false;
  try {
    await startActivityAsync('android.intent.action.VIEW', {
      data: url,
      packageName: GOOGLE_MAPS_PACKAGE,
      className: GOOGLE_MAPS_ACTIVITY,
      flags: FLAG_ACTIVITY_NEW_TASK,
    });
    return true;
  } catch {
    return false;
  }
}

/** Opens any Maps link with the system handler (browser-sized links, single places). */
export async function openMapsUrl(url: string): Promise<void> {
  await Linking.openURL(url);
}
