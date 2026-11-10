import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText, EmptyState, Notice, OptionTile } from '@/components/ui';
import { toErrorMessage } from '@/lib/errors';
import { spacing } from '@/theme';

import type { InventoryItemSummary } from '../../inventory/model';
import type { Traveller } from '../../trips/model';
import { LUGGAGE_KINDS, LUGGAGE_META, type LuggageKind } from '../model';
import { usePackingStore, type TripPacking } from '../packingStore';
import { BagCard } from './PackingParts';

export function BagsTab({
  tripId,
  travellers,
  packing,
  itemById,
}: {
  tripId: string;
  travellers: readonly Traveller[];
  packing: TripPacking;
  itemById: Map<string, InventoryItemSummary>;
}) {
  const [error, setError] = useState<string | null>(null);
  const store = usePackingStore.getState;
  const travellerNames = useMemo(() => new Map(travellers.map((t) => [t.id, t.name])), [travellers]);
  const weightOf = (itemId: string) => itemById.get(itemId)?.weightGrams ?? null;
  const unassigned = packing.entries.filter((e) => !e.luggageId);

  const openBag = (bagId: string) =>
    router.push({ pathname: '/trips/[tripId]/packing/bag/[bagId]', params: { tripId, bagId } });

  async function add(kind: LuggageKind) {
    setError(null);
    try {
      const bag = await store().addLuggage(tripId, kind);
      // Bags are filled from the bag screen, so open it straight away.
      openBag(bag.id);
    } catch (err) {
      setError(toErrorMessage(err, 'Could not add the bag.'));
    }
  }

  const toggle = (entryId: string) => {
    setError(null);
    store()
      .togglePacked(tripId, entryId)
      .catch((err: unknown) => setError(toErrorMessage(err, 'Could not update the item.')));
  };

  return (
    <View style={styles.container} testID="bags-tab">
      <AppText variant="label" tone="textSecondary">
        Add a bag
      </AppText>
      <View style={styles.wrap}>
        {LUGGAGE_KINDS.map((kind) => (
          <OptionTile
            key={kind}
            layout="chip"
            role="button"
            label={LUGGAGE_META[kind].label}
            icon={LUGGAGE_META[kind].icon}
            selected={false}
            onPress={() => void add(kind)}
            testID={`add-bag-${kind}`}
          />
        ))}
      </View>
      {error ? <Notice tone="danger" title="Not updated" message={error} /> : null}

      {packing.luggage.length === 0 ? (
        <EmptyState
          icon="bag-suitcase-outline"
          title="No bags yet"
          message="Add the bags you are taking, then choose what goes in each. Weights are estimated only from items with a known weight."
        />
      ) : (
        packing.luggage.map((bag) => (
          <BagCard
            key={bag.id}
            bag={bag}
            entries={packing.entries.filter((e) => e.luggageId === bag.id)}
            weightOf={weightOf}
            travellerName={bag.travellerId ? travellerNames.get(bag.travellerId) : undefined}
            onOpen={() => openBag(bag.id)}
            onToggle={(entry) => toggle(entry.id)}
          />
        ))
      )}
      {packing.luggage.length > 0 && unassigned.length > 0 ? (
        <BagCard bag={null} entries={unassigned} weightOf={weightOf} onToggle={(entry) => toggle(entry.id)} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.md,
  },
  wrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
});
