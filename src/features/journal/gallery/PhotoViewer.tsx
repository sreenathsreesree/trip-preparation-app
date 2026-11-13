import { Image } from 'expo-image';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, StyleSheet, useWindowDimensions, View, type ListViewToken } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText, Icon, IconButton } from '@/components/ui';
import { colors, spacing } from '@/theme';

import { photoDisplayDeps } from '../drive/photoDisplay';
import { resolvePhoto, resolveThumbnail } from '../drive/photoUploader';
import type { GalleryPhoto } from '../gallery';
import { ZoomableImage } from './ZoomableImage';

type Loaded =
  | { state: 'loading'; preview: string | null }
  | { state: 'ready'; uri: string }
  | { state: 'unavailable'; reason: 'offline' | 'not_uploaded'; preview: string | null };

/** Loads the full original: device copy, cached copy, or downloaded once from the user's Drive. */
function usePhotoOriginal(uri: string, accountId: string | null, active: boolean): Loaded {
  const [loaded, setLoaded] = useState<{ key: string; value: Loaded } | null>(null);
  const key = `${uri}|${accountId}`;
  useEffect(() => {
    if (!active) return;
    let live = true;
    void (async () => {
      const deps = await photoDisplayDeps(accountId);
      const thumb = await resolveThumbnail(uri, deps).catch(() => null);
      if (live) setLoaded({ key, value: { state: 'loading', preview: thumb?.uri ?? null } });
      const full = await resolvePhoto(uri, deps);
      if (!live) return;
      setLoaded({ key, value: full.uri ? { state: 'ready', uri: full.uri } : { state: 'unavailable', reason: full.reason ?? 'offline', preview: thumb?.uri ?? null } });
    })().catch(() => {
      if (live) setLoaded({ key, value: { state: 'unavailable', reason: 'offline', preview: null } });
    });
    return () => {
      live = false;
    };
  }, [uri, accountId, active, key]);
  return loaded?.key === key ? loaded.value : { state: 'loading', preview: null };
}

function Page({ photo, accountId, width, height, active, onZoomChange }: { photo: GalleryPhoto; accountId: string | null; width: number; height: number; active: boolean; onZoomChange: (z: boolean) => void }) {
  const loaded = usePhotoOriginal(photo.uri, accountId, active);
  const label = photo.caption || photo.place || `Photo from ${photo.tripName}`;
  return (
    <View style={{ width, height }} testID={`viewer-page-${photo.key}`}>
      {loaded.state === 'ready' ? (
        <ZoomableImage uri={loaded.uri} width={width} height={height} label={label} onZoomChange={onZoomChange} />
      ) : (
        <View style={[styles.center, { width, height }]}>
          {loaded.preview ? <Image source={{ uri: loaded.preview }} style={StyleSheet.absoluteFill} contentFit="contain" blurRadius={loaded.state === 'loading' ? 0 : 2} /> : null}
          {loaded.state === 'loading' ? (
            <ActivityIndicator color={colors.textPrimary} accessibilityLabel="Loading the original photo" />
          ) : (
            <View style={styles.notice} testID="viewer-unavailable">
              <Icon name={loaded.reason === 'offline' ? 'cloud-off-outline' : 'image-broken-variant'} size={28} color={colors.textPrimary} />
              <AppText variant="body" style={styles.light}>
                {loaded.reason === 'offline' ? 'The original is in your Google Drive. Connect to the internet to view it.' : 'This photo is no longer on this device and was never uploaded.'}
              </AppText>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

/**
 * Full-screen viewer over the gallery (no separate page): swipe between the
 * photos in the gallery's order, pinch or double-tap to zoom, pan while
 * zoomed. Back / close returns to the grid where it was.
 */
export function PhotoViewer({ photos, index, accountId, onClose }: { photos: GalleryPhoto[]; index: number | null; accountId: string | null; onClose: () => void }) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [current, setCurrent] = useState(index ?? 0);
  const [zoomed, setZoomed] = useState(false);
  const [opened, setOpened] = useState(index);
  if (index !== opened) {
    setOpened(index);
    if (index !== null) setCurrent(index);
    setZoomed(false);
  }
  const onViewable = useCallback(({ viewableItems }: { viewableItems: ListViewToken[] }) => {
    const first = viewableItems[0];
    if (first?.index != null) {
      setCurrent(first.index);
      setZoomed(false);
    }
  }, []);
  const photo = photos[current];

  return (
    <Modal visible={index !== null} animationType="fade" onRequestClose={onClose} statusBarTranslucent transparent={false}>
      <GestureHandlerRootView style={styles.root}>
        <View style={styles.root} testID="photo-viewer">
          {index !== null ? (
            <FlatList
              data={photos}
              horizontal
              pagingEnabled
              scrollEnabled={!zoomed}
              initialScrollIndex={index}
              getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
              keyExtractor={(p) => p.key}
              onViewableItemsChanged={onViewable}
              viewabilityConfig={{ itemVisiblePercentThreshold: 60 }}
              showsHorizontalScrollIndicator={false}
              windowSize={3}
              initialNumToRender={1}
              maxToRenderPerBatch={2}
              renderItem={({ item, index: i }) => (
                <Page photo={item} accountId={accountId} width={width} height={height} active={Math.abs(i - current) <= 1} onZoomChange={setZoomed} />
              )}
            />
          ) : null}
          <View style={[styles.top, { paddingTop: insets.top + spacing.xs }]} pointerEvents="box-none">
            <IconButton icon="close" accessibilityLabel="Close photo" onPress={onClose} testID="viewer-close" />
            <AppText variant="bodyStrong" style={styles.light} testID="viewer-counter">
              {photos.length ? `${current + 1} / ${photos.length}` : ''}
            </AppText>
            <View style={styles.spacer} />
          </View>
          {photo ? (
            <View style={[styles.bottom, { paddingBottom: insets.bottom + spacing.sm }]} pointerEvents="none">
              <AppText variant="bodyStrong" style={styles.light} numberOfLines={1}>
                {photo.caption || photo.place || photo.tripName}
              </AppText>
              <AppText variant="caption" style={styles.dim}>
                {[photo.tripName, photo.date].join(' · ')}
              </AppText>
            </View>
          ) : null}
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.photoBackdrop,
  },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  notice: {
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.xl,
    borderRadius: 12,
    backgroundColor: colors.photoChrome,
  },
  light: {
    color: colors.textPrimary,
    textAlign: 'center',
  },
  dim: {
    color: colors.textSecondary,
  },
  top: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.sm,
    backgroundColor: colors.photoChrome,
  },
  spacer: {
    width: 44,
  },
  bottom: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    gap: 2,
    backgroundColor: colors.photoChrome,
  },
});
