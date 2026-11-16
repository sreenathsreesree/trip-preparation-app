import { Linking, StyleSheet, View } from 'react-native';

import { AppText, Collapsible } from '@/components/ui';
import { spacing } from '@/theme';

import { placesDiagnostics } from '../places/config';

const REASONS: Record<string, string> = {
  budget_exhausted: 'its monthly or daily limit is reached',
  disabled: 'it is switched off on the places service',
  not_configured: 'it is not set up yet',
  quota: 'Google is busy',
  network: 'the places service could not be reached',
};

/** Which place search is active, and why Google is skipped (diagnostics; no search history). */
function PlaceSearchStatus() {
  const d = placesDiagnostics();
  if (!d) return null;
  return (
    <View style={styles.item} testID="about-place-search-status">
      <AppText variant="bodyStrong">Place search now</AppText>
      <AppText variant="caption" tone="textSecondary">
        {d.active === 'google'
          ? 'Google Places (search and place details), with free map data for everything else.'
          : `Free map data — Google Places is paused because ${REASONS[d.reason?.kind ?? ''] ?? 'it is unavailable'}${d.reason?.code ? ` (${d.reason.code})` : ''}, until ${d.reason ? new Date(d.reason.until).toLocaleTimeString() : 'later'}.`}
      </AppText>
    </View>
  );
}

const SOURCES: { title: string; text: string; url: string }[] = [
  {
    title: 'Map data',
    text: '© OpenStreetMap contributors. Available under the Open Database License (ODbL). Place search and nearby places use this data.',
    url: 'https://www.openstreetmap.org/copyright',
  },
  { title: 'Place search', text: 'Photon geocoder by komoot, using OpenStreetMap data.', url: 'https://photon.komoot.io' },
  { title: 'Road distances and times', text: 'OSRM routing, using OpenStreetMap data.', url: 'https://project-osrm.org' },
  { title: 'Weather', text: 'Open-Meteo (CC BY 4.0).', url: 'https://open-meteo.com' },
  {
    title: 'Destination photos',
    text: 'Wikipedia and Wikimedia Commons. Each photo’s author and licence are shown with the photo.',
    url: 'https://commons.wikimedia.org',
  },
];

/** Credits and licences for the free data services the app uses (required attribution lives here). */
export function DataSources() {
  return (
    <Collapsible title="Data sources & licences" icon="information-outline" summary="Map data © OpenStreetMap contributors and others" testID="about-data-sources">
      <PlaceSearchStatus />
      {SOURCES.map((s) => (
        <View key={s.title} style={styles.item}>
          <AppText variant="bodyStrong">{s.title}</AppText>
          <AppText variant="caption" tone="textSecondary">
            {s.text}
          </AppText>
          <AppText variant="caption" tone="info" accessibilityRole="link" onPress={() => void Linking.openURL(s.url)}>
            {s.url.replace(/^https:\/\//, '')}
          </AppText>
        </View>
      ))}
    </Collapsible>
  );
}

const styles = StyleSheet.create({
  item: { gap: spacing.xxs },
});
