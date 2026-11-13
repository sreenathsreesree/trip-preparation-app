import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText, Button, IconButton, Notice, TextField } from '@/components/ui';
import { useAuthStore } from '@/features/auth/authStore';
import { toErrorMessage } from '@/lib/errors';
import { deleteStoredImage, pickAndStoreImages } from '@/lib/imageStore';
import { colors, radii, spacing } from '@/theme';

import { DrivePhoto } from '../../journal/components/DrivePhoto';
import { PhotoUploadStatus } from '../../journal/components/PhotoUploadStatus';
import { confirmPhotoRemoval } from '../../journal/drive/photoRemoval';
import { usePhotoUploadStore } from '../../journal/drive/photoUploadStore';
import { COMPANION_LIMITS } from '../companion';
import { useDetailAction, type DetailContext } from './shared';

/** The user's own record of the visit: date, rating, notes, moments and photos. Stays on this device. */
export function MemoriesTab({ ctx }: { ctx: DetailContext }) {
  const memory = ctx.details?.memory ?? null;
  const { act, busy, error, setError } = useDetailAction(ctx.tripId, ctx.node.id);
  const [visitedOn, setVisitedOn] = useState(memory?.visitedOn ?? ctx.profile.visitedAt?.slice(0, 10) ?? '');
  const [notes, setNotes] = useState(memory?.notes ?? '');
  const [moments, setMoments] = useState(memory?.moments ?? '');
  const [saved, setSaved] = useState(false);
  const rating = memory?.rating ?? null;
  const photos = memory?.photos ?? [];
  const dirty = visitedOn.trim() !== (memory?.visitedOn ?? '') || notes.trim() !== (memory?.notes ?? '') || moments.trim() !== (memory?.moments ?? '');

  async function addPhoto() {
    try {
      // Originals: no crop editor, no resizing; several at once.
      const uris = await pickAndStoreImages('library', { mode: 'original', multiple: true, limit: COMPANION_LIMITS.photosMax - photos.length });
      if (uris.length === 0) return;
      const saved = await act((c) => c.saveMemory(ctx.node.id, { photos: [...photos, ...uris] }), 'Could not save the photos.');
      // Uploads to the user's own Google Drive right away when Drive is connected.
      if (saved) for (const uri of uris) await usePhotoUploadStore.getState().photoSelected({ tripId: ctx.tripId, source: 'memory', sourceId: ctx.node.id, uri });
    } catch (err) {
      setError(toErrorMessage(err, 'Could not add the photo.'));
    }
  }

  async function removePhoto(uri: string) {
    if (!(await confirmPhotoRemoval(uri, useAuthStore.getState().user?.id ?? null))) return;
    if (await act((c) => c.saveMemory(ctx.node.id, { photos: photos.filter((p) => p !== uri) }))) {
      deleteStoredImage(uri);
      // The original already in Google Drive is kept; Trip Prep just forgets it.
      await usePhotoUploadStore.getState().photoRemoved([uri]);
    }
  }

  return (
    <View style={styles.root} testID="detail-memories">
      <AppText variant="caption" tone="textMuted">
        Your memories are private. Photos are kept on this device and, once you connect Google Drive, uploaded to your own Drive.
      </AppText>
      <View style={styles.group}>
        <AppText variant="label" tone="textSecondary">
          Your rating
        </AppText>
        <View style={styles.stars} accessibilityRole="radiogroup" accessibilityLabel="Your rating">
          {[1, 2, 3, 4, 5].map((n) => (
            <IconButton
              key={n}
              icon={rating !== null && n <= rating ? 'star' : 'star-outline'}
              tone={rating !== null && n <= rating ? 'warning' : 'textMuted'}
              variant="plain"
              accessibilityLabel={`${n} ${n === 1 ? 'star' : 'stars'}`}
              onPress={() => void act((c) => c.saveMemory(ctx.node.id, { rating: rating === n ? null : n }))}
              testID={`detail-rate-${n}`}
            />
          ))}
        </View>
      </View>
      <TextField label="Visited on" placeholder="YYYY-MM-DD" value={visitedOn} onChangeText={setVisitedOn} maxLength={10} testID="detail-memory-date" />
      <TextField label="How it was" value={notes} onChangeText={setNotes} maxLength={COMPANION_LIMITS.textMax} multiline testID="detail-memory-notes" />
      <TextField label="Favourite moments" value={moments} onChangeText={setMoments} maxLength={COMPANION_LIMITS.textMax} multiline testID="detail-memory-moments" />
      {dirty ? (
        <Button
          label="Save memory"
          icon="content-save-outline"
          loading={busy}
          onPress={() => void act((c) => c.saveMemory(ctx.node.id, { visitedOn: visitedOn.trim() || null, notes, moments })).then(setSaved)}
          testID="detail-memory-save"
        />
      ) : null}
      {saved && !dirty ? <Notice tone="success" title="Memory saved." /> : null}

      <View style={styles.group}>
        <AppText variant="label" tone="textSecondary">
          Photos ({photos.length})
        </AppText>
        <View style={styles.photos}>
          {photos.map((uri, i) => (
            <View key={uri} style={styles.photo}>
              <DrivePhoto uri={uri} style={StyleSheet.absoluteFill} label={`Photo ${i + 1}`} testID={`detail-memory-photo-${i}`} />
              <View style={styles.photoAction}>
                <IconButton icon="close" size="sm" accessibilityLabel={`Remove photo ${i + 1}`} onPress={() => void removePhoto(uri)} />
              </View>
            </View>
          ))}
        </View>
        {photos.length > 0 ? <PhotoUploadStatus tripId={ctx.tripId} /> : null}
        {photos.length < COMPANION_LIMITS.photosMax ? (
          <Button label="Add photo" icon="image-plus" variant="secondary" size="sm" onPress={() => void addPhoto()} style={styles.left} testID="detail-memory-photo" />
        ) : null}
      </View>
      {error ? <Notice tone="danger" title={error} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: spacing.lg,
  },
  group: {
    gap: spacing.sm,
  },
  stars: {
    flexDirection: 'row',
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
  left: {
    alignSelf: 'flex-start',
  },
});
