import Constants from 'expo-constants';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useFocusEffect } from 'expo-router';

import { Screen } from '@/components/layout/Screen';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { AppText, Card, Icon } from '@/components/ui';
import { getRepositories } from '@/db/repositories';
import { toErrorMessage } from '@/lib/errors';
import { colors, radii, spacing } from '@/theme';

interface StorageStats {
  trips: number;
  items: number;
  templates: number;
  schemaVersion: number;
}

function InfoRow({ label, value, testID }: { label: string; value: string; testID?: string }) {
  return (
    <View style={styles.infoRow}>
      <AppText variant="body" tone="textSecondary">
        {label}
      </AppText>
      <AppText variant="bodyStrong" testID={testID}>
        {value}
      </AppText>
    </View>
  );
}

export function ProfileScreen() {
  const [stats, setStats] = useState<StorageStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Refresh whenever the tab gains focus so counts reflect recent edits.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      getRepositories()
        .then(async (repos) => {
          const [trips, items, templates, schemaVersion] = await Promise.all([
            repos.trips.count(),
            repos.countTasks(),
            repos.templates.list().then((list) => list.length),
            repos.schemaVersion(),
          ]);
          if (!cancelled) {
            setStats({ trips, items, templates, schemaVersion });
            setError(null);
          }
        })
        .catch((err: unknown) => {
          if (!cancelled) setError(toErrorMessage(err, 'Could not read local storage.'));
        });
      return () => {
        cancelled = true;
      };
    }, []),
  );

  const appVersion = Constants.expoConfig?.version ?? 'unknown';

  return (
    <Screen testID="profile-screen">
      <ScreenHeader eyebrow="Explorer" title="Profile" />

      <Card variant="accent" padding="xl">
        <View style={styles.offline}>
          <View style={styles.offlineIcon}>
            <Icon name="cloud-off-outline" tone="accent" size={24} />
          </View>
          <View style={styles.flex}>
            <AppText variant="h3">Offline-first, no account needed</AppText>
            <AppText variant="body" tone="textSecondary">
              Everything you plan is stored on this device and works without a connection.
              Accounts and sync are not part of this version.
            </AppText>
          </View>
        </View>
      </Card>

      <View style={styles.group}>
        <AppText variant="label" tone="textMuted">
          On this device
        </AppText>
        <Card>
          {error ? (
            <AppText variant="caption" tone="danger">
              {error}
            </AppText>
          ) : (
            <>
              <InfoRow label="Trips saved" value={stats ? String(stats.trips) : '…'} testID="profile-trip-count" />
              <View style={styles.divider} />
              <InfoRow label="Trip checklist tasks" value={stats ? String(stats.items) : '…'} />
              <View style={styles.divider} />
              <InfoRow label="Checklist templates" value={stats ? String(stats.templates) : '…'} />
              <View style={styles.divider} />
              <InfoRow label="Database schema" value={stats ? `v${stats.schemaVersion}` : '…'} />
            </>
          )}
        </Card>
      </View>

      <View style={styles.group}>
        <AppText variant="label" tone="textMuted">
          About
        </AppText>
        <Card>
          <InfoRow label="Version" value={appVersion} />
          <View style={styles.divider} />
          <AppText variant="caption" tone="textMuted" style={styles.tagline}>
            Nothing forgotten. Everything ready.
          </AppText>
        </Card>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  offline: {
    flexDirection: 'row',
    gap: spacing.lg,
    alignItems: 'flex-start',
  },
  offlineIcon: {
    width: 48,
    height: 48,
    borderRadius: radii.md,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flex: {
    flex: 1,
    gap: spacing.xs,
  },
  group: {
    gap: spacing.sm,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
  },
  tagline: {
    paddingTop: spacing.sm,
  },
});
