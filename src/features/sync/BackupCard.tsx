import { StyleSheet, View } from 'react-native';

import { AppText, Button, Card, Icon, Notice } from '@/components/ui';
import { useAuthStore } from '@/features/auth/authStore';
import { colors, spacing } from '@/theme';

import { useSyncStore } from './syncStore';

const time = (iso: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'never');

/** Cloud backup status on the Profile screen (signed-in builds with the Trip Prep cloud only). */
export function BackupCard() {
  const s = useSyncStore();
  const email = useAuthStore((a) => a.user?.email ?? 'your account');
  if (s.phase === 'unavailable') return null;

  if (s.phase === 'needs_choice') {
    const d = s.deviceSummary;
    return (
      <Card testID="backup-adopt">
        <View style={styles.group}>
          <AppText variant="title">Back up this phone’s trips?</AppText>
          <AppText variant="body" tone="textSecondary">
            This phone has {d?.trips ?? 0} trip(s){d?.journalEntries ? `, ${d.journalEntries} journal entries` : ''}
            {d?.expenses ? `, ${d.expenses} expenses` : ''}. Keep them in {email} so they are safe and appear on your other phones. Nothing on this phone is
            changed or removed; anything already in your account is added alongside.
          </AppText>
          <Button label="Back up to my account" icon="cloud-upload-outline" onPress={() => void s.adoptDeviceData()} testID="backup-adopt-yes" />
          <AppText variant="caption" tone="textMuted">
            Until you choose, nothing is uploaded.
          </AppText>
        </View>
      </Card>
    );
  }

  if (s.phase === 'other_account') {
    return (
      <Notice
        tone="warning"
        icon="account-alert-outline"
        title="This phone’s trips belong to another Google account"
        message="Sign in with that account to back up and sync. Nothing is mixed between accounts."
        testID="backup-other-account"
      />
    );
  }

  const r = s.lastResult;
  const unsupported = r?.unsupportedTables.length ?? 0;
  return (
    <Card testID="backup-card">
      <View style={styles.group}>
        <View style={styles.inline}>
          <Icon name={s.error || s.conflicts ? 'cloud-alert' : 'cloud-check-outline'} size={22} color={s.error || s.conflicts ? colors.warning : colors.accent} />
          <AppText variant="title" style={styles.flex}>
            Cloud backup
          </AppText>
        </View>
        <AppText variant="body" tone="textSecondary" testID="backup-status">
          {s.running
            ? 'Backing up…'
            : s.pending === 0
              ? `Everything is backed up · ${time(s.lastSyncAt)}`
              : s.pending
                ? `${s.pending} change(s) waiting · last backup ${time(s.lastSyncAt)}`
                : `Last backup ${time(s.lastSyncAt)}`}
        </AppText>
        {s.photosNotInDrive > 0 ? (
          <AppText variant="caption" tone="textMuted">
            {s.photosNotInDrive} photo(s) are only on this phone. Connect Google Drive in a trip’s journal to include them.
          </AppText>
        ) : null}
        {unsupported > 0 ? (
          <AppText variant="caption" tone="textMuted" testID="backup-partial">
            Journal, memories, destination details and the trip calculator will be included once the backup update is switched on in the Trip Prep cloud.
          </AppText>
        ) : null}
        {s.conflicts > 0 ? (
          <View style={styles.group} testID="backup-conflicts">
            <AppText variant="bodyStrong" tone="warning">
              {s.conflicts} record(s) were changed on this phone and another one. Nothing was overwritten. Choose which to keep:
            </AppText>
            <View style={styles.row}>
              <Button label="Keep this phone’s" size="sm" variant="secondary" onPress={() => void s.resolve('keep_device')} testID="backup-keep-device" />
              <Button label="Use the cloud’s" size="sm" variant="secondary" onPress={() => void s.resolve('use_cloud')} testID="backup-use-cloud" />
            </View>
          </View>
        ) : null}
        {s.error ? <Notice tone="warning" title={s.error} testID="backup-error" /> : null}
        <Button label="Back up now" icon="cloud-sync-outline" variant="secondary" size="sm" loading={s.running} onPress={() => void s.syncNow()} style={styles.left} testID="backup-now" />
        <AppText variant="caption" tone="textMuted">
          Backs up and restores automatically while the app is open. Changes reach your other phones the next time they back up — this is not live, real-time sync.
        </AppText>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  group: { gap: spacing.sm },
  inline: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  flex: { flex: 1 },
  left: { alignSelf: 'flex-start' },
});
