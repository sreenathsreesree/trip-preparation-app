import { useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';

import { AppText, Button, Card, Icon, Notice, SearchField, TextField } from '@/components/ui';
import { toErrorMessage } from '@/lib/errors';
import { colors, radii, spacing } from '@/theme';

import { daysUntilRefresh } from '../../places/cachePolicy';
import { placesProvider } from '../../places/config';
import { placeLink } from '../../places/mapsLinks';
import { isPlacesError, type PlaceDetails } from '../../places/provider';
import { toPlaceInput } from '../components/Recommendations';
import { formatCoordinates, parseLocation } from '../locationInput';
import type { PlaceInput } from '../model';
import { usePlannerStore } from '../plannerStore';
import type { DetailContext } from './shared';

/** Where the place is: address/coordinates, Open in Maps, and choosing or changing the location. */
export function LocationCard({ ctx }: { ctx: DetailContext }) {
  const { tripId, node } = ctx;
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PlaceDetails[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const link = placeLink(node);
  const location = node.place?.location ?? null;
  const refreshIn = daysUntilRefresh(node.place?.fetchedAt ?? null, new Date());
  const parsed = text.trim() ? parseLocation(text) : null;

  async function save(input: PlaceInput | null) {
    setError(null);
    try {
      await usePlannerStore.getState().setNodePlace(tripId, node.id, input);
      setEditing(false);
      setText('');
      setResults(null);
    } catch (err) {
      setError(toErrorMessage(err, 'Could not save the location.'));
    }
  }

  async function search() {
    if (!query.trim()) return;
    setSearching(true);
    setError(null);
    try {
      setResults(await placesProvider.textSearch({ query: query.trim(), bias: location ?? undefined }));
    } catch (err) {
      setResults(null);
      setError(isPlacesError(err) ? 'Place search failed. Check your connection and try again.' : toErrorMessage(err, 'Search failed.'));
    } finally {
      setSearching(false);
    }
  }

  return (
    <Card testID="detail-location">
      <View style={styles.head}>
        <Icon name="map-marker-outline" size={20} color={location ? colors.accent : colors.textMuted} />
        <AppText variant="title" style={styles.flex}>
          Location
        </AppText>
      </View>
      {location ? (
        <View style={styles.info}>
          {node.place?.formattedAddress ? <AppText variant="body">{node.place.formattedAddress}</AppText> : null}
          <AppText variant="caption" tone="textMuted" selectable testID="detail-coordinates">
            {formatCoordinates(location)}
          </AppText>
          {refreshIn !== null && node.place?.provider === 'google' ? (
            <AppText variant="caption" tone="textMuted">
              From Google Maps · stored on this device for {refreshIn} more {refreshIn === 1 ? 'day' : 'days'}
            </AppText>
          ) : null}
        </View>
      ) : node.place ? (
        <AppText variant="caption" tone="warning">
          Saved place whose map details have expired. Choose the location again to refresh it.
        </AppText>
      ) : (
        <AppText variant="caption" tone="textMuted">
          Added by name — not linked to a map location yet.
        </AppText>
      )}

      <View style={styles.row}>
        <Button
          label={link.exact ? 'Open in Maps' : 'Search in Maps'}
          icon="google-maps"
          variant="secondary"
          size="sm"
          onPress={() => void Linking.openURL(link.url)}
          testID="plan-place-maps"
        />
        {!editing ? (
          <Button
            label={node.place ? 'Change location' : 'Choose location'}
            icon="crosshairs-gps"
            variant="ghost"
            size="sm"
            onPress={() => setEditing(true)}
            testID="detail-location-edit"
          />
        ) : null}
      </View>

      {editing ? (
        <View style={styles.editor} testID="detail-location-editor">
          {placesProvider.configured ? (
            <View style={styles.info}>
              <SearchField value={query} onChangeText={setQuery} placeholder="Search Google Maps" testID="detail-location-search" />
              <Button label="Search" icon="magnify" variant="secondary" size="sm" loading={searching} onPress={() => void search()} style={styles.left} />
              {results?.map((place) => (
                <Pressable
                  key={place.providerPlaceId}
                  accessibilityRole="button"
                  onPress={() => void save(toPlaceInput(place))}
                  style={({ pressed }) => [styles.result, pressed && styles.pressed]}
                  testID={`detail-location-result-${place.name}`}
                >
                  <AppText variant="bodyStrong">{place.name}</AppText>
                  {place.formattedAddress ? (
                    <AppText variant="caption" tone="textMuted" numberOfLines={1}>
                      {place.formattedAddress}
                    </AppText>
                  ) : null}
                </Pressable>
              ))}
              {results && results.length === 0 ? (
                <AppText variant="caption" tone="textMuted">
                  No places found.
                </AppText>
              ) : null}
            </View>
          ) : (
            <AppText variant="caption" tone="textMuted" testID="detail-location-search-off">
              Google place search isn’t set up yet. Paste a Google Maps link or coordinates instead.
            </AppText>
          )}
          <TextField
            label="Google Maps link or coordinates"
            placeholder="10.0889, 77.0595"
            value={text}
            onChangeText={setText}
            autoCapitalize="none"
            autoCorrect={false}
            error={parsed && !parsed.ok ? parsed.reason : undefined}
            helper={parsed?.ok ? `Found ${formatCoordinates(parsed.location)}` : 'In Google Maps, long-press the pin and copy the coordinates.'}
            testID="detail-location-input"
          />
          <View style={styles.row}>
            <Button
              label="Save location"
              icon="content-save-outline"
              size="sm"
              disabled={!parsed?.ok}
              onPress={() => {
                if (parsed?.ok) void save({ provider: 'manual', providerPlaceId: null, name: node.name, location: parsed.location });
              }}
              testID="detail-location-save"
            />
            <Button label="Cancel" variant="ghost" size="sm" onPress={() => setEditing(false)} />
            {node.place ? (
              <Button label="Unlink location" icon="link-variant-off" variant="ghost" size="sm" onPress={() => void save(null)} testID="detail-location-unlink" />
            ) : null}
          </View>
        </View>
      ) : null}
      {error ? <Notice tone="danger" title={error} testID="detail-location-error" /> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  flex: {
    flex: 1,
  },
  info: {
    gap: spacing.xs,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  editor: {
    gap: spacing.md,
    marginTop: spacing.md,
  },
  left: {
    alignSelf: 'flex-start',
  },
  result: {
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceRaised,
    gap: spacing.xxs,
  },
  pressed: {
    backgroundColor: colors.surfacePressed,
  },
});
