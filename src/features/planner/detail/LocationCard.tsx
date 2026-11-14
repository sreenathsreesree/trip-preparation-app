import { useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';

import { AppText, Button, Card, Icon, Notice, TextField } from '@/components/ui';
import { toErrorMessage } from '@/lib/errors';
import { colors, radii, spacing } from '@/theme';

import { daysUntilRefresh } from '../../places/cachePolicy';
import { PlacePicker, PlaceRow } from '../../places/components/PlacePicker';
import { placeLink } from '../../places/mapsLinks';
import { toPlaceInput } from '../../places/placeInput';
import type { PlaceDetails } from '../../places/provider';
import { formatCoordinates, parseLocation } from '../locationInput';
import type { PlaceInput } from '../model';
import { usePlannerStore } from '../plannerStore';
import type { DetailContext } from './shared';

/** Where the place is: address/coordinates, Open in Maps, and choosing or changing the location. */
export function LocationCard({ ctx }: { ctx: DetailContext }) {
  const { tripId, node } = ctx;
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [picked, setPicked] = useState<PlaceDetails | null>(null);
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
      setPicked(null);
    } catch (err) {
      setError(toErrorMessage(err, 'Could not save the location.'));
    }
  }

  return (
    <Card testID="detail-location" padding="md">
      <View style={styles.head}>
        <Icon name="map-marker-outline" size={20} color={location ? colors.accent : colors.textMuted} />
        <View style={[styles.flex, styles.info]}>
          {location ? (
            <>
              <AppText variant="body" numberOfLines={2}>
                {node.place?.formattedAddress || 'Location set'}
              </AppText>
              <AppText variant="caption" tone="textMuted" selectable testID="detail-coordinates">
                {formatCoordinates(location)}
                {refreshIn !== null && node.place?.provider === 'google' ? ` · Google Maps data kept ${refreshIn} more ${refreshIn === 1 ? 'day' : 'days'}` : ''}
              </AppText>
            </>
          ) : node.place ? (
            <AppText variant="caption" tone="warning">
              Saved place whose map details have expired. Choose the location again to refresh it.
            </AppText>
          ) : (
            <AppText variant="caption" tone="textMuted">
              Added by name — not linked to a map location yet.
            </AppText>
          )}
        </View>
      </View>

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
          {picked ? (
            <View style={styles.info} testID="detail-location-preview">
              <PlaceRow place={picked} />
              {picked.location ? (
                <AppText variant="caption" tone="textMuted" selectable>
                  {formatCoordinates(picked.location)}
                </AppText>
              ) : null}
              <View style={styles.row}>
                <Button label="Save this location" icon="content-save-outline" size="sm" onPress={() => void save(toPlaceInput(picked))} testID="detail-location-save-picked" />
                <Button label="Back" variant="ghost" size="sm" onPress={() => setPicked(null)} />
              </View>
            </View>
          ) : (
            <PlacePicker bias={location} onPick={setPicked} testID="detail-location-picker" />
          )}
          <TextField
            label="Or enter coordinates by hand"
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
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  flex: {
    flex: 1,
    minWidth: 0,
  },
  info: {
    gap: spacing.xs,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.sm,
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
