import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { AppText, Icon } from '@/components/ui';
import { getRepositories } from '@/db/repositories';
import { useAuthStore } from '@/features/auth/authStore';
import { imageExists, saveImageBytes } from '@/lib/imageStore';
import { colors, radii, spacing, withAlpha } from '@/theme';

import { driveToken } from '../drive/driveAuth';
import { createDriveClient } from '../drive/driveClient';
import type { UploadStatus } from '../drive/photoUploadRepository';
import { resolvePhoto } from '../drive/photoUploader';
import { usePhotoUploadStore } from '../drive/photoUploadStore';

const BADGES: Record<UploadStatus, { icon: 'cloud-check-outline' | 'cloud-upload-outline' | 'cloud-alert'; color: string; label: string }> = {
  uploaded: { icon: 'cloud-check-outline', color: colors.accent, label: 'Saved in your Google Drive' },
  pending: { icon: 'cloud-upload-outline', color: colors.info, label: 'Waiting to upload to Google Drive' },
  failed: { icon: 'cloud-alert', color: colors.warning, label: 'Upload to Google Drive failed' },
};

/**
 * A memory or journal photo: the device copy when present, otherwise the
 * original from the user's Google Drive (downloaded once and cached), with a
 * small badge for its Drive upload state.
 */
export function DrivePhoto({ uri, style, label, testID }: { uri: string; style: StyleProp<ViewStyle>; label: string; testID?: string }) {
  const accountId = useAuthStore((s) => s.user?.id ?? null);
  const version = usePhotoUploadStore((s) => s.version);
  const [state, setState] = useState<{ key: string; shown: string | null; status: UploadStatus | null; missing: boolean } | null>(null);
  const key = `${uri}|${accountId}|${version}`;

  useEffect(() => {
    let live = true;
    void (async () => {
      const { photoUploads } = await getRepositories();
      const row = accountId ? (await photoUploads.byUris(accountId, [uri])).get(uri) : undefined;
      const resolved = await resolvePhoto(uri, {
        uploads: photoUploads,
        exists: imageExists,
        savePhoto: saveImageBytes,
        client: accountId ? createDriveClient(() => driveToken(accountId)) : null,
      });
      if (live) setState({ key, shown: resolved.uri, status: row?.status ?? null, missing: resolved.uri === null });
    })();
    return () => {
      live = false;
    };
  }, [uri, accountId, key]);

  const current = state?.key === key ? state : null;
  // Until resolved, show the device copy directly (the common case).
  const shown = current ? current.shown : uri;
  const badge = current?.status ? BADGES[current.status] : null;

  return (
    <View style={[styles.frame, style]} testID={testID}>
      {shown ? (
        <Image source={{ uri: shown }} style={StyleSheet.absoluteFill} contentFit="cover" accessibilityLabel={label} />
      ) : (
        <View style={styles.missing} accessibilityLabel={`${label}: in your Google Drive`}>
          <Icon name="google-drive" size={20} color={colors.textMuted} />
          <AppText variant="caption" tone="textMuted" style={styles.center}>
            In Drive — connect to view
          </AppText>
        </View>
      )}
      {badge ? (
        <View style={styles.badge} accessibilityLabel={badge.label} testID={testID ? `${testID}-${current?.status}` : undefined}>
          <Icon name={badge.icon} size={14} color={badge.color} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    overflow: 'hidden',
    borderRadius: radii.md,
    backgroundColor: colors.surfaceRaised,
  },
  missing: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xxs,
    padding: spacing.xs,
  },
  center: {
    textAlign: 'center',
  },
  badge: {
    position: 'absolute',
    left: spacing.xxs,
    bottom: spacing.xxs,
    borderRadius: radii.pill,
    padding: 3,
    backgroundColor: withAlpha('#0E1318', 0.75),
  },
});
