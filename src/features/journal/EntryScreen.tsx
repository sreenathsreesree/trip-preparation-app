import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Screen } from '@/components/layout/Screen';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { AppText, Button, IconButton, LoadingState, Notice, OptionTile, TextField, ToggleRow } from '@/components/ui';
import { confirmAction } from '@/lib/confirm';
import { toErrorMessage } from '@/lib/errors';
import { successFeedback } from '@/lib/haptics';
import { deleteStoredImage, pickAndStoreImage, type PickSource } from '@/lib/imageStore';
import { colors, radii, spacing } from '@/theme';

import { trailOf } from '../planner/compare';
import { usePlannerStore, useTripPlan } from '../planner/plannerStore';
import { useTripSharing } from '../sharing/sharingStore';
import { useTrip } from '../trips/hooks';
import type { TripSummary } from '../trips/model';
import { DrivePhoto } from './components/DrivePhoto';
import { useJournalStore, useTripJournal } from './journalStore';
import { defaultEntryDate, JOURNAL_LIMITS, MOOD_META, MOODS, validateEntry, type JournalEntry, type Mood } from './model';

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

function Editor({ trip, entry }: { trip: TripSummary; entry: JournalEntry | null }) {
  const plan = useTripPlan(trip.id).plan;
  const [entryDate, setEntryDate] = useState(entry?.entryDate ?? defaultEntryDate(trip, todayIso()));
  const [title, setTitle] = useState(entry?.title ?? '');
  const [body, setBody] = useState(entry?.body ?? '');
  const [mood, setMood] = useState<Mood | null>(entry?.mood ?? null);
  const sharing = useTripSharing(trip.id);
  const canShare = sharing.space?.role === 'owner' || sharing.space?.role === 'editor';
  const [shared, setShared] = useState(entry?.visibility === 'shared');
  const [nodeId, setNodeId] = useState<string | null>(entry?.nodeId ?? null);
  /** Photos picked for a new entry, attached when it is saved. */
  const [pending, setPending] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const input = { entryDate: entryDate.trim(), title, body, mood, nodeId };
  const invalid = validateEntry(input);
  const photos = entry ? entry.photos.map((p) => ({ key: p.id, uri: p.uri })) : pending.map((uri) => ({ key: uri, uri }));
  const full = photos.length >= JOURNAL_LIMITS.photosMax;

  async function save() {
    setTouched(true);
    if (invalid) return;
    setSaving(true);
    setError(null);
    try {
      const store = useJournalStore.getState();
      const visibility = canShare && shared ? 'shared' : 'private';
      if (entry) {
        await store.update(trip.id, entry.id, input);
        if (entry.visibility !== visibility && (canShare || visibility === 'private')) await store.setVisibility(trip.id, entry.id, visibility);
      } else {
        const created = await store.create(trip.id, input);
        for (const uri of pending) await store.addPhoto(trip.id, created.id, uri);
        if (visibility === 'shared') await store.setVisibility(trip.id, created.id, 'shared');
      }
      successFeedback();
      router.back();
    } catch (err) {
      setError(toErrorMessage(err, 'Could not save the entry.'));
    } finally {
      setSaving(false);
    }
  }

  async function addPhoto(source: PickSource) {
    setError(null);
    try {
      const uri = await pickAndStoreImage(source);
      if (!uri) return;
      if (entry) await useJournalStore.getState().addPhoto(trip.id, entry.id, uri);
      else setPending((p) => [...p, uri]);
    } catch (err) {
      setError(toErrorMessage(err, 'Could not add the photo.'));
    }
  }

  async function removePhoto(key: string, uri: string) {
    if (entry) await useJournalStore.getState().removePhoto(trip.id, key);
    else {
      setPending((p) => p.filter((u) => u !== uri));
      deleteStoredImage(uri);
    }
  }

  async function remove() {
    if (!entry) return;
    const ok = await confirmAction({
      title: 'Delete this entry?',
      message: `“${entry.title || 'Untitled'}” and its ${entry.photos.length} ${entry.photos.length === 1 ? 'photo' : 'photos'} will be removed from this device. Copies already in Google Drive stay there.`,
      confirmLabel: 'Delete entry',
      destructive: true,
    });
    if (!ok) return;
    await useJournalStore.getState().remove(trip.id, entry.id);
    router.back();
  }

  function cancel() {
    for (const uri of pending) deleteStoredImage(uri);
    router.back();
  }

  return (
    <Screen testID="journal-editor" bottomInset>
      <ScreenHeader
        showBack
        eyebrow={trip.name}
        title={entry ? 'Edit entry' : 'New entry'}
        trailing={entry ? <IconButton icon="delete-outline" tone="danger" accessibilityLabel="Delete entry" onPress={() => void remove()} testID="journal-delete" /> : undefined}
      />
      <TextField label="Date" placeholder="YYYY-MM-DD" value={entryDate} onChangeText={setEntryDate} maxLength={10} helper={`Trip: ${trip.startDate} to ${trip.endDate}`} testID="journal-date" />
      <TextField label="Title" placeholder="e.g. Sunrise at Kolukkumalai" value={title} onChangeText={setTitle} maxLength={JOURNAL_LIMITS.titleMax} testID="journal-title" />
      <TextField
        label="What happened"
        placeholder="What you saw, ate, felt…"
        value={body}
        onChangeText={setBody}
        maxLength={JOURNAL_LIMITS.bodyMax}
        multiline
        testID="journal-body"
      />

      <View style={styles.group}>
        <AppText variant="label" tone="textSecondary">
          Mood
        </AppText>
        <View style={styles.chips}>
          {MOODS.map((m) => (
            <OptionTile key={m} layout="chip" label={MOOD_META[m].label} icon={MOOD_META[m].icon} selected={mood === m} onPress={() => setMood(mood === m ? null : m)} testID={`journal-mood-${m}`} />
          ))}
        </View>
      </View>

      {plan && plan.nodes.length > 0 ? (
        <View style={styles.group}>
          <AppText variant="label" tone="textSecondary">
            About a place (optional)
          </AppText>
          <View style={styles.chips}>
            {plan.nodes.map((n) => {
              const trail = trailOf(plan, n.id);
              return (
                <OptionTile
                  key={n.id}
                  layout="chip"
                  label={trail ? `${n.name} · ${trail.split(' › ').pop()}` : n.name}
                  icon="map-marker-outline"
                  selected={nodeId === n.id}
                  onPress={() => setNodeId(nodeId === n.id ? null : n.id)}
                  testID={`journal-place-${n.name}`}
                />
              );
            })}
          </View>
        </View>
      ) : null}

      <View style={styles.group}>
        <AppText variant="label" tone="textSecondary">
          Photos ({photos.length})
        </AppText>
        <View style={styles.photos}>
          {photos.map((p, i) => (
            <View key={p.key} style={styles.photo}>
              <DrivePhoto uri={p.uri} style={StyleSheet.absoluteFill} label={`Photo ${i + 1}`} testID={`journal-photo-${i}`} />
              <View style={styles.photoAction}>
                <IconButton icon="close" size="sm" accessibilityLabel={`Remove photo ${i + 1}`} onPress={() => void removePhoto(p.key, p.uri)} />
              </View>
            </View>
          ))}
        </View>
        {!full ? (
          <View style={styles.chips}>
            <Button label="Add photo" icon="image-plus" variant="secondary" size="sm" onPress={() => void addPhoto('library')} testID="journal-photo" />
            <Button label="Take photo" icon="camera-outline" variant="ghost" size="sm" onPress={() => void addPhoto('camera')} />
          </View>
        ) : null}
      </View>

      {canShare ? (
        <ToggleRow
          label="Share with trip members"
          description="Members see the title, text, mood and place. Photos stay in your own Google Drive."
          icon="account-multiple-outline"
          value={shared}
          onChange={setShared}
          testID="journal-share-toggle"
        />
      ) : null}
      <AppText variant="caption" tone="textMuted" testID="journal-privacy">
        {canShare && shared ? 'Shared with this trip’s members.' : 'Private: only you can see this entry.'} Photos are uploaded to your own Google Drive as soon as you add them when Drive is connected.
      </AppText>
      {touched && invalid ? <Notice tone="warning" title={invalid} testID="journal-invalid" /> : null}
      {error ? <Notice tone="danger" title={error} /> : null}
      <Button label={entry ? 'Save changes' : 'Save entry'} icon="content-save-outline" loading={saving} onPress={() => void save()} fullWidth testID="journal-save" />
      <Button label="Cancel" variant="ghost" onPress={cancel} fullWidth />
    </Screen>
  );
}

export function EntryScreen({ tripId, entryId }: { tripId: string | undefined; entryId: string | undefined }) {
  const { trip } = useTrip(tripId);
  const journal = useTripJournal(tripId);
  useFocusEffect(
    useCallback(() => {
      if (!tripId) return;
      void useJournalStore.getState().load(tripId);
      void usePlannerStore.getState().load(tripId);
    }, [tripId]),
  );
  const entry = entryId ? (journal.entries.find((e) => e.id === entryId) ?? null) : null;
  if (!trip || (entryId && journal.status !== 'ready')) {
    return (
      <Screen bottomInset>
        <ScreenHeader showBack title="Journal entry" />
        <LoadingState label="Loading…" />
      </Screen>
    );
  }
  if (entryId && !entry) {
    return (
      <Screen bottomInset>
        <ScreenHeader showBack title="Journal entry" />
        <Notice tone="info" title="This entry no longer exists." />
      </Screen>
    );
  }
  return <Editor key={entry?.id ?? 'new'} trip={trip} entry={entry} />;
}

const styles = StyleSheet.create({
  group: {
    gap: spacing.sm,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  photos: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  photo: {
    width: 96,
    height: 96,
    borderRadius: radii.md,
    overflow: 'hidden',
    backgroundColor: colors.surfaceRaised,
  },
  photoAction: {
    position: 'absolute',
    top: spacing.xxs,
    right: spacing.xxs,
  },
});
