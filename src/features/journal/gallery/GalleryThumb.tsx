import { Image } from 'expo-image';
import { memo, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Icon } from '@/components/ui';
import { colors } from '@/theme';

import { photoDisplayDeps } from '../drive/photoDisplay';
import { resolveThumbnail, type ThumbnailResult } from '../drive/photoUploader';

/**
 * One grid cell. Shows the device copy (expo-image decodes it at cell size and
 * caches it) or Drive's small preview; never downloads the original. A small
 * cloud mark says the original is only in Drive (not viewable offline).
 */
export const GalleryThumb = memo(function GalleryThumb({
  uri,
  accountId,
  size,
  label,
  onPress,
  testID,
}: {
  uri: string;
  accountId: string | null;
  size: number;
  label: string;
  onPress: () => void;
  testID?: string;
}) {
  const [result, setResult] = useState<{ key: string; value: ThumbnailResult } | null>(null);
  const key = `${uri}|${accountId}`;
  useEffect(() => {
    let live = true;
    void photoDisplayDeps(accountId)
      .then((deps) => resolveThumbnail(uri, deps))
      .then((value) => {
        if (live) setResult({ key, value });
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [uri, accountId, key]);
  const current = result?.key === key ? result.value : null;
  // Until resolved, a device path is shown directly (the common case).
  const shown = current ? current.uri : uri.startsWith('file:') || uri.startsWith('data:') ? uri : null;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="imagebutton"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.cell, { width: size, height: size }, pressed && styles.pressed]}
      testID={testID}
    >
      {shown ? (
        <Image source={{ uri: shown }} style={StyleSheet.absoluteFill} contentFit="cover" recyclingKey={uri} cachePolicy="memory-disk" transition={120} />
      ) : (
        <View style={styles.placeholder}>
          <Icon name={current?.original === 'missing_in_drive' || current?.original === 'not_uploaded' ? 'image-broken-variant' : 'image-outline'} size={22} color={colors.textMuted} />
        </View>
      )}
      {current && !current.offline && current.original === 'in_drive' ? (
        <View style={styles.mark} accessibilityLabel="Original in Google Drive" testID={testID ? `${testID}-cloud` : undefined}>
          <Icon name="cloud-outline" size={12} color={colors.textPrimary} />
        </View>
      ) : null}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  cell: {
    overflow: 'hidden',
    backgroundColor: colors.surfaceRaised,
  },
  pressed: {
    opacity: 0.8,
  },
  placeholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mark: {
    position: 'absolute',
    right: 4,
    bottom: 4,
    borderRadius: 999,
    padding: 3,
    backgroundColor: colors.photoBadge,
  },
});
