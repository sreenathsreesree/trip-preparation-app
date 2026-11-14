import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText, Button, Icon, LoadingState, Notice, SearchField } from '@/components/ui';
import { colors, radii, spacing } from '@/theme';

import type { GeoPoint } from '../../planner/model';
import { placesProvider } from '../config';
import { usePlaceAutocomplete } from '../placeSearch';
import type { PlaceDetails } from '../provider';
import { parseCoordinates, resolveShare } from '../sharedLocation';

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
  const [resolving, setResolving] = useState(false);
  const [candidates, setCandidates] = useState<PlaceDetails[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  async function lookUp() {
    setResolving(true);
    setProblem(null);
    setCandidates(null);
    try {
      const result = await resolveShare(text, { provider: placesProvider });
      if (result.status === 'located') onPick(result.place);
      else if (result.status === 'choose') setCandidates(result.candidates);
      else setProblem(result.reason);
    } finally {
      setResolving(false);
    }
  }

  return (
    <View style={styles.group} testID={testID}>
      <SearchField
        value={text}
        onChangeText={(value) => {
          setText(value);
          setCandidates(null);
          setProblem(null);
        }}
        placeholder={placeholder}
        testID={`${testID}-input`}
      />
      {linkMode ? (
        <Button label="Find this location" icon="crosshairs-gps" size="sm" variant="secondary" loading={resolving} onPress={() => void lookUp()} style={styles.left} testID={`${testID}-resolve`} />
      ) : null}
      {problem ? <Notice tone="warning" title="Couldn’t read that location" message={problem} testID={`${testID}-problem`} /> : null}
      {candidates?.map((place) => (
        <PlaceRow key={place.providerPlaceId} place={place} onPress={() => onPick(place)} testID={`${testID}-candidate`} trailing="Choose" />
      ))}

      {!linkMode && !placesProvider.configured && text.trim() ? (
        <AppText variant="caption" tone="textMuted">
          Place search is turned off in this build. Paste a Google Maps link or coordinates instead.
        </AppText>
      ) : null}
      {!linkMode && search.status === 'loading' ? <LoadingState label="Searching…" /> : null}
      {!linkMode && search.status === 'error' ? <Notice tone="warning" title={search.message} testID={`${testID}-error`} /> : null}
      {!linkMode && search.status === 'ready' ? (
        search.places.length === 0 ? (
          <AppText variant="caption" tone="textMuted" testID={`${testID}-empty`}>
            No places found for “{text.trim()}”. Try fewer words, the nearest town, or paste a Google Maps link.
          </AppText>
        ) : (
          <View style={styles.group} testID={`${testID}-results`}>
            {search.usedQuery && search.usedQuery.toLowerCase() !== text.trim().toLowerCase() ? (
              <AppText variant="caption" tone="textMuted">
                Showing results for “{search.usedQuery}”
              </AppText>
            ) : null}
            {search.places.map((place) => (
              <PlaceRow key={place.providerPlaceId} place={place} onPress={() => onPick(place)} testID={`${testID}-result`} />
            ))}
            {placesProvider.source ? (
              <AppText variant="caption" tone="textMuted">
                {placesProvider.source.attribution}
              </AppText>
            ) : null}
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
  left: {
    alignSelf: 'flex-start',
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
