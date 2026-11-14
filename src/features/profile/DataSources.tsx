import { Linking, StyleSheet, View } from 'react-native';

import { AppText, Collapsible } from '@/components/ui';
import { spacing } from '@/theme';

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
