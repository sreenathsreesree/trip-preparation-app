import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText, Button, Icon, LoadingState, Notice, TextField } from '@/components/ui';
import { colors, radii, spacing } from '@/theme';

import type { GeoPoint } from '../../planner/model';
import type { PlaceDetails } from '../provider';
import { PlaceRow } from './PlacePicker';
import { PlaceSuggestions } from './PlaceSuggestions';
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

      <PlaceSuggestions query={value} bias={bias} enabled={searching && !linkMode} onPick={onPick} testID={testID} />
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
});
