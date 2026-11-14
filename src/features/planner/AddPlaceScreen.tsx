import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Screen } from '@/components/layout/Screen';
import { goBackOrHome, ScreenHeader } from '@/components/layout/ScreenHeader';
import {
  AppText,
  Button,
  EmptyState,
  Icon,
  LoadingState,
  Notice,
  OptionTile,
  TextField,
  ToggleRow,
} from '@/components/ui';
import { toErrorMessage } from '@/lib/errors';
import { successFeedback } from '@/lib/haptics';
import { colors, radii, spacing } from '@/theme';

import { PlacePicker, PlaceRow } from '../places/components/PlacePicker';
import { placesProvider } from '../places/config';
import { toPlaceInput } from '../places/placeInput';
import type { PlaceDetails } from '../places/provider';
import { findSamePlace } from '../places/sharedLocation';
import { useTrip } from '../trips/hooks';
import type { TripSummary } from '../trips/model';
import { ancestorIds, PLANNER_LIMITS, validateNodeName, type Place, type PlanNode } from './model';
import { Recommendations } from './components/Recommendations';
import { usePlannerStore, useTripPlan } from './plannerStore';

function Form({ trip, parent }: { trip: TripSummary; parent: PlanNode | null }) {
  const plan = useTripPlan(trip.id).plan;
  const [parentId, setParentId] = useState<string | null>(parent?.id ?? null);
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  // Main destinations usually are stops; places inside usually are not. Always the user's choice.
  const [addToRoute, setAddToRoute] = useState(!parent);
  const [revealed, setRevealed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<PlanNode | null>(null);
  // Hand-entered places have no provider id to dedupe on, so a same-name match asks first.
  const [sameName, setSameName] = useState<PlanNode | null>(null);
  const [saved, setSaved] = useState<Place[] | null>(null);
  const [picked, setPicked] = useState<PlaceDetails | null>(null);
  const nameError = validateNodeName(name);
  // A second tap while saving must not add the place twice.
  const inFlight = useRef(false);

  useEffect(() => {
    let cancelled = false;
    usePlannerStore
      .getState()
      .savedPlaces()
      .then((places) => !cancelled && setSaved(places))
      .catch(() => !cancelled && setSaved([]));
    return () => {
      cancelled = true;
    };
  }, []);

  const inPlan = new Set((plan?.nodes ?? []).flatMap((n) => (n.placeId ? [n.placeId] : [])));
  const reusable = (saved ?? []).filter((p) => p.provider !== 'manual');
  const where = parentId && plan ? [...ancestorIds(plan.nodes, parentId).reverse(), parentId] : [];
  const whereText = where
    .map((id) => plan?.nodes.find((n) => n.id === id)?.name)
    .filter(Boolean)
    .join(' › ');

  async function add(input: { name?: string; place?: Place | ReturnType<typeof toPlaceInput> }) {
    if (inFlight.current) return;
    inFlight.current = true;
    setSaving(true);
    setError(null);
    setDuplicate(null);
    try {
      const result = await usePlannerStore.getState().addNode(trip.id, {
        parentId,
        name: input.name,
        notes: input.place ? '' : notes,
        addToRoute,
        place: input.place
          ? {
              provider: input.place.provider,
              providerPlaceId: input.place.providerPlaceId,
              name: input.place.name || input.name || '',
              location: input.place.location,
              formattedAddress: input.place.formattedAddress,
              types: input.place.types,
              district: input.place.district,
              state: input.place.state,
              country: input.place.country,
              metadata: input.place.metadata,
            }
          : null,
      });
      if (result.status === 'duplicate') {
        setDuplicate(result.node);
        setSaving(false);
        inFlight.current = false;
        return;
      }
      successFeedback();
      goBackOrHome();
    } catch (err) {
      setError(toErrorMessage(err, 'Could not add the place.'));
      setSaving(false);
      inFlight.current = false;
    }
  }

  return (
    <Screen
      testID="plan-add"
      footer={
        <View style={styles.footer}>
          <Button label="Cancel" variant="secondary" onPress={goBackOrHome} disabled={saving} />
          <Button
            label={parentId ? 'Add place' : 'Add destination'}
            icon="plus"
            onPress={() => {
              setRevealed(true);
              if (picked) {
                const label = name.trim() || picked.name;
                const same = findSamePlace(plan?.nodes ?? [], { ...picked, name: label });
                if (same && sameName?.id !== same.id) {
                  setSameName(same);
                  return;
                }
                void add({ name: label, place: toPlaceInput(picked) });
                return;
              }
              if (nameError) return;
              const match = plan?.nodes.find((n) => n.name.trim().toLowerCase() === name.trim().toLowerCase());
              if (match && sameName?.id !== match.id) {
                setSameName(match);
                return;
              }
              void add({ name });
            }}
            loading={saving}
            style={styles.primary}
            testID="plan-add-save"
          />
        </View>
      }
    >
      <ScreenHeader showBack backIcon="close" eyebrow={trip.name} title={parentId ? 'Add a place' : 'Add a destination'} />

      {parent ? (
        <View style={styles.group}>
          <AppText variant="label" tone="textSecondary">
            Add as
          </AppText>
          <View style={styles.chips}>
            <OptionTile
              layout="chip"
              label={`Inside ${parent.name}`}
              icon="subdirectory-arrow-right"
              selected={parentId === parent.id}
              onPress={() => {
                setParentId(parent.id);
                setAddToRoute(false);
              }}
              testID="plan-add-inside"
            />
            <OptionTile
              layout="chip"
              label="Main destination"
              icon="map-marker-radius"
              selected={parentId === null}
              onPress={() => {
                setParentId(null);
                setAddToRoute(true);
              }}
              testID="plan-add-main"
            />
          </View>
          {whereText ? (
            <AppText variant="caption" tone="textMuted">
              In: {whereText}
            </AppText>
          ) : null}
        </View>
      ) : null}

      {!placesProvider.configured ? (
        <Notice
          tone="info"
          icon="magnify-close"
          title="Place search is not set up yet"
          message="Add places by name, or paste a Google Maps link or coordinates below."
          testID="plan-add-search-unavailable"
        />
      ) : null}

      {picked ? (
        <View style={styles.group} testID="plan-add-picked">
          <AppText variant="label" tone="textSecondary">
            Location
          </AppText>
          <PlaceRow place={picked} />
          {picked.location ? (
            <AppText variant="caption" tone="textMuted" selectable>
              {picked.location.latitude.toFixed(5)}, {picked.location.longitude.toFixed(5)}
            </AppText>
          ) : null}
          <Button label="Choose a different place" icon="close" variant="ghost" size="sm" onPress={() => setPicked(null)} style={styles.left} testID="plan-add-unpick" />
        </View>
      ) : (
        <View style={styles.group}>
          <AppText variant="label" tone="textSecondary">
            Find on the map
          </AppText>
          <PlacePicker
            bias={parent?.place?.location ?? null}
            onPick={(place) => {
              setPicked(place);
              setSameName(null);
              setDuplicate(null);
              if (!name.trim()) setName(place.name);
            }}
            testID="plan-add-picker"
          />
        </View>
      )}

      <TextField
        label="Name"
        placeholder={parentId ? 'e.g. Echo Point' : 'e.g. Munnar'}
        value={name}
        onChangeText={(value) => {
          setName(value);
          setDuplicate(null);
          setSameName(null);
        }}
        error={revealed ? (nameError ?? undefined) : undefined}
        maxLength={PLANNER_LIMITS.nameMax}
        autoCapitalize="words"
        testID="plan-add-name"
      />
      <TextField
        label="Notes (optional)"
        placeholder="Timings, tickets, who suggested it…"
        value={notes}
        onChangeText={setNotes}
        maxLength={PLANNER_LIMITS.notesMax}
        multiline
        testID="plan-add-notes"
      />
      <ToggleRow
        icon="map-marker-path"
        label="Add to route"
        description={
          addToRoute
            ? 'Added as the last stop of your route.'
            : 'Kept in your plan only. You can add it to the route any time.'
        }
        value={addToRoute}
        onChange={setAddToRoute}
        testID="plan-add-route"
      />

      {duplicate ? (
        <Notice
          tone="warning"
          title="Already in this plan"
          message={`"${duplicate.name}" is already planned${duplicate.parentId ? ' inside another place' : ' as a main destination'}. Nothing was added twice.`}
          action={{
            label: 'Open it',
            onPress: () =>
              router.replace({ pathname: '/trips/[tripId]/plan/place/[nodeId]', params: { tripId: trip.id, nodeId: duplicate.id } }),
          }}
          testID="plan-add-duplicate"
        />
      ) : null}
      {sameName ? (
        <Notice
          tone="warning"
          title={`"${sameName.name}" is already in this plan`}
          message="Tap Add again if this is a different place."
          testID="plan-add-same-name"
        />
      ) : null}
      {error ? <Notice tone="danger" title="Not added" message={error} /> : null}

      {saved === null ? (
        <LoadingState label="Loading saved places…" />
      ) : reusable.length > 0 ? (
        <View style={styles.group}>
          <AppText variant="label" tone="textSecondary">
            Your saved places
          </AppText>
          {reusable.map((place) => {
            const added = inPlan.has(place.id);
            return (
              <Pressable
                key={place.id}
                accessibilityRole="button"
                accessibilityLabel={added ? `${place.name}, already in this plan` : `Add ${place.name}`}
                accessibilityState={{ disabled: added }}
                disabled={added || saving}
                onPress={() => void add({ name: place.name, place })}
                style={({ pressed }) => [styles.saved, pressed && styles.pressed]}
              >
                <Icon name={added ? 'check-circle' : 'map-marker-plus-outline'} tone={added ? 'accent' : 'info'} />
                <View style={styles.flex}>
                  <AppText variant="bodyStrong" numberOfLines={1}>
                    {place.name || 'Saved place (details need a refresh)'}
                  </AppText>
                  {place.formattedAddress ? (
                    <AppText variant="caption" tone="textMuted" numberOfLines={1}>
                      {place.formattedAddress}
                    </AppText>
                  ) : null}
                </View>
                <AppText variant="captionStrong" tone={added ? 'accent' : 'info'}>
                  {added ? 'Added' : 'Add'}
                </AppText>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {plan ? (
        <View style={styles.group}>
          <AppText variant="label" tone="textSecondary">
            {parentId ? 'Recommended nearby' : 'Recommended places'}
          </AppText>
          <Recommendations tripId={trip.id} plan={plan} nodeId={parentId} />
        </View>
      ) : null}
    </Screen>
  );
}

export function AddPlaceScreen({ tripId, parentId }: { tripId: string | undefined; parentId?: string }) {
  const { trip, status } = useTrip(tripId);
  const planState = useTripPlan(tripId);
  useEffect(() => {
    if (tripId && planState.status === 'idle') void usePlannerStore.getState().load(tripId);
  }, [tripId, planState.status]);

  const parent = parentId ? (planState.plan?.nodes.find((n) => n.id === parentId) ?? null) : null;
  if (trip && planState.plan && (!parentId || parent)) {
    return <Form key={parentId ?? 'main'} trip={trip} parent={parent} />;
  }
  return (
    <Screen bottomInset>
      <ScreenHeader showBack backIcon="close" title="Add a place" />
      {status === 'ready' && planState.status === 'ready' ? (
        <EmptyState icon="map-marker-question-outline" title="Not found" message="The trip or place may have been removed." />
      ) : (
        <LoadingState label="Loading…" />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  footer: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  primary: {
    flex: 1,
  },
  left: {
    alignSelf: 'flex-start',
  },
  group: {
    gap: spacing.sm,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  saved: {
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
    opacity: 0.8,
  },
  flex: {
    flex: 1,
    minWidth: 0,
  },
});
