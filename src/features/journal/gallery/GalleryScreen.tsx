import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { FlatList, StyleSheet, useWindowDimensions, View } from 'react-native';

import { Screen } from '@/components/layout/Screen';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { AppText, EmptyState, ErrorState, LoadingState, SegmentedControl } from '@/components/ui';
import { getRepositories } from '@/db/repositories';
import { useAuthStore } from '@/features/auth/authStore';
import { toErrorMessage } from '@/lib/errors';
import { spacing } from '@/theme';

import { galleryColumns, galleryRows, groupGallery, type GalleryPhoto, type GalleryRow } from '../gallery';
import { GalleryThumb } from './GalleryThumb';
import { PhotoViewer } from './PhotoViewer';

const GAP = 3;
type Grouping = 'trip' | 'day';

/**
 * The account's journal and Memories photos as a phone-style gallery: a
 * thumbnail grid grouped by trip (or by day), and a full-screen viewer over
 * it. `tripId` limits it to one trip. The grid stays mounted under the viewer,
 * so closing it returns to the same scroll position.
 */
export function GalleryScreen({ tripId }: { tripId?: string }) {
  const accountId = useAuthStore((s) => s.user?.id ?? null);
  const [photos, setPhotos] = useState<GalleryPhoto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [grouping, setGrouping] = useState<Grouping>('trip');
  const [width, setWidth] = useState(0);
  const [open, setOpen] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const { gallery } = await getRepositories();
      setPhotos(await gallery.list(tripId));
      setError(null);
    } catch (e) {
      setError(toErrorMessage(e, 'Could not load your photos.'));
    }
  }, [tripId]);
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const sections = useMemo(() => groupGallery(photos ?? [], { byDate: grouping === 'day' }), [photos, grouping]);
  // The viewer swipes through the photos in exactly the order shown.
  const ordered = useMemo(() => sections.flatMap((s) => s.photos), [sections]);
  // Column count follows the screen (phone vs tablet); cell size fills the content width.
  const { width: screenWidth } = useWindowDimensions();
  const columns = galleryColumns(screenWidth);
  const cell = width > 0 ? Math.floor((width - GAP * (columns - 1)) / columns) : 0;
  const rows = useMemo(() => galleryRows(sections, columns), [sections, columns]);
  const title = tripId ? (photos?.[0]?.tripName ?? 'Trip photos') : 'Memories';

  const renderRow = useCallback(
    ({ item }: { item: GalleryRow }) =>
      item.kind === 'header' ? (
        <View style={styles.header}>
          <AppText variant="h3" numberOfLines={1}>
            {item.title}
          </AppText>
          <AppText variant="caption" tone="textMuted">
            {item.subtitle}
          </AppText>
        </View>
      ) : (
        <View style={styles.row}>
          {item.photos.map(({ photo, index }) => (
            <GalleryThumb
              key={photo.key}
              uri={photo.uri}
              accountId={accountId}
              size={cell}
              label={`${photo.caption || photo.place || 'Photo'}, ${photo.tripName}, ${photo.date}`}
              onPress={() => setOpen(index)}
              testID={`gallery-photo-${index}`}
            />
          ))}
        </View>
      ),
    [accountId, cell],
  );

  return (
    <Screen scroll={false} testID="gallery-screen">
      <ScreenHeader title={title} eyebrow={tripId ? 'Photos' : 'All trips'} showBack />
      {error ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : photos === null ? (
        <LoadingState label="Loading your photos…" />
      ) : photos.length === 0 ? (
        <EmptyState
          icon="image-multiple-outline"
          title="No photos yet"
          message="Photos you add to journal entries or to a destination’s Memories appear here."
          testID="gallery-empty"
        />
      ) : (
        <View style={styles.flex} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
          <SegmentedControl
            options={[
              { value: 'trip', label: 'By trip' },
              { value: 'day', label: 'By day' },
            ]}
            value={grouping}
            onChange={setGrouping}
            accessibilityLabel="Group photos"
          />
          {width > 0 ? (
            <FlatList
              data={rows}
              keyExtractor={(r) => r.key}
              renderItem={renderRow}
              style={styles.flex}
              contentContainerStyle={styles.list}
              initialNumToRender={8}
              windowSize={7}
              removeClippedSubviews
              testID="gallery-grid"
            />
          ) : null}
        </View>
      )}
      <PhotoViewer photos={ordered} index={open} accountId={accountId} onClose={() => setOpen(null)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
    gap: spacing.md,
  },
  list: {
    paddingBottom: spacing.huge,
    gap: GAP,
  },
  header: {
    paddingTop: spacing.lg,
    paddingBottom: spacing.xs,
    gap: 2,
  },
  row: {
    flexDirection: 'row',
    gap: GAP,
  },
});
