import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import {
  AppText,
  Button,
  Card,
  Icon,
  MiniStepper,
  OptionTile,
  ProgressBar,
  Tag,
  ToggleRow,
} from '@/components/ui';
import { selectionFeedback } from '@/lib/haptics';
import { colors, radii, spacing } from '@/theme';

import { ItemImage } from '../../inventory/components/ItemImage';
import { placeholderFor, type CategoryMaps } from '../../inventory/hooks';
import { formatWeight, type InventoryItemSummary } from '../../inventory/model';
import { PriorityBadge } from '../../preparation/components/Priority';
import type { Traveller } from '../../trips/model';
import {
  ACCOMMODATIONS,
  ACCOMMODATION_META,
  ACTIVITIES,
  ACTIVITY_META,
  estimateWeight,
  LUGGAGE_META,
  PACKING_LIMITS,
  PACKING_STYLES,
  PACKING_STYLE_META,
  packingProgress,
  PURCHASE_STATUS_META,
  type Luggage,
  type PackingEntry,
  type PackingStyle,
  type PurchaseItem,
  type Recommendation,
  type TripPackingState,
} from '../model';

/* ------------------------------------------------------------------ */
/* Packing entry row                                                   */
/* ------------------------------------------------------------------ */

export function EntryRow({
  entry,
  item,
  maps,
  travellerName,
  bagName,
  onToggle,
  onQuantity,
  onOpen,
}: {
  entry: PackingEntry;
  item: InventoryItemSummary | undefined;
  maps: CategoryMaps;
  travellerName?: string;
  bagName?: string;
  onToggle: (entry: PackingEntry) => void;
  onQuantity: (entry: PackingEntry, quantity: number) => void;
  onOpen: (entry: PackingEntry) => void;
}) {
  const placeholder = placeholderFor({ categoryId: entry.categoryId ?? item?.categoryId ?? null }, maps);
  const unavailable = item && (item.availability !== 'available' || item.archivedAt);
  return (
    <View style={[styles.entry, entry.isPacked && styles.entryPacked]} testID={`entry-${entry.id}`}>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityLabel={`${entry.name} packed`}
        accessibilityState={{ checked: entry.isPacked }}
        hitSlop={6}
        onPress={() => {
          selectionFeedback();
          onToggle(entry);
        }}
        style={styles.check}
        testID={`entry-check-${entry.id}`}
      >
        <View style={[styles.checkbox, entry.isPacked && styles.checkboxOn]}>
          {entry.isPacked ? <Icon name="check-bold" size={14} tone="textOnAccent" /> : null}
        </View>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${entry.name}, edit packing entry`}
        onPress={() => onOpen(entry)}
        style={({ pressed }) => [styles.entryBody, pressed && styles.pressed]}
        testID={`entry-open-${entry.id}`}
      >
        <ItemImage image={item?.image} fallbackIcon={placeholder.icon} fallbackColor={placeholder.color} size={40} rounded={radii.sm} />
        <View style={styles.entryText}>
          <AppText
            variant="body"
            tone={entry.isPacked ? 'textMuted' : 'textPrimary'}
            style={entry.isPacked ? styles.strike : undefined}
            numberOfLines={2}
          >
            {entry.name}
          </AppText>
          <View style={styles.entryMeta}>
            {!entry.inventoryItemId ? (
              <AppText variant="caption" tone="textMuted">
                One-time
              </AppText>
            ) : null}
            {travellerName ? (
              <AppText variant="caption" tone="info" numberOfLines={1}>
                {travellerName}
              </AppText>
            ) : null}
            {bagName ? (
              <AppText variant="caption" tone="textMuted" numberOfLines={1}>
                · {bagName}
              </AppText>
            ) : null}
            {unavailable ? (
              <AppText variant="caption" tone="danger">
                {item?.archivedAt ? 'Archived' : item?.availability === 'damaged' ? 'Damaged' : 'Lent out'}
              </AppText>
            ) : null}
          </View>
        </View>
      </Pressable>
      <MiniStepper
        value={entry.quantity}
        min={1}
        max={PACKING_LIMITS.quantityMax}
        label={entry.name}
        onChange={(quantity) => onQuantity(entry, quantity)}
        testID={`entry-qty-${entry.id}`}
      />
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* Traveller filter                                                    */
/* ------------------------------------------------------------------ */

export type TravellerFilter = 'all' | 'shared' | string;

export function TravellerChips({
  travellers,
  value,
  onChange,
}: {
  travellers: readonly Traveller[];
  value: TravellerFilter;
  onChange: (value: TravellerFilter) => void;
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
      <OptionTile layout="chip" label="Everyone" icon="account-group-outline" selected={value === 'all'} onPress={() => onChange('all')} />
      <OptionTile layout="chip" label="Shared" icon="share-variant-outline" selected={value === 'shared'} onPress={() => onChange('shared')} />
      {travellers.map((t) => (
        <OptionTile
          key={t.id}
          layout="chip"
          label={t.name}
          icon={t.kind === 'child' ? 'human-child' : 'account'}
          selected={value === t.id}
          onPress={() => onChange(t.id)}
          testID={`traveller-filter-${t.name}`}
        />
      ))}
    </ScrollView>
  );
}

/* ------------------------------------------------------------------ */
/* Luggage                                                             */
/* ------------------------------------------------------------------ */

export function BagCard({
  bag,
  entries,
  weightOf,
  travellerName,
  onOpen,
  onToggle,
}: {
  bag: Luggage | null;
  entries: PackingEntry[];
  weightOf: (inventoryItemId: string) => number | null;
  travellerName?: string;
  onOpen?: () => void;
  onToggle: (entry: PackingEntry) => void;
}) {
  const progress = packingProgress(entries);
  const weight = estimateWeight(entries, weightOf);
  const meta = bag ? LUGGAGE_META[bag.kind] : { label: 'Not in a bag', icon: 'help-circle-outline' as const };
  const weightText =
    progress.units === 0
      ? 'Empty'
      : weight.knownGrams === 0
        ? 'Weight unknown — no weights recorded for these items'
        : weight.unknownUnits > 0
          ? `At least ${formatWeight(weight.knownGrams)} (${weight.unknownUnits} ${weight.unknownUnits === 1 ? 'item' : 'items'} without a weight)`
          : `About ${formatWeight(weight.knownGrams)}`;
  return (
    <Card padding="none" testID={bag ? `bag-${bag.name}` : 'bag-unassigned'}>
      <Pressable
        accessibilityRole={onOpen ? 'button' : undefined}
        accessibilityLabel={bag ? `${bag.name}, edit bag` : 'Items not in a bag'}
        disabled={!onOpen}
        onPress={onOpen}
        style={({ pressed }) => [styles.bagHeader, pressed && styles.pressed]}
      >
        <View style={styles.bagIcon}>
          <Icon name={meta.icon} tone="accent" />
        </View>
        <View style={styles.flex}>
          <AppText variant="title" numberOfLines={1}>
            {bag?.name ?? meta.label}
          </AppText>
          <AppText variant="caption" tone="textMuted">
            {progress.entries} {progress.entries === 1 ? 'item' : 'items'} · {progress.packedEntries} packed
            {travellerName ? ` · ${travellerName}` : ''}
          </AppText>
          <AppText variant="caption" tone={weight.unknownUnits > 0 ? 'warning' : 'textSecondary'} testID={bag ? `bag-weight-${bag.name}` : undefined}>
            {weightText}
          </AppText>
        </View>
        {onOpen ? <Icon name="pencil-outline" size={18} tone="textMuted" /> : null}
      </Pressable>
      <View style={styles.bagProgress}>
        <ProgressBar value={progress.entries === 0 ? 0 : progress.packedEntries / progress.entries} height={4} />
      </View>
      {entries.map((entry) => (
        <Pressable
          key={entry.id}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: entry.isPacked }}
          accessibilityLabel={`${entry.name}, ${entry.quantity}`}
          onPress={() => onToggle(entry)}
          style={({ pressed }) => [styles.bagItem, pressed && styles.pressed]}
        >
          <Icon name={entry.isPacked ? 'checkbox-marked' : 'checkbox-blank-outline'} size={18} tone={entry.isPacked ? 'accent' : 'textMuted'} />
          <AppText variant="caption" tone={entry.isPacked ? 'textMuted' : 'textPrimary'} style={styles.flex} numberOfLines={1}>
            {entry.name}
          </AppText>
          <AppText variant="caption" tone="textMuted">
            ×{entry.quantity}
          </AppText>
        </Pressable>
      ))}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Recommendations                                                     */
/* ------------------------------------------------------------------ */

export function SuggestionCard({
  recommendation,
  owned,
  travellerName,
  entryQuantity,
  listedQuantity,
  onAccept,
  onBuy,
  onReject,
  onRestore,
  onRemoveEntry,
}: {
  recommendation: Recommendation;
  owned: InventoryItemSummary | undefined;
  travellerName?: string;
  entryQuantity?: number;
  /** Set when the matched inventory item is already on the list for this traveller. */
  listedQuantity?: number;
  onAccept?: () => void;
  onBuy?: () => void;
  onReject?: () => void;
  onRestore?: () => void;
  onRemoveEntry?: () => void;
}) {
  const r = recommendation;
  const ownedText = owned
    ? owned.availability !== 'available'
      ? `You own “${owned.name}” but it is marked ${owned.availability === 'damaged' ? 'damaged' : 'lent out'}`
      : `From your inventory: ${owned.name}`
    : 'Not in your inventory';
  return (
    <View style={styles.suggestion} testID={`suggestion-${r.key}`}>
      <View style={styles.suggestionTop}>
        <View style={styles.flex}>
          <AppText variant="bodyStrong">
            {r.name} <AppText variant="caption" tone="textMuted">×{r.quantity}</AppText>
          </AppText>
          {travellerName ? (
            <AppText variant="caption" tone="info">
              For {travellerName}
            </AppText>
          ) : null}
        </View>
        <PriorityBadge priority={r.priority} always />
      </View>
      <AppText variant="caption" tone="textSecondary">
        Why: {r.reason}
      </AppText>
      <AppText variant="caption" tone={owned && owned.availability === 'available' ? 'accent' : 'textMuted'}>
        {ownedText}
      </AppText>
      {listedQuantity !== undefined ? (
        <AppText variant="caption" tone="info">
          Already on your list (×{listedQuantity}) — “Link” marks it covered without adding a duplicate.
        </AppText>
      ) : null}
      {entryQuantity !== undefined && entryQuantity !== r.quantity && r.status !== 'stale' ? (
        <AppText variant="caption" tone="warning">
          Now suggested ×{r.quantity} — your list has ×{entryQuantity} (kept as you set it)
        </AppText>
      ) : null}
      <View style={styles.suggestionActions}>
        {onAccept ? (
          <Button
            label={listedQuantity !== undefined ? 'Link' : owned?.availability === 'available' && !owned.archivedAt ? 'Add' : 'Add one-time'}
            icon={listedQuantity !== undefined ? 'link-variant' : 'plus'}
            size="sm"
            onPress={onAccept}
            testID={`suggestion-accept-${r.key}`}
          />
        ) : null}
        {onBuy ? <Button label="Buy" icon="cart-plus" size="sm" variant="secondary" onPress={onBuy} testID={`suggestion-buy-${r.key}`} /> : null}
        {onReject ? <Button label="Skip" size="sm" variant="ghost" onPress={onReject} testID={`suggestion-reject-${r.key}`} /> : null}
        {onRestore ? <Button label="Restore" icon="restore" size="sm" variant="ghost" onPress={onRestore} testID={`suggestion-restore-${r.key}`} /> : null}
        {onRemoveEntry ? (
          <Button label="Remove from list" icon="minus-circle-outline" size="sm" variant="ghost" onPress={onRemoveEntry} />
        ) : null}
      </View>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* Packing profile (inputs to the rules)                               */
/* ------------------------------------------------------------------ */

export function PackingProfileEditor({
  state,
  style,
  onChange,
  onStyle,
}: {
  state: TripPackingState;
  style: PackingStyle;
  onChange: (patch: Partial<Pick<TripPackingState, 'activities' | 'accommodation' | 'laundry'>>) => void;
  onStyle: (style: PackingStyle) => void;
}) {
  return (
    <View style={styles.profile}>
      <AppText variant="label" tone="textSecondary">
        Activities
      </AppText>
      <View style={styles.wrap}>
        {ACTIVITIES.map((activity) => {
          const selected = state.activities.includes(activity);
          return (
            <OptionTile
              key={activity}
              layout="chip"
              role="button"
              label={ACTIVITY_META[activity].label}
              icon={ACTIVITY_META[activity].icon}
              selected={selected}
              onPress={() =>
                onChange({
                  activities: selected ? state.activities.filter((a) => a !== activity) : [...state.activities, activity],
                })
              }
              testID={`activity-${activity}`}
            />
          );
        })}
      </View>
      <AppText variant="label" tone="textSecondary">
        Staying at
      </AppText>
      <View style={styles.wrap}>
        {ACCOMMODATIONS.map((option) => (
          <OptionTile
            key={option}
            layout="chip"
            label={ACCOMMODATION_META[option].label}
            icon={ACCOMMODATION_META[option].icon}
            selected={state.accommodation === option}
            onPress={() => onChange({ accommodation: option })}
            testID={`accommodation-${option}`}
          />
        ))}
      </View>
      <ToggleRow
        icon="washing-machine"
        label="Laundry available"
        description="Clothing suggestions are capped at 4 days."
        value={state.laundry}
        onChange={(laundry) => onChange({ laundry })}
        testID="laundry-toggle"
      />
      <AppText variant="label" tone="textSecondary">
        Your packing style (all trips)
      </AppText>
      <View style={styles.wrap}>
        {PACKING_STYLES.map((option) => (
          <OptionTile
            key={option}
            layout="chip"
            label={PACKING_STYLE_META[option].label}
            icon={option === 'light' ? 'feather' : option === 'thorough' ? 'shield-check-outline' : 'scale-balance'}
            selected={style === option}
            onPress={() => onStyle(option)}
            testID={`style-${option}`}
          />
        ))}
      </View>
      <AppText variant="caption" tone="textMuted">
        {PACKING_STYLE_META[style].description}
      </AppText>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* Purchase row                                                        */
/* ------------------------------------------------------------------ */

export function PurchaseRow({
  purchase,
  showTrip,
  onOpen,
}: {
  purchase: PurchaseItem;
  showTrip?: boolean;
  onOpen: (purchase: PurchaseItem) => void;
}) {
  const meta = PURCHASE_STATUS_META[purchase.status];
  const links = [
    purchase.inventoryItemId ? 'In inventory' : '',
    purchase.packingEntryId ? 'On packing list' : '',
  ].filter(Boolean);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${purchase.name}, ${meta.label}. Actions`}
      onPress={() => onOpen(purchase)}
      style={({ pressed }) => [styles.purchase, pressed && styles.pressed]}
      testID={`purchase-${purchase.name}`}
    >
      <Icon name={meta.icon} color={meta.color} />
      <View style={styles.flex}>
        <AppText
          variant="bodyStrong"
          tone={purchase.status === 'skipped' ? 'textMuted' : 'textPrimary'}
          style={purchase.status === 'skipped' ? styles.strike : undefined}
        >
          {purchase.name} <AppText variant="caption" tone="textMuted">×{purchase.quantity}</AppText>
        </AppText>
        <AppText variant="caption" tone="textMuted" numberOfLines={1}>
          {[showTrip ? (purchase.tripId ? purchase.tripName : `${purchase.tripName} (trip deleted)`) : '', ...links]
            .filter(Boolean)
            .join(' · ') || meta.label}
        </AppText>
      </View>
      <Tag label={meta.label} color={meta.color} />
    </Pressable>
  );
}

export function PackingStatusLine({ confirmed }: { confirmed: boolean }) {
  return (
    <View style={styles.statusLine}>
      <Icon name={confirmed ? 'calendar-lock' : 'pencil-outline'} tone={confirmed ? 'accent' : 'warning'} size={18} />
      <AppText variant="captionStrong" tone={confirmed ? 'accent' : 'warning'}>
        {confirmed ? 'Confirmed · inventory reserved for these dates' : 'Draft · nothing reserved yet'}
      </AppText>
    </View>
  );
}

export const openEntry = (tripId: string, entryId: string) =>
  router.push({ pathname: '/trips/[tripId]/packing/entry/[entryId]', params: { tripId, entryId } });

const styles = StyleSheet.create({
  flex: {
    flex: 1,
    minWidth: 0,
  },
  pressed: {
    opacity: 0.75,
  },
  strike: {
    textDecorationLine: 'line-through',
  },
  chips: {
    gap: spacing.sm,
    paddingRight: spacing.lg,
  },
  wrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  entry: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: spacing.xs,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  entryPacked: {
    borderColor: colors.accentBorder,
  },
  check: {
    width: 44,
    minHeight: 56,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: radii.xs,
    borderWidth: 2,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOn: {
    borderColor: colors.accent,
    backgroundColor: colors.accent,
  },
  entryBody: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingRight: spacing.xs,
  },
  entryText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  entryMeta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  bagHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
  },
  bagIcon: {
    width: 40,
    height: 40,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentSoft,
  },
  bagProgress: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  bagItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    minHeight: 44,
  },
  suggestion: {
    gap: spacing.xs,
    padding: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  suggestionTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  suggestionActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  profile: {
    gap: spacing.sm,
  },
  purchase: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  statusLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
});
