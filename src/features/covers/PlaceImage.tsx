import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui';
import { getRepositories } from '@/db/repositories';
import { colors, spacing } from '@/theme';

import type { GeoPoint } from '../planner/model';
import { cachedFetch } from '../remote/remoteCacheRepository';
import { findCover, type CoverImage } from './wikimedia';

const MONTH_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * A photo for a recommended place, only when OpenStreetMap links it to its
 * exact Wikipedia article (so it is the right place), with credit and licence.
 * Cached for a month; nothing is shown when there is no free photo.
 */
export function PlaceImage({ wikipedia, name, location }: { wikipedia: string; name: string; location: GeoPoint | null }) {
  const [image, setImage] = useState<{ key: string; value: CoverImage | null } | null>(null);
  useEffect(() => {
    let live = true;
    void getRepositories()
      .then(({ remoteCache }) =>
        cachedFetch(remoteCache, { key: `placeimage:${wikipedia}`, kind: 'cover', source: 'Wikimedia Commons', maxAgeMs: MONTH_MS, now: new Date() }, () =>
          findCover({ name, context: '', location, wikipedia }, { fetchImpl: (...a) => fetch(...a) }),
        ),
      )
      .then((r) => live && setImage({ key: wikipedia, value: r.payload }))
      .catch(() => live && setImage({ key: wikipedia, value: null }));
    return () => {
      live = false;
    };
  }, [wikipedia, name, location]);
  const value = image?.key === wikipedia ? image.value : null;
  if (!value) return null;
  return (
    <View>
      <Image source={{ uri: value.imageUrl }} style={styles.photo} contentFit="cover" accessibilityLabel={`Photo of ${name}`} cachePolicy="memory-disk" />
      <AppText variant="caption" tone="textMuted" style={styles.credit} numberOfLines={1}>
        Photo: {value.credit} · {value.license} · Wikimedia Commons
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  photo: { width: '100%', height: 150, backgroundColor: colors.surfaceRaised },
  credit: { paddingHorizontal: spacing.md, paddingTop: spacing.xxs },
});
