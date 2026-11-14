import { useState } from 'react';
import { Share, StyleSheet, View } from 'react-native';

import { AppText, Button, Icon, IconButton, Notice } from '@/components/ui';
import { toErrorMessage } from '@/lib/errors';
import { deleteStoredImage, pickAndStoreImage } from '@/lib/imageStore';
import { colors, radii, spacing } from '@/theme';

import { AutoCover } from '../../covers/AutoCover';
import { DrivePhoto } from '../../journal/components/DrivePhoto';
import { contextLocation } from '../../places/discovery';
import { usePhotoUploadStore } from '../../journal/drive/photoUploadStore';
import { visitLength } from '../companion';
import { destinationShareText } from '../share';
import { useDetailAction, type DetailContext } from './shared';

/**
 * Scenic cover (the user's own photo first, else a credited free image) with
 * the destination's name and location over it, a one-line status, and
 * favourite / share / change-cover actions.
 */
export function Hero({ ctx, trail }: { ctx: DetailContext; trail: string[] }) {
  const { tripId, node, plan, profile } = ctx;
  const { act, error, busy } = useDetailAction(tripId, node.id);
  const [shareError, setShareError] = useState<string | null>(null);
  const routeIndex = plan.route.findIndex((s) => s.nodeId === node.id);
  const length = visitLength(profile.visitMinutes);
  const visited = profile.visitStatus === 'visited';
  const located = contextLocation(plan.nodes, node.id);
  const wikipedia = typeof node.place?.metadata?.wikipedia === 'string' ? node.place.metadata.wikipedia : null;
  const where = [...[...trail].reverse().slice(0, 2), node.place?.district, node.place?.state, node.place?.country]
    .filter((v, i, all): v is string => !!v && all.indexOf(v) === i)
    .join(', ');
  const status = [
    node.parentId ? 'Place inside a destination' : 'Main destination',
    routeIndex >= 0 ? `Route stop ${routeIndex + 1}` : 'Not on the route',
    visited ? 'Visited' : null,
    profile.saved ? 'Saved for later' : null,
    length ? length.label : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const coverQuery = profile.coverImageUri
    ? null
    : { name: node.name, context: [...[...trail].reverse(), node.place?.state, node.place?.country].filter(Boolean).join(', '), location: located?.location ?? null, wikipedia };

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
          // No own photo: a representative free image is chosen automatically (never replaces an own photo).
          <AutoCover subject={{ type: 'node', id: node.id }} query={coverQuery} style={StyleSheet.absoluteFill} label={`Photo of ${node.name}`} creditAtTop testID="detail-auto-cover" />
        )}
        <View style={styles.titleBand} pointerEvents="none">
          <View style={styles.whereRow}>
            <Icon name="map-marker-outline" size={16} color={colors.textPrimary} />
            <AppText variant="bodyStrong" numberOfLines={1} style={[styles.onPhoto, styles.flex]} testID="detail-hero-where">
              {where || (node.place?.location ? 'Location set' : 'Location not set yet')}
            </AppText>
          </View>
          <AppText variant="caption" numberOfLines={2} style={styles.onPhotoMuted} testID="detail-status-line">
            {status}
          </AppText>
        </View>
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
    height: 210,
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
  titleBand: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    gap: spacing.xxs,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    backgroundColor: colors.photoChrome,
  },
  whereRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  flex: {
    flex: 1,
    minWidth: 0,
  },
  onPhoto: {
    color: colors.textPrimary,
  },
  onPhotoMuted: {
    color: colors.textSecondary,
  },
  coverActions: {
    position: 'absolute',
    top: spacing.xl,
    right: spacing.sm,
    flexDirection: 'row',
    gap: spacing.sm,
  },
  left: {
    alignSelf: 'flex-start',
  },
});
