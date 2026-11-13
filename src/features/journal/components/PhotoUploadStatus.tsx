import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText, Button, Icon } from '@/components/ui';
import { useAuthStore } from '@/features/auth/authStore';
import { colors, spacing } from '@/theme';

import { driveConnection, isDriveConfigured } from '../drive/driveAuth';
import { usePhotoUploadStore } from '../drive/photoUploadStore';

/** One line about where selected photos go: the user's Google Drive, with progress and retry. */
export function PhotoUploadStatus({ tripId }: { tripId: string }) {
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const { counts, running, paused, autoUpload, version } = usePhotoUploadStore();
  const [connected, setConnected] = useState<{ key: string; value: boolean } | null>(null);
  const key = `${userId}|${version}`;
  useEffect(() => {
    let live = true;
    void driveConnection(userId).then((c) => {
      if (live) setConnected({ key, value: c !== null });
    });
    return () => {
      live = false;
    };
  }, [userId, key]);

  if (!isDriveConfigured()) {
    return (
      <AppText variant="caption" tone="textMuted" testID="photo-upload-status">
        Photos are kept on this device. Google Drive upload isn’t set up yet.
      </AppText>
    );
  }
  if (!userId || connected?.value === false) {
    return (
      <View style={styles.row} testID="photo-upload-status">
        <AppText variant="caption" tone="textMuted" style={styles.flex}>
          Connect Google Drive to upload photos to your own Drive automatically.
        </AppText>
        <Button label="Set up" variant="ghost" size="sm" onPress={() => router.push({ pathname: '/trips/[tripId]/journal', params: { tripId } })} />
      </View>
    );
  }
  const text = !autoUpload
    ? 'Automatic upload is off.'
    : paused === 'auth'
      ? 'Google Drive connection expired — reconnect in the journal to continue uploading.'
      : paused === 'offline'
        ? `Waiting for internet · ${counts.pending} photo(s) will upload when you’re back online.`
      : paused
        ? 'Uploads are paused: Google Drive isn’t available.'
        : running || counts.pending > 0
          ? `Uploading to your Google Drive · ${counts.pending} waiting`
          : counts.failed > 0
            ? `${counts.failed} photo(s) didn’t upload.`
            : 'Photos are saved in your Google Drive.';
  return (
    <View style={styles.row} testID="photo-upload-status">
      <Icon name={counts.failed || paused ? 'cloud-alert' : counts.pending ? 'cloud-upload-outline' : 'cloud-check-outline'} size={16} color={counts.failed || paused ? colors.warning : colors.accent} />
      <AppText variant="caption" tone="textSecondary" style={styles.flex}>
        {text}
      </AppText>
      {counts.failed > 0 || (paused && paused !== 'auth' && paused !== 'offline') ? (
        <Button label="Retry" variant="ghost" size="sm" onPress={() => void usePhotoUploadStore.getState().retry()} testID="photo-upload-retry" />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  flex: {
    flex: 1,
  },
});
