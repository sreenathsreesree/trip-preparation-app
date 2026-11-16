import { Image } from 'expo-image';
import { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { ActionSheet, AppText, Button, Card, Icon, IconButton, LoadingState, Notice, OptionTile, type SheetAction } from '@/components/ui';
import { toErrorMessage } from '@/lib/errors';
import { colors, radii, spacing } from '@/theme';

import { getRepositories } from '@/db/repositories';

import { PlaceImage } from '../../covers/PlaceImage';
import { placesProvider } from '../../places/config';
import { toPlaceInput } from '../../places/placeInput';
import {
  contextLocation,
  DISCOVERY_CATEGORIES,
  DISTANCE_FILTERS_KM,
  formatDistance,
  planMatcher,
  rankRecommendations,
  typeLabel,
  type DistanceKm,
  type Placement,
  type Recommendation,
  type RecommendationSort,
} from '../../places/discovery';
import { isPlacesError, type PlaceDetails, type PlacesErrorKind, type PlacesSource } from '../../places/provider';
import { describeRecommendationError, hasRatings, loadRecommendations } from '../../places/recommendationsService';
import { timeAgo } from '../../remote/timeAgo';
import type { TripPlan } from '../model';
import { usePlannerStore } from '../plannerStore';

export { toPlaceInput } from '../../places/placeInput';

function RecommendationCard({ rec, onAdd }: { rec: Recommendation; onAdd: () => void }) {
  const { place } = rec;
  const photo = place.photos[0];
  const photoUrl = photo ? placesProvider.photoUrl(photo, 640) : null;
  const label = typeLabel(place.types ?? []);
  const openNow = typeof place.metadata?.openNow === 'boolean' ? place.metadata.openNow : null;
  return (
    <Card padding="none" style={styles.card} testID={`rec-${place.name}`}>
      {photoUrl ? (
        <View>
          <Image source={{ uri: photoUrl }} style={styles.photo} contentFit="cover" accessibilityIgnoresInvertColors />
          {photo && photo.authorAttributions.length > 0 ? (
            <AppText variant="caption" tone="textMuted" style={styles.photoCredit} numberOfLines={1}>
              Photo: {photo.authorAttributions.map((a) => a.displayName).join(', ')}
            </AppText>
          ) : null}
        </View>
      ) : typeof place.metadata?.wikipedia === 'string' ? (
        <PlaceImage wikipedia={place.metadata.wikipedia} name={place.name} location={place.location ?? null} />
      ) : null}
      <View style={styles.cardBody}>
        <View style={styles.titleRow}>
          <View style={styles.flex}>
            <AppText variant="bodyStrong" numberOfLines={2}>
              {place.name}
            </AppText>
            <AppText variant="caption" tone="textSecondary" numberOfLines={1}>
              {[label, rec.distanceMeters !== null ? `${formatDistance(rec.distanceMeters)} away` : null].filter(Boolean).join(' · ') || 'Place'}
            </AppText>
            <AppText variant="caption" tone="textMuted" numberOfLines={1}>
              {[typeof place.metadata?.locality === 'string' ? place.metadata.locality : null, place.district, place.state].filter((v, i, all) => v && all.indexOf(v) === i).join(', ')}
            </AppText>
          </View>
          {rec.inPlan ? (
            <View style={styles.added} accessibilityLabel={`${place.name} is already in your plan`} testID={`rec-added-${place.name}`}>
              <Icon name="check" size={18} tone="textOnAccent" />
            </View>
          ) : (
            <IconButton icon="plus" variant="accent" tone="textOnAccent" accessibilityLabel={`Add ${place.name}`} onPress={onAdd} testID={`rec-add-${place.name}`} />
          )}
        </View>
        {place.rating !== null ? (
          <AppText variant="caption" tone="warning">
            ★ {place.rating.toFixed(1)}
            {place.userRatingCount !== null ? ` · ${place.userRatingCount.toLocaleString()} reviews` : ''}
          </AppText>
        ) : null}
        {openNow !== null ? (
          <AppText variant="caption" tone={openNow ? 'accent' : 'danger'}>
            {openNow ? 'Open now' : 'Closed now'}
          </AppText>
        ) : null}
        {place.formattedAddress ? (
          <AppText variant="caption" tone="textMuted" numberOfLines={2}>
            {place.formattedAddress}
          </AppText>
        ) : null}
        {place.editorialSummary ? (
          <AppText variant="caption" tone="textSecondary" numberOfLines={3}>
            {place.editorialSummary}
          </AppText>
        ) : null}
      </View>
    </Card>
  );
}

/** Says where results come from: live, saved earlier (and how long ago), or demo data. */
function SourceBadge({ source, from, fetchedAt }: { source: PlacesSource; from: 'live' | 'cache' | 'stale_cache' | null; fetchedAt: string | null }) {
  if (source.kind === 'demo') {
    return <Notice tone="warning" title="Demo data — not real places" message="This build uses sample entries for testing." testID="rec-source-demo" />;
  }
  const when = fetchedAt ? timeAgo(fetchedAt, new Date()) : null;
  // Google requires its name with its content; free map data is credited under Profile → Data sources.
  const from_ = source.name.startsWith('Google') ? ` from ${source.name}` : '';
  const text =
    from === 'stale_cache'
      ? `Saved ${when}${from_} — you seem to be offline, so this may be out of date.`
      : from === 'cache'
        ? `Saved ${when}${from_}.`
        : `Live suggestions${from_}.`;
  return (
    <AppText variant="caption" tone={from === 'stale_cache' ? 'warning' : 'textMuted'} testID={`rec-source-${from ?? 'live'}`}>
      {text}
    </AppText>
  );
}

/**
 * Live nearby / famous places around a destination (Google Places through the
 * Trip Prep proxy). Without a configured provider, or without a verified
 * location to search around, it says so — it never shows sample data.
 * Adding asks where the place goes; it is never added to several structures.
 */
export function Recommendations({ tripId, plan, nodeId }: { tripId: string; plan: TripPlan; nodeId: string | null }) {
  const [category, setCategory] = useState(DISCOVERY_CATEGORIES[0]?.key ?? 'attractions');
  const [radiusKm, setRadiusKm] = useState<DistanceKm>(10);
  const [sort, setSort] = useState<RecommendationSort>('relevance');
  /** The latest finished request, keyed by what was asked (so a newer request shows as loading). */
  const [result, setResult] = useState<{ key: string; places: PlaceDetails[]; nextPageToken: string | null; error: PlacesErrorKind | null; fetchedAt: string | null; from: 'live' | 'cache' | 'stale_cache' | null } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);
  const [adding, setAdding] = useState<PlaceDetails | null>(null);
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);

  const context = useMemo(() => contextLocation(plan.nodes, nodeId), [plan.nodes, nodeId]);
  const current = nodeId ? plan.nodes.find((n) => n.id === nodeId) ?? null : null;
  // Already in the plan: same id, or the same name at about the same spot (places typed in by hand).
  const isInPlan = useMemo(() => planMatcher(plan.nodes), [plan.nodes]);
  const selected = DISCOVERY_CATEGORIES.find((c) => c.key === category) ?? DISCOVERY_CATEGORIES[0];
  const latitude = context?.location.latitude;
  const longitude = context?.location.longitude;
  // "Nearest" asks the service for the closest places; Popular and Top rated share one request.
  const rank = sort === 'distance' ? 'distance' : 'popularity';

  const requestKey = `${latitude},${longitude},${selected?.key},${radiusKm},${rank},${attempt}`;
  useEffect(() => {
    if (!placesProvider.configured || latitude === undefined || longitude === undefined || !selected) return;
    const controller = new AbortController();
    const key = `${latitude},${longitude},${selected.key},${radiusKm},${rank},${attempt}`;
    getRepositories()
      .then(({ remoteCache }) =>
        loadRecommendations(
          { category: selected, location: { latitude, longitude }, radiusKm, sort: rank === 'distance' ? 'distance' : 'relevance' },
          { provider: placesProvider, cache: remoteCache, signal: controller.signal },
        ),
      )
      .then((page) => !controller.signal.aborted && setResult({ key, places: page.places, nextPageToken: page.nextPageToken, error: null, fetchedAt: page.fetchedAt, from: page.from }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setResult({ key, places: [], nextPageToken: null, error: isPlacesError(error) ? error.kind : 'unknown', fetchedAt: null, from: null });
      });
    return () => controller.abort();
  }, [latitude, longitude, selected, radiusKm, rank, attempt]);

  const current_ = result && result.key === requestKey ? result : null;
  const status = current_ === null ? 'loading' : current_.error ? 'error' : 'ready';
  const errorKind = current_?.error ?? null;
  const recs = context && current_ ? rankRecommendations(current_.places, context.location, radiusKm, isInPlan, sort) : [];
  const googleContent = recs.some((r) => r.place.provider === 'google');

  async function loadMore() {
    if (!current_?.nextPageToken || !selected || latitude === undefined || longitude === undefined) return;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const { remoteCache } = await getRepositories();
      const page = await loadRecommendations(
        { category: selected, location: { latitude, longitude }, radiusKm, sort: rank === 'distance' ? 'distance' : 'relevance', pageToken: current_.nextPageToken },
        { provider: placesProvider, cache: remoteCache },
      );
      setResult((r) => (r && r.key === current_.key ? { ...r, places: [...r.places, ...page.places], nextPageToken: page.nextPageToken } : r));
    } catch (error) {
      setMoreError(describeRecommendationError(isPlacesError(error) ? error.kind : 'unknown').title);
    } finally {
      setLoadingMore(false);
    }
  }

  const place = (target: Placement) => {
    const chosen = adding;
    if (!chosen) return;
    setMessage(null);
    const parentId = target === 'main' ? null : nodeId;
    usePlannerStore
      .getState()
      .addNode(tripId, { place: toPlaceInput(chosen), parentId, addToRoute: target === 'route' })
      .then((result) =>
        setMessage({
          tone: 'success',
          text: result.status === 'duplicate' ? `${chosen.name} is already in your plan.` : `${chosen.name} added${target === 'route' ? ' and placed on your route' : ''}.`,
        }),
      )
      .catch((error: unknown) => setMessage({ tone: 'danger', text: toErrorMessage(error, 'Could not add it.') }));
  };

  const placements: SheetAction[] = adding
    ? [
        ...(current
          ? [
              { key: 'inside', label: `Add under ${current.name}`, icon: 'subdirectory-arrow-right' as const, description: 'As a place inside this destination', onPress: () => place('inside') },
              { key: 'route', label: 'Add as a route stop', icon: 'map-marker-path' as const, description: `Kept inside ${current.name} and added to the end of your route`, onPress: () => place('route') },
            ]
          : []),
        { key: 'main', label: 'Add as a main destination', icon: 'map-marker-radius' as const, description: 'One of this trip’s destinations', onPress: () => place('main') },
      ]
    : [];

  if (!placesProvider.configured) {
    return (
      <Notice
        tone="info"
        icon="google-maps"
        title="Place recommendations are switched off in this build"
        message="Nothing is shown instead of real places. You can still add places by name."
        testID="rec-unconfigured"
      />
    );
  }
  if (!context) {
    return (
      <Notice
        tone="info"
        icon="map-marker-question-outline"
        title="Choose a location first"
        message={`Recommendations are searched around a verified location. Set the location of ${current?.name ?? 'this destination'} on its page to see places nearby.`}
        testID="rec-no-location"
      />
    );
  }

  return (
    <View style={styles.container} testID="recommendations">
      <AppText variant="caption" tone="textMuted">
        Around {context.from.name}
        {context.from.id !== nodeId ? ' (the nearest place with a location)' : ''}.
      </AppText>
      <SourceBadge
        source={googleContent || !placesProvider.source ? { kind: 'live', name: 'Google Maps', attribution: 'Data © Google' } : placesProvider.source}
        from={current_?.from ?? null}
        fetchedAt={current_?.fetchedAt ?? null}
      />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {DISCOVERY_CATEGORIES.map((c) => (
          <OptionTile key={c.key} layout="chip" label={c.label} icon={c.icon} selected={c.key === category} onPress={() => setCategory(c.key)} testID={`rec-cat-${c.key}`} />
        ))}
      </ScrollView>
      <View style={styles.filters}>
        {DISTANCE_FILTERS_KM.map((km) => (
          <OptionTile key={km} layout="chip" label={`${km} km`} icon="map-marker-distance" selected={km === radiusKm} onPress={() => setRadiusKm(km)} testID={`rec-km-${km}`} />
        ))}
      </View>
      <View style={styles.filters}>
        {(['relevance', 'distance', 'rating'] as const).map((s) => (
          <OptionTile key={s} layout="chip" label={s === 'relevance' ? 'Popular' : s === 'distance' ? 'Nearest' : 'Top rated'} icon={s === 'distance' ? 'sort-numeric-ascending' : 'sort'} selected={s === sort} onPress={() => setSort(s)} testID={`rec-sort-${s}`} />
        ))}
      </View>
      {message ? <Notice tone={message.tone} title={message.text} testID="rec-message" /> : null}
      {sort === 'rating' && status === 'ready' && recs.length > 0 ? (
        <AppText variant="caption" tone="textMuted" testID="rec-rating-note">
          {hasRatings(recs.map((r) => r.place)) ? 'Places without ratings are listed last.' : 'No ratings are available for these places, so they keep their usual order.'}
        </AppText>
      ) : null}
      {status === 'loading' ? (
        <LoadingState label="Finding places nearby…" />
      ) : status === 'error' ? (
        (() => {
          const info = describeRecommendationError(errorKind ?? 'unknown');
          return (
            <Notice
              tone="warning"
              title={info.title}
              message={info.message}
              action={info.retry ? { label: 'Retry', icon: 'refresh', onPress: () => setAttempt((n) => n + 1) } : undefined}
              testID={`rec-error-${errorKind ?? 'unknown'}`}
            />
          );
        })()
      ) : recs.length === 0 && status === 'ready' ? (
        <AppText variant="caption" tone="textMuted" testID="rec-empty">
          No {selected?.label.toLowerCase()} found within {radiusKm} km. Try a larger distance or another category.
        </AppText>
      ) : (
        <View style={styles.list}>
          {recs.map((rec) => (
            <RecommendationCard key={rec.place.providerPlaceId} rec={rec} onAdd={() => setAdding(rec.place)} />
          ))}
          {current_?.nextPageToken ? (
            <Button label="Show more places" icon="chevron-down" variant="secondary" size="sm" loading={loadingMore} onPress={() => void loadMore()} testID="rec-more" />
          ) : null}
          {moreError ? <Notice tone="warning" title={moreError} testID="rec-more-error" /> : null}
        </View>
      )}
      {recs.length > 0 ? (
        <AppText variant="caption" tone="textMuted">
          {!googleContent
            ? 'Adding a place saves its name and location in your plan. Map data credits: Profile → Data sources.'
            : 'Data, ratings and photos © Google. Shown live; only a place’s name, ID and location are saved when you add it.'}
        </AppText>
      ) : null}
      <ActionSheet
        visible={adding !== null}
        title={adding ? `Add ${adding.name}` : ''}
        subtitle="Choose one place for it — it is not added anywhere else"
        actions={placements}
        onClose={() => setAdding(null)}
        testID="rec-placement"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.md,
  },
  chips: {
    gap: spacing.sm,
  },
  filters: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  list: {
    gap: spacing.md,
  },
  card: {
    overflow: 'hidden',
  },
  photo: {
    width: '100%',
    height: 160,
    backgroundColor: colors.surfaceRaised,
  },
  photoCredit: {
    position: 'absolute',
    left: spacing.sm,
    bottom: spacing.xs,
    right: spacing.sm,
  },
  cardBody: {
    padding: spacing.md,
    gap: spacing.xs,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  added: {
    width: 36,
    height: 36,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
  },
  flex: {
    flex: 1,
    minWidth: 0,
  },
});
