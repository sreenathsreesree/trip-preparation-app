import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText, Button, Card, Icon, Notice } from '@/components/ui';
import { toErrorMessage } from '@/lib/errors';
import { colors, radii, spacing } from '@/theme';

import { useInventoryStore } from '../../inventory/inventoryStore';
import { CATEGORY_KEYS, type InventoryItemSummary } from '../../inventory/model';
import type { Traveller } from '../../trips/model';
import { planHasChanges, type Recommendation, type RegenerationPlan } from '../model';
import { usePackingStore, type TripPacking } from '../packingStore';
import { PackingProfileEditor, SuggestionCard } from './PackingParts';

function PlanSummary({ plan }: { plan: RegenerationPlan }) {
  const lines = [
    plan.added.length ? `${plan.added.length} new ${plan.added.length === 1 ? 'suggestion' : 'suggestions'}` : '',
    plan.updated.length ? `${plan.updated.length} updated (not yet reviewed)` : '',
    plan.quantityChanged.length
      ? `${plan.quantityChanged.length} with a new suggested quantity — your list keeps what you set`
      : '',
    plan.noLongerRelevant.length ? `${plan.noLongerRelevant.length} no longer suggested — nothing is removed` : '',
    plan.stillRejected.length ? `${plan.stillRejected.length} you skipped stay skipped` : '',
  ].filter(Boolean);
  return (
    <View style={styles.planLines}>
      {lines.map((line) => (
        <View key={line} style={styles.planLine}>
          <Icon name="circle-small" tone="textMuted" />
          <AppText variant="caption" tone="textSecondary" style={styles.flex}>
            {line}
          </AppText>
        </View>
      ))}
    </View>
  );
}

export function SuggestTab({
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
  const preferences = usePackingStore((state) => state.preferences);
  const [plan, setPlan] = useState<RegenerationPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [showSkipped, setShowSkipped] = useState(false);
  const store = usePackingStore.getState;

  const travellerNames = useMemo(() => new Map(travellers.map((t) => [t.id, t.name])), [travellers]);
  const entryQuantity = useMemo(() => new Map(packing.entries.map((e) => [e.id, e.quantity])), [packing.entries]);
  const state = packing.state;
  const recs = packing.recommendations;
  const pending = recs.filter((r) => r.status === 'pending');
  const accepted = recs.filter((r) => r.status === 'accepted');
  const stale = recs.filter((r) => r.status === 'stale' && r.packingEntryId);
  const skipped = recs.filter((r) => r.status === 'rejected');
  const essentials = pending.filter((r) => r.priority === 'essential');
  const categories = useInventoryStore((s) => s.categories);
  const categoryNames = new Map(categories.flatMap((c) => (c.systemKey ? [[c.systemKey, c.name] as const] : [])));
  const pendingGroups = CATEGORY_KEYS.map((key) => ({
    key,
    name: categoryNames.get(key) ?? key,
    recs: pending.filter((r) => r.categoryKey === key),
  })).filter((group) => group.recs.length > 0);

  const run = (fn: () => Promise<unknown>, fallback: string) => {
    setError(null);
    setInfo(null);
    fn().catch((err: unknown) => setError(toErrorMessage(err, fallback)));
  };

  async function generate() {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const preview = await store().previewSuggestions(tripId);
      if (preview.firstRun) {
        // Nothing to preserve yet: suggestions are only stored for review.
        await store().applySuggestions(tripId);
        setPlan(null);
      } else if (planHasChanges(preview.plan)) {
        setPlan(preview.plan);
      } else {
        setPlan(null);
        setInfo('Suggestions are up to date with this trip.');
      }
    } catch (err) {
      setError(toErrorMessage(err, 'Could not work out suggestions.'));
    } finally {
      setBusy(false);
    }
  }

  async function applyPlan() {
    setBusy(true);
    setError(null);
    try {
      await store().applySuggestions(tripId);
      setPlan(null);
      setInfo('Suggestions updated. Your packing list was not changed.');
    } catch (err) {
      setError(toErrorMessage(err, 'Could not update suggestions.'));
    } finally {
      setBusy(false);
    }
  }

  /** Unlinked list entry for the same inventory item and traveller (what accepting would link to). */
  const listedFor = (r: Recommendation) => {
    if (!r.inventoryItemId) return undefined;
    const linked = new Set(recs.map((x) => x.packingEntryId).filter(Boolean));
    return packing.entries.find(
      (e) => e.inventoryItemId === r.inventoryItemId && e.travellerId === r.travellerId && !linked.has(e.id),
    )?.quantity;
  };
  const owned = (r: Recommendation) => (r.inventoryItemId ? itemById.get(r.inventoryItemId) : undefined);
  const traveller = (r: Recommendation) => (r.travellerId ? travellerNames.get(r.travellerId) : undefined);

  if (!state) return null;

  return (
    <View style={styles.container} testID="suggest-tab">
      <Card>
        <AppText variant="title">About this trip</AppText>
        <AppText variant="caption" tone="textMuted">
          Suggestions use the trip length, destinations, dates, travellers, transport and what you set here. Nothing is
          added to your list until you approve it.
        </AppText>
        <View style={styles.profile}>
          <PackingProfileEditor
            state={state}
            style={preferences.packingStyle}
            onChange={(patch) => run(() => store().updateProfile(tripId, patch), 'Could not save.')}
            onStyle={(packingStyle) => run(() => store().setPreferences({ packingStyle }), 'Could not save.')}
          />
        </View>
        <Button
          label={state.suggestionsGeneratedAt ? 'Check for changes' : 'Suggest a packing list'}
          icon={state.suggestionsGeneratedAt ? 'refresh' : 'lightbulb-on-outline'}
          onPress={() => void generate()}
          loading={busy && !plan}
          testID="suggest-generate"
        />
      </Card>

      {plan ? (
        <Card variant="outline" testID="suggest-plan">
          <AppText variant="title">Review changes</AppText>
          <PlanSummary plan={plan} />
          <AppText variant="caption" tone="textMuted">
            Only the suggestions change. Items on your list, their quantities and anything you skipped stay as they are.
          </AppText>
          <View style={styles.row}>
            <Button label="Not now" variant="secondary" size="sm" onPress={() => setPlan(null)} disabled={busy} />
            <Button
              label="Update suggestions"
              icon="check"
              size="sm"
              onPress={() => void applyPlan()}
              loading={busy}
              testID="suggest-apply"
            />
          </View>
        </Card>
      ) : null}

      {info ? <Notice tone="success" title={info} /> : null}
      {error ? <Notice tone="danger" title="Not updated" message={error} /> : null}

      {pending.length > 0 ? (
        <View style={styles.group}>
          <View style={styles.groupHeader}>
            <AppText variant="label" tone="textMuted" style={styles.flex}>
              To review ({pending.length})
            </AppText>
            {essentials.length > 1 ? (
              <Button
                label={`Add ${essentials.length} essentials`}
                icon="check-all"
                size="sm"
                variant="ghost"
                onPress={() =>
                  run(
                    () =>
                      store().acceptSuggestions(
                        tripId,
                        essentials.map((r) => r.id),
                      ),
                    'Could not add the essentials.',
                  )
                }
                testID="suggest-accept-essentials"
              />
            ) : null}
          </View>
          {pendingGroups.map((group) => (
            <View key={group.key} style={styles.group}>
              <AppText variant="captionStrong" tone="textSecondary">
                {group.name} · {group.recs.length}
              </AppText>
              {group.recs.map((r) => {
                const item = owned(r);
                return (
                  <SuggestionCard
                    key={r.id}
                    recommendation={r}
                    owned={item}
                    travellerName={traveller(r)}
                    listedQuantity={listedFor(r)}
                    onAccept={() => run(() => store().acceptSuggestions(tripId, [r.id]), 'Could not add it.')}
                    onBuy={
                      !item || item.availability !== 'available'
                        ? () =>
                            run(async () => {
                              const { duplicate } = await store().suggestionToPurchase(tripId, r.id);
                              setInfo(
                                duplicate
                                  ? `${r.name} is already on the shopping list.`
                                  : `${r.name} added to the shopping list.`,
                              );
                            }, 'Could not add it to the shopping list.')
                        : undefined
                    }
                    onReject={() => run(() => store().rejectSuggestion(tripId, r.id), 'Could not skip it.')}
                  />
                );
              })}
            </View>
          ))}
        </View>
      ) : state.suggestionsGeneratedAt ? (
        <AppText variant="caption" tone="textMuted">
          Nothing left to review.
        </AppText>
      ) : null}

      {stale.length > 0 ? (
        <View style={styles.group}>
          <AppText variant="label" tone="warning">
            No longer suggested, still on your list ({stale.length})
          </AppText>
          {stale.map((r) => (
            <SuggestionCard
              key={r.id}
              recommendation={r}
              owned={owned(r)}
              travellerName={traveller(r)}
              onRemoveEntry={() =>
                run(() => store().removeEntry(tripId, r.packingEntryId as string), 'Could not remove it from the list.')
              }
            />
          ))}
        </View>
      ) : null}

      {accepted.length > 0 ? (
        <View style={styles.group}>
          <AppText variant="label" tone="textMuted">
            Added to your list ({accepted.length})
          </AppText>
          {accepted.map((r) => {
            const current = r.packingEntryId ? entryQuantity.get(r.packingEntryId) : undefined;
            return (
              <View key={r.id} style={styles.compact} testID={`accepted-${r.key}`}>
                <Icon name="check-circle" tone="accent" size={18} />
                <AppText variant="caption" style={styles.flex} numberOfLines={1}>
                  {r.name}
                  {traveller(r) ? ` · ${traveller(r)}` : ''}
                </AppText>
                {current !== undefined && current !== r.quantity ? (
                  <Button
                    label={`Use ×${r.quantity}`}
                    size="sm"
                    variant="ghost"
                    accessibilityHint={`Your list has ${current}. Change it to the suggested ${r.quantity}.`}
                    onPress={() =>
                      run(
                        () => store().updateEntry(tripId, r.packingEntryId as string, { quantity: r.quantity }),
                        'Could not change the quantity.',
                      )
                    }
                  />
                ) : (
                  <AppText variant="caption" tone="textMuted">
                    ×{current ?? r.quantity}
                  </AppText>
                )}
              </View>
            );
          })}
        </View>
      ) : null}

      {skipped.length > 0 ? (
        <View style={styles.group}>
          <Button
            label={`${showSkipped ? 'Hide' : 'Show'} skipped (${skipped.length})`}
            icon={showSkipped ? 'chevron-up' : 'chevron-down'}
            variant="ghost"
            size="sm"
            onPress={() => setShowSkipped((v) => !v)}
            style={styles.left}
            testID="suggest-show-skipped"
          />
          {showSkipped
            ? skipped.map((r) => (
                <SuggestionCard
                  key={r.id}
                  recommendation={r}
                  owned={owned(r)}
                  travellerName={traveller(r)}
                  onRestore={() => run(() => store().restoreSuggestion(tripId, r.id), 'Could not restore it.')}
                />
              ))
            : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.md,
  },
  profile: {
    marginVertical: spacing.md,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  group: {
    gap: spacing.sm,
  },
  groupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  flex: {
    flex: 1,
  },
  left: {
    alignSelf: 'flex-start',
  },
  planLines: {
    gap: spacing.xxs,
    marginVertical: spacing.sm,
  },
  planLine: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  compact: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 44,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
});
