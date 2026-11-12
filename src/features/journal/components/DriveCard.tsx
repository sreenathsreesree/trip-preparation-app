import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText, Button, Card, Icon, Notice, ProgressBar } from '@/components/ui';
import { colors, radii, spacing } from '@/theme';

import { useAuthStore } from '../../auth/authStore';
import { useDriveStatus, useDriveStore } from '../drive/driveStore';

/** Optional backup of this trip's journal to the user's own Google Drive. */
export function DriveCard({ trip }: { trip: { id: string; name: string; startDate: string } }) {
  const status = useDriveStatus();
  const s = useDriveStore();
  const userId = useAuthStore((a) => a.user?.id ?? null);
  const [choosing, setChoosing] = useState(false);
  useEffect(() => {
    void useDriveStore.getState().refresh();
  }, [userId]);

  if (status === 'unconfigured') {
    return (
      <Notice
        tone="info"
        icon="google-drive"
        title="Google Drive backup isn’t set up yet"
        message="Your journal is saved on this device and works offline."
        testID="journal-drive-off"
      />
    );
  }
  if (status === 'signedOut') {
    return (
      <Notice
        tone="info"
        icon="google-drive"
        title="Back up to your Google Drive"
        message="Sign in with Google to keep a copy of your journal and photos in your own Drive."
        action={{ label: 'Sign in', icon: 'login', onPress: () => router.push('/auth/sign-in') }}
        testID="journal-drive-signin"
      />
    );
  }

  const lastBackup = s.lastBackup?.tripId === trip.id ? s.lastBackup : null;
  const lastRestore = s.lastRestore?.tripId === trip.id ? s.lastRestore : null;

  return (
    <Card testID="journal-drive">
      <View style={styles.head}>
        <Icon name="google-drive" size={22} color={colors.accent} />
        <View style={styles.flex}>
          <AppText variant="title">Google Drive backup</AppText>
          <AppText variant="caption" tone="textMuted">
            {status === 'disconnected'
              ? 'Keep a copy in your own Drive. Trip Prep can only see the files it creates there.'
              : `Connected${s.connection?.email ? ` as ${s.connection.email}` : ''}`}
          </AppText>
        </View>
      </View>

      {status === 'disconnected' || status === 'expired' ? (
        <Button
          label={status === 'expired' ? 'Reconnect Google Drive' : 'Connect Google Drive'}
          icon="link-variant"
          size="sm"
          loading={s.busy === 'connect'}
          onPress={() => void s.connect()}
          style={styles.left}
          testID="journal-drive-connect"
        />
      ) : (
        <View style={styles.row}>
          <Button label="Back up now" icon="cloud-upload-outline" size="sm" loading={s.busy === 'backup'} disabled={!!s.busy} onPress={() => void s.backup(trip)} testID="journal-drive-backup" />
          <Button
            label="Restore"
            icon="cloud-download-outline"
            variant="secondary"
            size="sm"
            disabled={!!s.busy}
            loading={s.busy === 'list'}
            onPress={() => {
              setChoosing(true);
              void s.loadBackups();
            }}
            testID="journal-drive-restore"
          />
          <Button label="Disconnect" variant="ghost" size="sm" disabled={!!s.busy} onPress={() => void s.disconnect()} testID="journal-drive-disconnect" />
        </View>
      )}

      {s.progress ? <ProgressBar value={s.progress.total ? s.progress.done / s.progress.total : 0} accessibilityLabel="Google Drive progress" /> : null}

      {choosing && s.backups && status === 'connected' ? (
        <View style={styles.list} testID="journal-drive-backups">
          {s.backups.length === 0 ? (
            <AppText variant="caption" tone="textMuted">
              No journal backups in your Drive yet.
            </AppText>
          ) : (
            <>
              <AppText variant="caption" tone="textMuted">
                Restoring adds entries and photos that aren’t on this device. Nothing here is changed or removed.
              </AppText>
              {s.backups.map((b) => (
                <Pressable
                  key={b.fileId}
                  accessibilityRole="button"
                  onPress={() => {
                    setChoosing(false);
                    void s.restore(trip.id, b.fileId);
                  }}
                  style={({ pressed }) => [styles.backup, pressed && styles.pressed]}
                  testID={`journal-drive-backup-${b.tripName}`}
                >
                  <Icon name="book-open-page-variant-outline" size={20} color={colors.textSecondary} />
                  <View style={styles.flex}>
                    <AppText variant="bodyStrong">{b.tripName}</AppText>
                    {b.modifiedTime ? (
                      <AppText variant="caption" tone="textMuted">
                        Backed up {b.modifiedTime.slice(0, 10)}
                      </AppText>
                    ) : null}
                  </View>
                </Pressable>
              ))}
            </>
          )}
          <Button label="Cancel" variant="ghost" size="sm" onPress={() => setChoosing(false)} style={styles.left} />
        </View>
      ) : null}

      {lastBackup ? (
        <AppText variant="caption" tone="textSecondary" testID="journal-drive-result">
          Backed up · {lastBackup.photosUploaded} new {lastBackup.photosUploaded === 1 ? 'photo' : 'photos'}
          {lastBackup.journalUploaded ? ', journal updated' : ', journal unchanged'}
          {lastBackup.photosMissing ? ` · ${lastBackup.photosMissing} photo(s) couldn’t be read on this device` : ''}
        </AppText>
      ) : null}
      {lastRestore ? (
        <AppText variant="caption" tone="textSecondary" testID="journal-drive-restored">
          Restored {lastRestore.entriesAdded} {lastRestore.entriesAdded === 1 ? 'entry' : 'entries'} and {lastRestore.photosAdded}{' '}
          {lastRestore.photosAdded === 1 ? 'photo' : 'photos'}
          {lastRestore.conflicts ? ` · ${lastRestore.conflicts} edited here kept as they are` : ''}
          {lastRestore.photosMissing ? ` · ${lastRestore.photosMissing} photo(s) not found in Drive` : ''}
        </AppText>
      ) : null}
      {s.error ? <Notice tone="danger" title={s.error} testID="journal-drive-error" /> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  flex: {
    flex: 1,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  left: {
    alignSelf: 'flex-start',
  },
  list: {
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  backup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceRaised,
  },
  pressed: {
    backgroundColor: colors.surfacePressed,
  },
});
