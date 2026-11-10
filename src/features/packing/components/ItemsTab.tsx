import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText, Button, EmptyState, Notice, TextField } from '@/components/ui';
import { toErrorMessage } from '@/lib/errors';
import { spacing } from '@/theme';

import type { CategoryMaps } from '../../inventory/hooks';
import type { InventoryItemSummary } from '../../inventory/model';
import type { Traveller } from '../../trips/model';
import { PACKING_LIMITS, type PackingEntry } from '../model';
import { usePackingStore, type TripPacking } from '../packingStore';
import { EntryRow, openEntry, TravellerChips, type TravellerFilter } from './PackingParts';

interface Group {
  key: string;
  title: string;
  entries: PackingEntry[];
}

/** Groups entries by their top-level category, in the user's category order. */
function groupEntries(entries: readonly PackingEntry[], maps: CategoryMaps): Group[] {
  const topOf = (categoryId: string | null) => {
    if (!categoryId) return null;
    const category = maps.byId.get(categoryId);
    if (!category) return null;
    return category.parentId ?? category.id;
  };
  const buckets = new Map<string, PackingEntry[]>();
  for (const entry of entries) {
    const key = topOf(entry.categoryId) ?? 'other';
    buckets.set(key, [...(buckets.get(key) ?? []), entry]);
  }
  const groups: Group[] = [];
  for (const category of maps.topLevel) {
    const rows = buckets.get(category.id);
    if (rows) groups.push({ key: category.id, title: category.name, entries: rows });
  }
  const other = buckets.get('other');
  if (other) groups.push({ key: 'other', title: 'Other', entries: other });
  return groups;
}

export function ItemsTab({
  tripId,
  travellers,
  packing,
  maps,
  itemById,
}: {
  tripId: string;
  travellers: readonly Traveller[];
  packing: TripPacking;
  maps: CategoryMaps;
  itemById: Map<string, InventoryItemSummary>;
}) {
  const [filter, setFilter] = useState<TravellerFilter>('all');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const store = usePackingStore.getState;

  const travellerNames = useMemo(() => new Map(travellers.map((t) => [t.id, t.name])), [travellers]);
  const bagNames = useMemo(() => new Map(packing.luggage.map((b) => [b.id, b.name])), [packing.luggage]);
  const visible = packing.entries.filter((entry) =>
    filter === 'all' ? true : filter === 'shared' ? !entry.travellerId : entry.travellerId === filter,
  );
  const groups = groupEntries(visible, maps);

  const run = (fn: () => Promise<unknown>, fallback: string) => {
    setError(null);
    fn().catch((err: unknown) => setError(toErrorMessage(err, fallback)));
  };

  async function addOneTime() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setError(null);
    try {
      await store().addEntry(tripId, {
        name: trimmed,
        travellerId: filter !== 'all' && filter !== 'shared' ? filter : null,
        source: 'manual',
      });
      setName('');
    } catch (err) {
      setError(toErrorMessage(err, 'Could not add the item.'));
    }
  }

  return (
    <View style={styles.container} testID="items-tab">
      {travellers.length > 1 ? <TravellerChips travellers={travellers} value={filter} onChange={setFilter} /> : null}

      <Button
        label="Add from inventory"
        icon="archive-search-outline"
        onPress={() => router.push({ pathname: '/trips/[tripId]/packing/add', params: { tripId } })}
        testID="packing-add-inventory"
      />
      <View style={styles.addRow}>
        <View style={styles.flex}>
          <TextField
            label="One-time item"
            placeholder="e.g. Sandwiches"
            value={name}
            onChangeText={setName}
            maxLength={PACKING_LIMITS.nameMax}
            returnKeyType="done"
            onSubmitEditing={() => void addOneTime()}
            testID="one-time-input"
          />
        </View>
        <Button label="Add" icon="plus" variant="secondary" onPress={() => void addOneTime()} disabled={!name.trim()} testID="one-time-add" />
      </View>

      {error ? <Notice tone="danger" title="Not updated" message={error} /> : null}

      {packing.entries.length === 0 ? (
        <EmptyState
          icon="bag-personal-outline"
          title="Nothing packed yet"
          message="Add things you own from your inventory, a one-time item, or review suggestions in the Suggest tab."
        />
      ) : visible.length === 0 ? (
        <AppText variant="caption" tone="textMuted">
          Nothing assigned here yet. Open an item to assign it to a traveller.
        </AppText>
      ) : (
        groups.map((group) => (
          <View key={group.key} style={styles.group}>
            <AppText variant="label" tone="textMuted">
              {group.title} · {group.entries.filter((e) => e.isPacked).length}/{group.entries.length}
            </AppText>
            {group.entries.map((entry) => (
              <EntryRow
                key={entry.id}
                entry={entry}
                item={entry.inventoryItemId ? itemById.get(entry.inventoryItemId) : undefined}
                maps={maps}
                travellerName={entry.travellerId ? travellerNames.get(entry.travellerId) : undefined}
                bagName={entry.luggageId ? bagNames.get(entry.luggageId) : undefined}
                onToggle={(e) => run(() => store().togglePacked(tripId, e.id), 'Could not update the item.')}
                onQuantity={(e, quantity) =>
                  run(() => store().updateEntry(tripId, e.id, { quantity }), 'Could not change the quantity.')
                }
                onOpen={(e) => openEntry(tripId, e.id)}
              />
            ))}
          </View>
        ))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.md,
  },
  addRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
  },
  flex: {
    flex: 1,
    minWidth: 0,
  },
  group: {
    gap: spacing.sm,
  },
});
