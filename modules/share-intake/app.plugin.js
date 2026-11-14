/**
 * Adds a text/plain ACTION_SEND intent filter to MainActivity so Trip Prep
 * appears in Android's share sheet (Google Maps → Share → Trip Prep).
 */
const { withAndroidManifest, AndroidConfig } = require('expo/config-plugins');

function addShareFilter(androidManifest) {
  const activity = AndroidConfig.Manifest.getMainActivityOrThrow(androidManifest);
  activity['intent-filter'] = activity['intent-filter'] ?? [];
  const exists = activity['intent-filter'].some((f) =>
    (f.action ?? []).some((a) => a.$['android:name'] === 'android.intent.action.SEND'),
  );
  if (!exists) {
    activity['intent-filter'].push({
      action: [{ $: { 'android:name': 'android.intent.action.SEND' } }],
      category: [{ $: { 'android:name': 'android.intent.category.DEFAULT' } }],
      data: [{ $: { 'android:mimeType': 'text/plain' } }],
    });
  }
  return androidManifest;
}

module.exports = function withShareIntake(config) {
  return withAndroidManifest(config, (mod) => {
    mod.modResults = addShareFilter(mod.modResults);
    return mod;
  });
};
module.exports.addShareFilter = addShareFilter;
