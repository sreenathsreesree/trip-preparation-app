import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText, Button, Icon, LoadingState, Notice, TextField } from '@/components/ui';
import { colors, radii, spacing } from '@/theme';

import type { GeoPoint } from '../../planner/model';
import { placesProvider } from '../config';
import { MIN_QUERY, usePlaceAutocomplete } from '../placeSearch';
import type { PlaceDetails } from '../provider';
import { PlaceRow } from './PlacePicker';
import { isLocationText, useResolvedLocation } from './useResolvedLocation';

/**
 * The place name field that searches as you type, like a maps app. Suggestions
 * (name, locality, district, state) appear under it; tapping one fills the
 * name, address and coordinates at once, ready to save. A pasted Maps link or
 * coordinates is read automatically. Without a pick, the typed name is kept as
 * a place without a map location — nothing is ever guessed.
 */
export function PlaceSearchField({
  label,
  value,
  onChangeText,
  picked,
  onPick,
  onClearPick,
  bias,
  placeholder = 'Search places',
  error,
  maxLength,
  testID,
}: {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  picked: PlaceDetails | null;
  onPick: (place: PlaceDetails) => void;
  onClearPick: () => void;
  bias?: GeoPoint | null;
  placeholder?: string;
  error?: string;
  maxLength?: number;
  testID: string;
}) {
  const [focusedOnce, setFocusedOnce] = useState(false);
  const searching = !picked && focusedOnce;
  const linkMode = isLocationText(value);
  const search = usePlaceAutocomplete(value, bias, searching && !linkMode);
  const resolved = useResolvedLocation(searching ? value : '');

  return (
    <View style={styles.group}>
      <TextField
        label={label}
        placeholder={placeholder}
        value={value}
        onChangeText={(text) => {
          setFocusedOnce(true);
          onChangeText(text);
        }}
        onFocus={() => setFocusedOnce(true)}
        error={error}
        maxLength={maxLength}
        autoCapitalize="words"
        autoCorrect={false}
        testID={testID}
      />

      {picked ? (
        <View style={styles.picked} testID={`${testID}-picked`}>
          <Icon name="map-marker-check" tone="accent" />
          <View style={styles.flex}>
            <AppText variant="bodyStrong" numberOfLines={1}>
              {picked.name}
            </AppText>
            {picked.formattedAddress ? (
              <AppText variant="caption" tone="textMuted" numberOfLines={2}>
                {picked.formattedAddress}
              </AppText>
            ) : null}
            {picked.location ? (
              <AppText variant="caption" tone="textMuted" selectable testID={`${testID}-coordinates`}>
                {picked.location.latitude.toFixed(5)}, {picked.location.longitude.toFixed(5)}
              </AppText>
            ) : null}
          </View>
          <Button label="Change" variant="ghost" size="sm" onPress={onClearPick} testID={`${testID}-unpick`} />
        </View>
      ) : null}

      {searching && linkMode ? (
        resolved.status === 'loading' ? (
          <LoadingState label="Finding that location…" />
        ) : resolved.status === 'done' && resolved.result.status === 'located' ? (
          <PlaceRow place={resolved.result.place} onPress={() => resolved.result.status === 'located' && onPick(resolved.result.place)} trailing="Use" testID={`${testID}-resolved`} />
        ) : resolved.status === 'done' && resolved.result.status === 'choose' ? (
          <View style={styles.group}>
            {resolved.result.candidates.map((place) => (
              <PlaceRow key={place.providerPlaceId} place={place} onPress={() => onPick(place)} testID={`${testID}-suggestion`} />
            ))}
          </View>
        ) : resolved.status === 'done' && resolved.result.status === 'unresolved' ? (
          <Notice tone="warning" title="Couldn’t read that location" message={resolved.result.reason} testID={`${testID}-unresolved`} />
        ) : null
      ) : null}

      {searching && !linkMode && value.trim().length >= MIN_QUERY ? (
        !placesProvider.configured ? null : search.status === 'loading' ? (
          <LoadingState label="Searching places…" />
        ) : search.status === 'error' ? (
          <Notice tone="warning" title={search.message} message="You can still add it by name and set the location later." testID={`${testID}-error`} />
        ) : search.status === 'ready' && search.places.length === 0 ? (
          <AppText variant="caption" tone="textMuted" testID={`${testID}-empty`}>
            No matching places. Try fewer words or the nearest town — or keep the name and add it without a location.
          </AppText>
        ) : search.status === 'ready' ? (
          <View style={styles.group} testID={`${testID}-suggestions`}>
            <AppText variant="label" tone="textMuted">
              Location suggestions
            </AppText>
            {search.usedQuery && search.usedQuery.toLowerCase() !== value.trim().toLowerCase() ? (
              <AppText variant="caption" tone="textMuted">
                Showing results for “{search.usedQuery}”
              </AppText>
            ) : null}
            {search.places.map((place) => (
              <Pressable
                key={place.providerPlaceId}
                accessibilityRole="button"
                accessibilityLabel={`${place.name}${place.formattedAddress ? `, ${place.formattedAddress}` : ''}`}
                onPress={() => onPick(place)}
                style={({ pressed }) => [styles.suggestion, pressed && styles.pressed]}
                testID={`${testID}-suggestion`}
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
              </Pressable>
            ))}
          </View>
        ) : null
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: spacing.sm },
  flex: { flex: 1, minWidth: 0 },
  picked: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.accentBorder,
    backgroundColor: colors.accentSoft,
  },
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
