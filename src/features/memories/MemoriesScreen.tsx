import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Screen } from '@/components/layout/Screen';
import { ScreenHeader } from '@/components/layout/ScreenHeader';
import { ActionSheet, AppText, Button, Card, EmptyState, ErrorState, Icon, IconButton, LoadingState, Notice, SegmentedControl, TextField, ToggleRow, type SheetAction } from '@/components/ui';
import { getRepositories } from '@/db/repositories';
import { useAuthStore } from '@/features/auth/authStore';
import { confirmAction } from '@/lib/confirm';
import { toErrorMessage } from '@/lib/errors';
import { pickAndStoreImages } from '@/lib/imageStore';
import { colors, radii, spacing } from '@/theme';

import { usePhotoUploadStore } from '../journal/drive/photoUploadStore';
import type { GalleryPhoto } from '../journal/gallery';
import { GalleryThumb } from '../journal/gallery/GalleryThumb';
import { PhotoViewer } from '../journal/gallery/PhotoViewer';
import { COMPANION_LIMITS } from '../planner/companion';
import { usePlannerStore, useTripPlan } from '../planner/plannerStore';
import { useTrip } from '../trips/hooks';
import { groupByDay, groupByPlace, type PhotoGroup } from './grouping';
import { ALBUM_LIMITS, type MemoryAlbum, type PhotoNote } from './memoriesRepository';

type Mode = 'place' | 'day' | 'albums';
const GAP = 4;

/**
 * A trip's Memories as a photo gallery: grouped by destination or by day, the
 * user's own albums, a full-screen viewer, adding several photos at once to a
 * destination's folder, and a separate details view for caption and favourite
 * (rating, visit date and moments stay on the destination's Memories). Photos
 * upload to the user's own Drive as before; removing one from an album never
 * deletes it anywhere.
 */
export function MemoriesScreen({ tripId }: { tripId: string | undefined }) {
  const { trip } = useTrip(tripId);
  const { plan } = useTripPlan(tripId);
  const accountId = useAuthStore((s) => s.user?.id ?? null);
  const [photos, setPhotos] = useState<GalleryPhoto[] | null>(null);
  const [albums, setAlbums] = useState<MemoryAlbum[]>([]);
  const [notes, setNotes] = useState<Record<string, PhotoNote>>({});
  const [albumId, setAlbumId] = useState<string | null>(null);
  const [albumUris, setAlbumUris] = useState<string[]>([]);
  const [mode, setMode] = useState<Mode>('place');
  const [width, setWidth] = useState(0);
  const [open, setOpen] = useState<{ list: GalleryPhoto[]; index: number } | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sheet, setSheet] = useState<'album' | 'destination' | null>(null);
  const [newAlbum, setNewAlbum] = useState('');
  const [details, setDetails] = useState<GalleryPhoto | null>(null);
  const [caption, setCaption] = useState('');
  const [favourite, setFavourite] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!tripId) return;
    try {
      const { gallery, memories } = await getRepositories();
      const [list, al, nt] = await Promise.all([gallery.list(tripId), memories.albums(tripId), memories.notes(tripId)]);
      setPhotos(list);
      setAlbums(al);
      setNotes(nt);
      setError(null);
    } catch (e) {
      setError(toErrorMessage(e, 'Could not load your photos.'));
    }
  }, [tripId]);
  const loadAlbum = useCallback(async (id: string) => {
    const { memories } = await getRepositories();
    setAlbumUris(await memories.albumPhotos(id));
  }, []);
  useFocusEffect(
    useCallback(() => {
      void load();
      if (tripId) void usePlannerStore.getState().load(tripId);
    }, [load, tripId]),
  );

  const destinations = useMemo(() => {
    const nodes = plan?.nodes ?? [];
    const order = (id: string | null): string[] =>
      nodes
        .filter((n) => n.parentId === id)
        .sort((a, b) => a.position - b.position)
        .flatMap((n) => [n.id, ...order(n.id)]);
    return order(null).map((id) => nodes.find((n) => n.id === id)!).filter(Boolean);
  }, [plan]);

  const byUri = useMemo(() => new Map((photos ?? []).map((p) => [p.uri, p])), [photos]);
  const groups: PhotoGroup[] = useMemo(() => {
    const list = (photos ?? []).map((p) => ({ ...p, caption: notes[p.uri]?.caption || p.caption }));
    if (albumId) {
      const inAlbum = albumUris.map((u) => byUri.get(u)).filter((p): p is GalleryPhoto => !!p).map((p) => ({ ...p, caption: notes[p.uri]?.caption || p.caption }));
      return [{ key: 'album', title: albums.find((a) => a.id === albumId)?.name ?? 'Album', subtitle: `${inAlbum.length} ${inAlbum.length === 1 ? 'photo' : 'photos'}`, photos: inAlbum }];
    }
    if (mode === 'day') return groupByDay(list);
    if (mode === 'place') {
      const favs = list.filter((p) => notes[p.uri]?.favourite);
      const placed = groupByPlace(list, destinations.map((d) => d.id));
      return favs.length ? [{ key: 'fav', title: 'Favourite moments', subtitle: `${favs.length} ${favs.length === 1 ? 'photo' : 'photos'}`, photos: favs }, ...placed] : placed;
    }
    return [];
  }, [photos, notes, mode, albumId, albumUris, byUri, albums, destinations]);

  if (!tripId || !trip) {
    return (
      <Screen bottomInset>
        <ScreenHeader showBack title="Memories" />
        <LoadingState label="Loading…" />
      </Screen>
    );
  }

  const columns = width >= 700 ? 5 : width < 340 ? 2 : 3;
  const cell = width > 0 ? Math.floor((width - GAP * (columns - 1)) / columns) : 0;
  const run = async (fn: () => Promise<unknown>, fallback: string) => {
    setError(null);
    try {
      await fn();
      return true;
    } catch (e) {
      setError(toErrorMessage(e, fallback));
      return false;
    }
  };

  async function addPhotos(nodeId: string) {
    setSheet(null);
    await run(async () => {
      const { companion, memories } = await getRepositories();
      const current = (await companion.node(nodeId)).memory?.photos ?? [];
      const room = COMPANION_LIMITS.photosMax - current.length;
      if (room <= 0) throw new Error(`That destination already has ${COMPANION_LIMITS.photosMax} photos.`);
      const uris = await pickAndStoreImages('library', { mode: 'original', multiple: true, limit: room });
      if (uris.length === 0) return;
      await companion.saveMemory(nodeId, { photos: [...current, ...uris] });
      for (const uri of uris) await usePhotoUploadStore.getState().photoSelected({ tripId: tripId!, source: 'memory', sourceId: nodeId, uri });
      if (albumId) await memories.addToAlbum(albumId, uris);
      setMessage(`${uris.length} ${uris.length === 1 ? 'photo' : 'photos'} added.`);
      await load();
      if (albumId) await loadAlbum(albumId);
    }, 'Could not add the photos.');
  }

  async function addSelectedTo(id: string) {
    setSheet(null);
    const uris = [...selected];
    await run(async () => {
      const { memories } = await getRepositories();
      const n = await memories.addToAlbum(id, uris);
      setMessage(`${n} ${n === 1 ? 'photo' : 'photos'} added to ${albums.find((a) => a.id === id)?.name ?? 'the album'}.`);
      setSelecting(false);
      setSelected(new Set());
      await load();
    }, 'Could not add to the album.');
  }

  const toggle = (uri: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(uri)) next.delete(uri);
      else next.add(uri);
      return next;
    });

  const openDetails = (p: GalleryPhoto) => {
    setOpen(null);
    setDetails(p);
    setCaption(notes[p.uri]?.caption ?? p.caption ?? '');
    setFavourite(notes[p.uri]?.favourite ?? false);
  };

  const albumSheet: SheetAction[] = [
    ...albums.map((a) => ({ key: a.id, label: a.name, icon: 'image-album' as const, description: `${a.count} photos`, onPress: () => void addSelectedTo(a.id) })),
  ];
  const destinationSheet: SheetAction[] = destinations.map((d) => ({
    key: d.id,
    label: d.name,
    icon: d.parentId ? ('subdirectory-arrow-right' as const) : ('map-marker-radius' as const),
    onPress: () => void addPhotos(d.id),
  }));
  const album = albums.find((a) => a.id === albumId) ?? null;

  return (
    <Screen testID="memories-screen" bottomInset onRefresh={() => void load()}>
      <ScreenHeader
        showBack
        eyebrow={trip.name}
        title={album ? album.name : 'Memories'}
        trailing={
          album ? (
            <IconButton
              icon="arrow-left"
              accessibilityLabel="All albums"
              onPress={() => {
                setAlbumId(null);
                setSelecting(false);
                setSelected(new Set());
              }}
              testID="memories-album-back"
            />
          ) : undefined
        }
      />

      {!album ? (
        <SegmentedControl<Mode>
          accessibilityLabel="Show memories"
          value={mode}
          onChange={(m) => {
            setMode(m);
            setSelecting(false);
            setSelected(new Set());
          }}
          options={[
            { value: 'place', label: 'By place' },
            { value: 'day', label: 'By day' },
            { value: 'albums', label: `Albums ${albums.length}` },
          ]}
        />
      ) : null}

      <View style={styles.actions}>
        <Button label="Add photos" icon="image-plus" size="sm" onPress={() => (destinations.length ? setSheet('destination') : setError('Add a destination to your plan first — photos are kept in its folder.'))} testID="memories-add" />
        {mode !== 'albums' || album ? (
          <Button
            label={selecting ? 'Done' : 'Select'}
            icon={selecting ? 'check' : 'checkbox-multiple-marked-outline'}
            variant="secondary"
            size="sm"
            onPress={() => {
              setSelecting((v) => !v);
              setSelected(new Set());
            }}
            testID="memories-select"
          />
        ) : null}
        {album ? (
          <Button
            label="Delete album"
            icon="trash-can-outline"
            variant="ghost"
            size="sm"
            onPress={() =>
              void confirmAction({ title: `Delete ${album.name}?`, message: 'Only the album goes. Its photos stay in Memories and in your Drive.', confirmLabel: 'Delete album', destructive: true }).then(
                (ok) =>
                  ok &&
                  void run(async () => {
                    const { memories } = await getRepositories();
                    await memories.deleteAlbum(album.id);
                    setAlbumId(null);
                    await load();
                  }, 'Could not delete the album.'),
              )
            }
            testID="memories-album-delete"
          />
        ) : null}
      </View>

      {selecting ? (
        <Card variant="outline" padding="md" testID="memories-selection">
          <View style={styles.actions}>
            <AppText variant="bodyStrong" style={styles.flex}>
              {selected.size} selected
            </AppText>
            {album ? (
              <Button
                label="Remove from album"
                size="sm"
                variant="secondary"
                disabled={selected.size === 0}
                onPress={() =>
                  void run(async () => {
                    const { memories } = await getRepositories();
                    await memories.removeFromAlbum(album.id, [...selected]);
                    setSelected(new Set());
                    await loadAlbum(album.id);
                    await load();
                  }, 'Could not remove them.')
                }
                testID="memories-remove-from-album"
              />
            ) : (
              <Button label="Add to album" size="sm" disabled={selected.size === 0 || albums.length === 0} onPress={() => setSheet('album')} testID="memories-add-to-album" />
            )}
          </View>
          {!album && albums.length === 0 ? (
            <AppText variant="caption" tone="textMuted">
              Create an album under Albums first.
            </AppText>
          ) : null}
        </Card>
      ) : null}

      {message ? <Notice tone="success" title={message} testID="memories-message" /> : null}
      {error ? <Notice tone="danger" title={error} testID="memories-error" /> : null}

      {details ? (
        <Card testID="memories-details">
          <View style={styles.group}>
            <View style={styles.actions}>
              <AppText variant="title" style={styles.flex}>
                Photo details
              </AppText>
              <IconButton icon="close" size="sm" accessibilityLabel="Close details" onPress={() => setDetails(null)} />
            </View>
            <AppText variant="caption" tone="textMuted">
              {[details.place ?? 'Journal', details.date].join(' · ')}
            </AppText>
            <TextField label="Caption" value={caption} onChangeText={setCaption} maxLength={ALBUM_LIMITS.captionMax} multiline testID="memories-caption" />
            <ToggleRow icon="star-outline" label="Favourite moment" value={favourite} onChange={setFavourite} testID="memories-favourite" />
            <View style={styles.actions}>
              <Button
                label="Save"
                size="sm"
                icon="content-save-outline"
                onPress={() =>
                  void run(async () => {
                    const { memories } = await getRepositories();
                    await memories.setNote(tripId, details.uri, { caption, favourite });
                    setDetails(null);
                    await load();
                  }, 'Could not save.')
                }
                testID="memories-details-save"
              />
              {details.nodeId ? (
                <Button
                  label="Rating, visit date & moments"
                  icon="star-circle-outline"
                  variant="ghost"
                  size="sm"
                  onPress={() => router.push({ pathname: '/trips/[tripId]/plan/place/[nodeId]', params: { tripId, nodeId: details.nodeId!, tab: 'memories' } })}
                  testID="memories-open-destination"
                />
              ) : null}
            </View>
          </View>
        </Card>
      ) : null}

      {error && photos === null ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : photos === null ? (
        <LoadingState label="Loading your photos…" />
      ) : mode === 'albums' && !album ? (
        <View style={styles.group} testID="memories-albums">
          <View style={styles.actions}>
            <View style={styles.flex}>
              <TextField label="New album" placeholder="e.g. Tea gardens" value={newAlbum} onChangeText={setNewAlbum} maxLength={ALBUM_LIMITS.nameMax} testID="memories-album-name" />
            </View>
            <Button
              label="Create"
              size="sm"
              disabled={!newAlbum.trim()}
              style={styles.create}
              onPress={() =>
                void run(async () => {
                  const { memories } = await getRepositories();
                  await memories.createAlbum(tripId, newAlbum);
                  setNewAlbum('');
                  await load();
                }, 'Could not create the album.')
              }
              testID="memories-album-create"
            />
          </View>
          {albums.length === 0 ? (
            <EmptyState icon="image-album" title="No albums yet" message="Create an album, then select photos under By place or By day and add them." />
          ) : (
            <View style={styles.albumGrid} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
              {albums.map((a) => (
                <View key={a.id} style={[styles.album, { width: cell > 0 ? Math.floor((width - GAP) / 2) : '48%' }]}>
                  {a.coverUri ? (
                    <GalleryThumb uri={a.coverUri} accountId={accountId} size={cell > 0 ? Math.floor((width - GAP) / 2) : 140} label={a.name} onPress={() => { setAlbumId(a.id); void loadAlbum(a.id); }} testID={`memories-album-${a.name}`} />
                  ) : (
                    <Button label={a.name} icon="image-album" variant="secondary" onPress={() => { setAlbumId(a.id); void loadAlbum(a.id); }} testID={`memories-album-${a.name}`} />
                  )}
                  <AppText variant="bodyStrong" numberOfLines={1}>
                    {a.name}
                  </AppText>
                  <AppText variant="caption" tone="textMuted">
                    {a.count} {a.count === 1 ? 'photo' : 'photos'}
                  </AppText>
                </View>
              ))}
            </View>
          )}
        </View>
      ) : photos.length === 0 && !album ? (
        <EmptyState icon="image-multiple-outline" title="No photos yet" message="Add photos to a destination's folder, or to journal entries." testID="memories-empty" />
      ) : (
        <View style={styles.group} onLayout={(e) => setWidth(e.nativeEvent.layout.width)} testID="memories-grid">
          {groups.map((g) => (
            <View key={g.key} style={styles.group}>
              <View>
                <AppText variant="h3" numberOfLines={1}>
                  {g.title}
                </AppText>
                <AppText variant="caption" tone="textMuted">
                  {g.subtitle}
                </AppText>
              </View>
              {g.photos.length === 0 ? (
                <AppText variant="caption" tone="textMuted">
                  No photos in this album yet. Use Select under By place to add some.
                </AppText>
              ) : null}
              <View style={styles.grid}>
                {cell > 0
                  ? g.photos.map((p, i) => (
                      <View key={`${g.key}:${p.key}`}>
                        <GalleryThumb
                          uri={p.uri}
                          accountId={accountId}
                          size={cell}
                          label={`${p.caption || p.place || 'Photo'}, ${p.date}${selected.has(p.uri) ? ', selected' : ''}`}
                          onPress={() => (selecting ? toggle(p.uri) : setOpen({ list: g.photos, index: i }))}
                          testID={`memories-photo-${g.key}-${i}`}
                        />
                        {notes[p.uri]?.favourite ? (
                          <View style={styles.badge} pointerEvents="none">
                            <Icon name="star" size={14} color={colors.warning} />
                          </View>
                        ) : null}
                        {selecting ? (
                          <View style={[styles.check, selected.has(p.uri) && styles.checkOn]} pointerEvents="none">
                            {selected.has(p.uri) ? <Icon name="check" size={14} tone="textOnAccent" /> : null}
                          </View>
                        ) : null}
                      </View>
                    ))
                  : null}
              </View>
            </View>
          ))}
        </View>
      )}

      <PhotoViewer photos={open?.list ?? []} index={open?.index ?? null} accountId={accountId} onClose={() => setOpen(null)} onInfo={openDetails} />
      <ActionSheet visible={sheet === 'album'} title="Add to album" actions={albumSheet} onClose={() => setSheet(null)} testID="memories-album-sheet" />
      <ActionSheet visible={sheet === 'destination'} title="Add photos to" subtitle="Photos are kept in the destination's folder and uploaded to your own Drive when it's connected." actions={destinationSheet} onClose={() => setSheet(null)} testID="memories-destination-sheet" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  group: { gap: spacing.sm },
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm },
  flex: { flex: 1, minWidth: 0 },
  create: { marginTop: spacing.lg },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP },
  albumGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: GAP },
  album: { gap: spacing.xxs, marginBottom: spacing.md },
  badge: { position: 'absolute', top: 4, left: 4, padding: 2, borderRadius: radii.pill, backgroundColor: colors.photoChrome },
  check: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 22,
    height: 22,
    borderRadius: radii.pill,
    borderWidth: 2,
    borderColor: colors.textPrimary,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.photoChrome,
  },
  checkOn: { backgroundColor: colors.accent, borderColor: colors.accent },
});
