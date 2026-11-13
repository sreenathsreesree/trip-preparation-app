import { useState } from 'react';
import { Share, StyleSheet, View } from 'react-native';

import { AppText, Button, Icon, IconButton, Notice, Tag } from '@/components/ui';
import { toErrorMessage } from '@/lib/errors';
import { deleteStoredImage, pickAndStoreImage } from '@/lib/imageStore';
import { colors, radii, spacing } from '@/theme';

import { DrivePhoto } from '../../journal/components/DrivePhoto';
import { usePhotoUploadStore } from '../../journal/drive/photoUploadStore';
import { visitLength } from '../companion';
import { destinationShareText } from '../share';
import { useDetailAction, type DetailContext } from './shared';

/** Cover photo (the user's own), status tags, favourite and share. */
export function Hero({ ctx, trail }: { ctx: DetailContext; trail: string[] }) {
  const { tripId, node, plan, profile } = ctx;
  const { act, error, busy } = useDetailAction(tripId, node.id);
  const [shareError, setShareError] = useState<string | null>(null);
  const routeIndex = plan.route.findIndex((s) => s.nodeId === node.id);
  const length = visitLength(profile.visitMinutes);
  const visited = profile.visitStatus === 'visited';

  async function pickCover() {
    try {
      const uri = await pickAndStoreImage('library', 'original');
      if (!uri) return;
      const previous = profile.coverImageUri;
      if (await act((c) => c.updateProfile(node.id, { coverImageUri: uri }), 'Could not save the photo.')) {
        deleteStoredImage(previous);
        // Like memory photos, the cover goes to the user's own Drive (and so into the backup).
        await usePhotoUploadStore.getState().photoSelected({ tripId, source: 'memory', sourceId: node.id, uri });
      }
    } catch (err) {
      setShareError(toErrorMessage(err, 'Could not add the photo.'));
    }
  }

  async function removeCover() {
    const previous = profile.coverImageUri;
    if (await act((c) => c.updateProfile(node.id, { coverImageUri: null }))) deleteStoredImage(previous);
  }

  async function share() {
    setShareError(null);
    try {
      await Share.share({ title: node.name, message: destinationShareText(node, profile, trail) });
    } catch {
      setShareError('Sharing isn’t available on this device.');
    }
  }

  return (
    <View style={styles.root} testID="detail-hero">
      <View style={styles.cover}>
        {profile.coverImageUri ? (
          <DrivePhoto uri={profile.coverImageUri} style={StyleSheet.absoluteFill} label={`Cover photo of ${node.name}`} testID="detail-cover" />
        ) : (
          <View style={styles.placeholder}>
            <Icon name="image-filter-hdr" size={40} color={colors.textMuted} />
            <AppText variant="caption" tone="textMuted">
              Add your own cover photo
            </AppText>
          </View>
        )}
        <View style={styles.coverActions}>
          <IconButton
            icon={profile.saved ? 'heart' : 'heart-outline'}
            tone={profile.saved ? 'danger' : 'textPrimary'}
            accessibilityLabel={profile.saved ? 'Remove from saved' : 'Save for later'}
            onPress={() => void act((c) => c.updateProfile(node.id, { saved: !profile.saved }))}
            disabled={busy}
            testID="detail-save"
          />
          <IconButton icon="share-variant-outline" accessibilityLabel="Share" onPress={() => void share()} testID="detail-share" />
          <IconButton
            icon={profile.coverImageUri ? 'image-edit-outline' : 'image-plus'}
            accessibilityLabel={profile.coverImageUri ? 'Change cover photo' : 'Add cover photo'}
            onPress={() => void pickCover()}
            testID="detail-cover-pick"
          />
        </View>
      </View>

      <View style={styles.tags}>
        {node.parentId ? (
          <Tag label="Place inside a destination" icon="subdirectory-arrow-right" color={colors.info} />
        ) : (
          <Tag label="Main destination" icon="map-marker-radius" color={colors.accent} />
        )}
        {routeIndex >= 0 ? <Tag label={`Route stop ${routeIndex + 1}`} icon="map-marker-path" color={colors.accent} /> : <Tag label="Not on the route" icon="map-marker-path" />}
        {visited ? <Tag label="Visited" icon="check-circle" color={colors.accent} /> : null}
        {profile.saved ? <Tag label="Saved for later" icon="heart" color={colors.danger} /> : null}
        {length ? <Tag label={length.label} icon={length.icon} color={colors.info} /> : null}
        {profile.tags.map((tag) => (
          <Tag key={tag} label={tag} icon="tag-outline" />
        ))}
      </View>
      {profile.coverImageUri ? (
        <Button label="Remove cover photo" icon="image-remove" variant="ghost" size="sm" onPress={() => void removeCover()} style={styles.left} testID="detail-cover-remove" />
      ) : null}
      {error || shareError ? <Notice tone="danger" title={error ?? shareError ?? ''} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: spacing.md,
  },
  cover: {
    height: 180,
    borderRadius: radii.lg,
    overflow: 'hidden',
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
  },
  placeholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  coverActions: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
    flexDirection: 'row',
    gap: spacing.sm,
  },
  tags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  left: {
    alignSelf: 'flex-start',
  },
});
