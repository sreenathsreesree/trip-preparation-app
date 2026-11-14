import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText, Icon, LoadingState, Notice, SearchField } from '@/components/ui';
import { colors, radii, spacing } from '@/theme';

import type { GeoPoint } from '../../planner/model';
import { placesProvider } from '../config';
import { usePlaceAutocomplete } from '../placeSearch';
import type { PlaceDetails } from '../provider';
import { parseCoordinates } from '../sharedLocation';
import { useResolvedLocation } from './useResolvedLocation';

const LINKISH = /(?:https?:\/\/|geo:)\S+/i;

/** Whether text should be resolved as a link/coordinates rather than searched by name. */
export const looksLikeLocation = (text: string) => LINKISH.test(text) || parseCoordinates(text.trim()) !== null;

export function PlaceRow({ place, onPress, testID, trailing }: { place: PlaceDetails; onPress?: () => void; testID?: string; trailing?: string }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${place.name}${place.formattedAddress ? `, ${place.formattedAddress}` : ''}`}
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => [styles.result, pressed && styles.pressed]}
      testID={testID}
    >
      <Icon name="map-marker-outline" tone="info" />
      <View style={styles.flex}>
        <AppText variant="bodyStrong" numberOfLines={1}>
          {place.name}
        </AppText>
        {place.formattedAddress ? (
          <AppText variant="caption" tone="textMuted" numberOfLines={2}>
            {place.formattedAddress}
          </AppText>
        ) : null}
      </View>
      {trailing ? (
        <AppText variant="captionStrong" tone="info">
          {trailing}
        </AppText>
      ) : null}
    </Pressable>
  );
}

/**
 * One field for finding a place: type a name for suggestions (debounced,
 * OpenStreetMap), or paste a Google Maps link (long or short) or coordinates.
 * Nothing is saved here — `onPick` hands the chosen place to the caller, which
 * shows a preview and saves only when the user confirms.
 */
export function PlacePicker({
  onPick,
  bias,
  placeholder = 'Search places, or paste a Maps link or coordinates',
  testID = 'place-picker',
}: {
  onPick: (place: PlaceDetails) => void;
  bias?: GeoPoint | null;
  placeholder?: string;
  testID?: string;
}) {
  const [text, setText] = useState('');
  const linkMode = looksLikeLocation(text);
  const search = usePlaceAutocomplete(text, bias, !linkMode);
  const resolved = useResolvedLocation(text);

  return (
    <View style={styles.group} testID={testID}>
      <SearchField value={text} onChangeText={setText} placeholder={placeholder} testID={`${testID}-input`} />
      {linkMode ? (
        resolved.status === 'loading' ? (
          <LoadingState label="Finding that location…" />
        ) : resolved.status === 'done' && resolved.result.status === 'located' ? (
          <PlaceRow place={resolved.result.place} onPress={() => resolved.result.status === 'located' && onPick(resolved.result.place)} trailing="Use" testID={`${testID}-resolve`} />
        ) : resolved.status === 'done' && resolved.result.status === 'choose' ? (
          resolved.result.candidates.map((place) => <PlaceRow key={place.providerPlaceId} place={place} onPress={() => onPick(place)} testID={`${testID}-candidate`} trailing="Choose" />)
        ) : resolved.status === 'done' && resolved.result.status === 'unresolved' ? (
          <Notice tone="warning" title="Couldn’t read that location" message={resolved.result.reason} testID={`${testID}-problem`} />
        ) : null
      ) : null}

      {!linkMode && !placesProvider.configured && text.trim() ? (
        <AppText variant="caption" tone="textMuted">
          Place search is turned off in this build. Paste a Google Maps link or coordinates instead.
        </AppText>
      ) : null}
      {!linkMode && search.status === 'loading' ? <LoadingState label="Searching places…" /> : null}
      {!linkMode && search.status === 'error' ? <Notice tone="warning" title={search.message} testID={`${testID}-error`} /> : null}
      {!linkMode && search.status === 'ready' ? (
        search.places.length === 0 ? (
          <AppText variant="caption" tone="textMuted" testID={`${testID}-empty`}>
            No places found for “{text.trim()}”. Try fewer words, the nearest town, or paste a Google Maps link.
          </AppText>
        ) : (
          <View style={styles.group} testID={`${testID}-results`}>
            <AppText variant="label" tone="textMuted">
              Location suggestions
            </AppText>
            {search.usedQuery && search.usedQuery.toLowerCase() !== text.trim().toLowerCase() ? (
              <AppText variant="caption" tone="textMuted">
                Showing results for “{search.usedQuery}”
              </AppText>
            ) : null}
            {search.places.map((place) => (
              <PlaceRow key={place.providerPlaceId} place={place} onPress={() => onPick(place)} testID={`${testID}-result`} />
            ))}
          </View>
        )
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  group: {
    gap: spacing.sm,
  },
  result: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  pressed: {
    backgroundColor: colors.surfacePressed,
  },
  flex: {
    flex: 1,
    minWidth: 0,
  },
});
