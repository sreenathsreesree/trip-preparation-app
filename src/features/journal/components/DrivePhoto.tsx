import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { AppText, Icon } from '@/components/ui';
import { getDatabase } from '@/db/client';
import { getRepositories } from '@/db/repositories';
import { useAuthStore } from '@/features/auth/authStore';
import { imageExists, saveImageBytes } from '@/lib/imageStore';
import { colors, radii, spacing, withAlpha } from '@/theme';
import type { IconName } from '@/theme/icons';

import { driveToken } from '../drive/driveAuth';
import { createDriveClient } from '../drive/driveClient';
import type { PhotoUpload } from '../drive/photoUploadRepository';
import { resolvePhoto, uploadDisplayState, UPLOAD_STATE_LABELS, type UploadDisplayState } from '../drive/photoUploader';
import { usePhotoUploadStore } from '../drive/photoUploadStore';

const BADGES: Record<UploadDisplayState, { icon: IconName; color: string }> = {
  uploaded: { icon: 'cloud-check-outline', color: colors.accent },
  uploading: { icon: 'cloud-sync-outline', color: colors.info },
  queued: { icon: 'cloud-upload-outline', color: colors.info },
  retry_scheduled: { icon: 'cloud-refresh', color: colors.info },
  waiting_internet: { icon: 'cloud-off-outline', color: colors.textMuted },
  waiting_drive: { icon: 'cloud-upload-outline', color: colors.textMuted },
  needs_reconnect: { icon: 'cloud-lock-outline', color: colors.warning },
  failed: { icon: 'cloud-alert', color: colors.warning },
};

/**
 * A memory or journal photo: the device copy when present, otherwise the
 * original from the user's Google Drive (downloaded once and cached), with a
 * small badge for its Drive upload state.
 */
export function DrivePhoto({ uri, style, label, testID }: { uri: string; style: StyleProp<ViewStyle>; label: string; testID?: string }) {
  const accountId = useAuthStore((s) => s.user?.id ?? null);
  const version = usePhotoUploadStore((s) => s.version);
  const [state, setState] = useState<{ key: string; shown: string | null; row: PhotoUpload | null; missing: boolean } | null>(null);
  const paused = usePhotoUploadStore((s) => s.paused);
  const uploadingId = usePhotoUploadStore((s) => s.uploadingId);
  const key = `${uri}|${accountId}|${version}`;

  useEffect(() => {
    let live = true;
    void (async () => {
      const { photoUploads } = await getRepositories();
      const db = await getDatabase();
      const row = accountId ? (await photoUploads.byUris(accountId, [uri])).get(uri) : undefined;
      const resolved = await resolvePhoto(uri, {
        uploads: photoUploads,
        exists: imageExists,
        savePhoto: saveImageBytes,
        client: accountId ? createDriveClient(() => driveToken(accountId)) : null,
        driveCache: {
          get: async (fileId) => (await db.getFirstAsync<{ local_uri: string }>('SELECT local_uri FROM drive_cache WHERE drive_file_id = ?', [fileId]))?.local_uri ?? null,
          set: async (fileId, local) => {
            await db.runAsync(
              'INSERT INTO drive_cache (drive_file_id, local_uri, cached_at) VALUES (?, ?, ?) ON CONFLICT (drive_file_id) DO UPDATE SET local_uri = excluded.local_uri, cached_at = excluded.cached_at',
              [fileId, local, new Date().toISOString()],
            );
          },
        },
      });
      if (live) setState({ key, shown: resolved.uri, row: row ?? null, missing: resolved.uri === null });
    })();
    return () => {
      live = false;
    };
  }, [uri, accountId, key]);

  const current = state?.key === key ? state : null;
  // Until resolved, show the device copy directly (the common case).
  const shown = current ? current.shown : uri.startsWith('drive:') ? null : uri;
  // Rows exist only once Drive is connected; the state is derived, never stored.
  const display = current?.row ? uploadDisplayState(current.row, { driveConnected: true, paused, uploadingId, now: new Date() }) : null;
  const badge = display ? { ...BADGES[display], label: UPLOAD_STATE_LABELS[display] } : null;

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
        <View style={styles.badge} accessibilityLabel={badge.label} testID={testID ? `${testID}-${current?.row?.status}` : undefined}>
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
