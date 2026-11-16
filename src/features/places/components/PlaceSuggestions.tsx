import { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { AppText, Icon, LoadingState, Notice } from '@/components/ui';
import { colors, radii, spacing } from '@/theme';

import { formatDistance } from '../discovery';
import type { GeoPoint } from '../../planner/model';
import { placesProvider } from '../config';
import { createSessionToken, describeSearchError, MIN_QUERY, resolveSuggestion, usePlaceAutocomplete } from '../placeSearch';
import type { PlaceDetails, PlaceSuggestion } from '../provider';

/**
 * Suggestions while typing (name, then locality / district / state). Tapping
 * one loads that place's details once — name, address, coordinates, Place ID —
 * and hands it to `onPick`, ready to save. Used by every place-entry field.
 */
export function PlaceSuggestions({
  query,
  bias,
  enabled,
  onPick,
  emptyHint = 'No matching places. Try fewer words or the nearest town — or keep the name and add it without a location.',
  testID,
}: {
  query: string;
  bias?: GeoPoint | null;
  enabled: boolean;
  onPick: (place: PlaceDetails) => void;
  emptyHint?: string;
  testID: string;
}) {
  const [sessionToken, setSessionToken] = useState(createSessionToken);
  const [resolving, setResolving] = useState<string | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);
  const pending = useRef<AbortController | null>(null);
  const search = usePlaceAutocomplete(query, bias, enabled, sessionToken);

  if (!enabled || query.trim().length < MIN_QUERY || !placesProvider.configured) return null;

  async function pick(s: PlaceSuggestion) {
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setResolving(s.providerPlaceId);
    setPickError(null);
    try {
      const place = await resolveSuggestion(s, { sessionToken, signal: controller.signal });
      if (controller.signal.aborted) return;
      onPick(place);
    } catch (error) {
      if (!controller.signal.aborted) setPickError(describeSearchError(error));
    } finally {
      if (!controller.signal.aborted) {
        setResolving(null);
        // The session ends with the details call; the next search starts a new one.
        setSessionToken(createSessionToken());
      }
    }
  }

  return (
    <View style={styles.group}>
      {pickError ? <Notice tone="warning" title={pickError} message="You can keep the name and add it without a map location." testID={`${testID}-pick-error`} /> : null}
      {search.status === 'loading' ? (
        <LoadingState label="Searching places…" />
      ) : search.status === 'error' ? (
        <Notice tone="warning" title={search.message} message="You can still add it by name and set the location later." testID={`${testID}-error`} />
      ) : search.status === 'ready' && search.suggestions.length === 0 ? (
        <AppText variant="caption" tone="textMuted" testID={`${testID}-empty`}>
          {emptyHint}
        </AppText>
      ) : search.status === 'ready' ? (
        <View style={styles.group} testID={`${testID}-suggestions`}>
          <AppText variant="label" tone="textMuted">
            Location suggestions
          </AppText>
          {search.usedQuery && search.usedQuery.toLowerCase() !== query.trim().toLowerCase() ? (
            <AppText variant="caption" tone="textMuted">
              Showing results for “{search.usedQuery}”
            </AppText>
          ) : null}
          {search.suggestions.map((s) => (
            <Pressable
              key={s.providerPlaceId}
              accessibilityRole="button"
              accessibilityLabel={`${s.primaryText}${s.secondaryText ? `, ${s.secondaryText}` : ''}`}
              accessibilityState={{ busy: resolving === s.providerPlaceId }}
              disabled={resolving !== null}
              onPress={() => void pick(s)}
              style={({ pressed }) => [styles.suggestion, pressed && styles.pressed]}
              testID={`${testID}-suggestion`}
            >
              <Icon name="map-marker-outline" tone="info" />
              <View style={styles.flex}>
                <AppText variant="bodyStrong" numberOfLines={1}>
                  {s.primaryText}
                </AppText>
                {s.secondaryText ? (
                  <AppText variant="caption" tone="textMuted" numberOfLines={2}>
                    {s.secondaryText}
                  </AppText>
                ) : null}
              </View>
              {resolving === s.providerPlaceId ? (
                <ActivityIndicator color={colors.accent} accessibilityLabel="Loading place details" />
              ) : s.distanceMeters !== null ? (
                <AppText variant="caption" tone="textMuted">
                  {formatDistance(s.distanceMeters)}
                </AppText>
              ) : null}
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: spacing.sm },
  flex: { flex: 1, minWidth: 0 },
  suggestion: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 56,
    padding: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  pressed: { backgroundColor: colors.surfacePressed },
});
