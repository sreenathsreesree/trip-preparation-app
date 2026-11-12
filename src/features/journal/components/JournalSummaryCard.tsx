import { router, useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText, Button, Card, Icon } from '@/components/ui';
import { colors, radii, spacing } from '@/theme';

import type { TripSummary } from '../../trips/model';
import { useJournalStore, useTripJournal } from '../journalStore';

/** Trip dashboard entry point to the Journey Journal. */
export function JournalSummaryCard({ trip }: { trip: TripSummary }) {
  const journal = useTripJournal(trip.id);
  useFocusEffect(
    useCallback(() => {
      void useJournalStore.getState().load(trip.id);
    }, [trip.id]),
  );
  const count = journal.entries.length;
  const photos = journal.entries.reduce((n, e) => n + e.photos.length, 0);
  const latest = journal.entries[0];
  return (
    <Card testID="journal-summary">
      <View style={styles.header}>
        <View style={styles.icon}>
          <Icon name="book-open-page-variant-outline" tone="accent" />
        </View>
        <View style={styles.flex}>
          <AppText variant="title">Journey journal</AppText>
          <AppText variant="caption" tone="textSecondary" numberOfLines={2}>
            {count === 0
              ? 'Write about each day of the trip and keep your photos together.'
              : `${count} ${count === 1 ? 'entry' : 'entries'} · ${photos} ${photos === 1 ? 'photo' : 'photos'}${latest ? ` · latest: ${latest.title || latest.entryDate}` : ''}`}
          </AppText>
        </View>
      </View>
      <Button
        label={count === 0 ? 'Start the journal' : 'Open journal'}
        icon="book-open-page-variant-outline"
        variant="secondary"
        size="sm"
        onPress={() => router.push({ pathname: '/trips/[tripId]/journal', params: { tripId: trip.id } })}
        style={styles.button}
        testID="journal-open"
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  icon: {
    width: 40,
    height: 40,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentSoft,
  },
  flex: {
    flex: 1,
    gap: spacing.xxs,
  },
  button: {
    alignSelf: 'flex-start',
    marginTop: spacing.md,
  },
});
