import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Screen } from '@/components/layout/Screen';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { AppText, Button, Card, EmptyState, ErrorState, Icon, LoadingState, Tag } from '@/components/ui';
import { colors, radii, spacing } from '@/theme';

import { usePlannerStore, useTripPlan } from '../planner/plannerStore';
import { useTrip } from '../trips/hooks';
import type { TripSummary } from '../trips/model';
import { DriveCard } from './components/DriveCard';
import { useJournalStore, useTripJournal } from './journalStore';
import { buildTimeline, MOOD_META, type JournalEntry, type MemoryItem } from './model';

const longDate = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

function Photos({ uris }: { uris: string[] }) {
  if (uris.length === 0) return null;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.photos}>
      {uris.map((uri, i) => (
        <Image key={`${uri}-${i}`} source={{ uri }} style={styles.photo} contentFit="cover" accessibilityLabel={`Photo ${i + 1}`} />
      ))}
    </ScrollView>
  );
}

function EntryCard({ trip, entry, place }: { trip: TripSummary; entry: JournalEntry; place: string | null }) {
  const mood = entry.mood ? MOOD_META[entry.mood] : null;
  return (
    <Card
      onPress={() => router.push({ pathname: '/trips/[tripId]/journal/entry', params: { tripId: trip.id, entryId: entry.id } })}
      accessibilityLabel={`Open entry ${entry.title || entry.body.slice(0, 40)}`}
      testID={`journal-entry-${entry.title || entry.id}`}
    >
      <View style={styles.cardBody}>
        <View style={styles.inline}>
          {mood ? <Icon name={mood.icon} size={20} color={colors.accent} /> : null}
          <AppText variant="title" style={styles.flex} numberOfLines={2}>
            {entry.title || 'Untitled'}
          </AppText>
        </View>
        {entry.body ? (
          <AppText variant="body" tone="textSecondary" numberOfLines={4}>
            {entry.body}
          </AppText>
        ) : null}
        <Photos uris={entry.photos.map((p) => p.uri)} />
        {place || mood ? (
          <View style={styles.tags}>
            {place ? <Tag label={place} icon="map-marker-outline" color={colors.info} /> : null}
            {mood ? <Tag label={mood.label} icon={mood.icon} /> : null}
          </View>
        ) : null}
      </View>
    </Card>
  );
}

function MemoryCard({ trip, memory }: { trip: TripSummary; memory: MemoryItem }) {
  return (
    <Card
      variant="outline"
      onPress={() => router.push({ pathname: '/trips/[tripId]/plan/place/[nodeId]', params: { tripId: trip.id, nodeId: memory.nodeId, tab: 'memories' } })}
      accessibilityLabel={`Memories of ${memory.nodeName}`}
      testID={`journal-memory-${memory.nodeName}`}
    >
      <View style={styles.cardBody}>
        <View style={styles.inline}>
          <Icon name="map-marker-check-outline" size={20} color={colors.accent} />
          <AppText variant="title" style={styles.flex}>
            {memory.nodeName}
          </AppText>
          {memory.rating ? (
            <AppText variant="captionStrong" tone="warning">
              {'★'.repeat(memory.rating)}
            </AppText>
          ) : null}
        </View>
        {memory.notes ? (
          <AppText variant="body" tone="textSecondary" numberOfLines={3}>
            {memory.notes}
          </AppText>
        ) : null}
        <Photos uris={memory.photos} />
        <AppText variant="caption" tone="textMuted">
          Destination memory
        </AppText>
      </View>
    </Card>
  );
}

function Journal({ trip }: { trip: TripSummary }) {
  const journal = useTripJournal(trip.id);
  const plan = useTripPlan(trip.id).plan;
  const names = new Map((plan?.nodes ?? []).map((n) => [n.id, n.name]));
  const days = buildTimeline(journal.entries, journal.memories, trip);
  const newEntry = () => router.push({ pathname: '/trips/[tripId]/journal/entry', params: { tripId: trip.id } });
  const count = journal.entries.length;

  return (
    <Screen testID="journal-screen" bottomInset onRefresh={() => void useJournalStore.getState().load(trip.id)}>
      <ScreenHeader showBack eyebrow={trip.name} title="Journey journal" subtitle={count === 0 ? 'Your story of this trip' : `${count} ${count === 1 ? 'entry' : 'entries'}`} />
      <Button label="New entry" icon="pencil-plus-outline" onPress={newEntry} fullWidth testID="journal-new" />
      <DriveCard trip={trip} />
      {journal.status === 'error' ? (
        <ErrorState message={journal.error ?? 'Could not load the journal.'} onRetry={() => void useJournalStore.getState().load(trip.id)} />
      ) : journal.status !== 'ready' ? (
        <LoadingState label="Loading journal…" />
      ) : days.length === 0 ? (
        <EmptyState
          icon="book-open-page-variant-outline"
          title="No entries yet"
          message="Write about each day — what you saw, ate and felt — and add photos. Entries stay private on this device."
          action={{ label: 'Write the first entry', icon: 'pencil-plus-outline', onPress: newEntry }}
          testID="journal-empty"
        />
      ) : (
        days.map((day) => (
          <View key={day.date} style={styles.day} testID={`journal-day-${day.date}`}>
            <View style={styles.dayHeader}>
              {day.dayNumber ? (
                <View style={styles.dayBadge}>
                  <AppText variant="captionStrong" tone="textOnAccent">
                    Day {day.dayNumber}
                  </AppText>
                </View>
              ) : null}
              <AppText variant="label" tone="textSecondary">
                {longDate(day.date)}
              </AppText>
            </View>
            {day.items.map((item) =>
              item.kind === 'entry' ? (
                <EntryCard key={item.entry.id} trip={trip} entry={item.entry} place={item.entry.nodeId ? (names.get(item.entry.nodeId) ?? null) : null} />
              ) : (
                <MemoryCard key={`m-${item.memory.nodeId}`} trip={trip} memory={item.memory} />
              ),
            )}
          </View>
        ))
      )}
    </Screen>
  );
}

export function JournalScreen({ tripId }: { tripId: string | undefined }) {
  const { trip } = useTrip(tripId);
  useFocusEffect(
    useCallback(() => {
      if (!tripId) return;
      void useJournalStore.getState().load(tripId);
      void usePlannerStore.getState().load(tripId);
    }, [tripId]),
  );
  if (!trip) {
    return (
      <Screen bottomInset>
        <ScreenHeader showBack title="Journey journal" />
        <LoadingState label="Loading…" />
      </Screen>
    );
  }
  return <Journal trip={trip} />;
}

const styles = StyleSheet.create({
  day: {
    gap: spacing.md,
  },
  dayHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  dayBadge: {
    backgroundColor: colors.accent,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
  },
  cardBody: {
    gap: spacing.sm,
  },
  inline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  flex: {
    flex: 1,
  },
  tags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  photos: {
    gap: spacing.sm,
  },
  photo: {
    width: 120,
    height: 90,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceRaised,
  },
});
