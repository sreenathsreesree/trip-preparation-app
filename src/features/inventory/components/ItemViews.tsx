import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText, Card, Icon, IconButton, MiniStepper, Tag } from '@/components/ui';
import { colors, radii, spacing, withAlpha } from '@/theme';

import { placeholderFor, type CategoryMaps } from '../hooks';
import {
  effectiveStatus,
  INVENTORY_LIMITS,
  STATUS_META,
  type InventoryCategory,
  type InventoryItemSummary,
  type InventoryStatus,
} from '../model';
import { ItemImage } from './ItemImage';

export function StatusBadge({ status }: { status: InventoryStatus }) {
  const meta = STATUS_META[status];
  return <Tag label={meta.label} icon={meta.icon} color={meta.color} />;
}

const openItem = (id: string) => router.push({ pathname: '/inventory/item/[itemId]', params: { itemId: id } });

/* ------------------------------------------------------------------ */
/* A. Category folder                                                  */
/* ------------------------------------------------------------------ */

export function CategoryFolderCard({
  category,
  items,
  onPress,
  testID,
}: {
  category: Pick<InventoryCategory, 'name' | 'icon' | 'color' | 'coverImageUri'>;
  items: InventoryItemSummary[];
  onPress: () => void;
  testID?: string;
}) {
  const active = items.filter((i) => !i.archivedAt);
  const packed = active.filter((i) => i.usage.packedQuantity > 0).length;
  const reserved = active.filter((i) => i.usage.reservedQuantity > 0).length;
  // Cover priority: explicit cover image, then up to four item pictures, then the icon.
  const cover = category.coverImageUri;
  const pictures = active.filter((i) => i.image).slice(0, 4);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${category.name}, ${active.length} items${packed ? `, ${packed} packed` : ''}`}
      onPress={onPress}
      style={({ pressed }) => [styles.folder, pressed && styles.pressed]}
      testID={testID}
    >
      <View style={[styles.cover, { backgroundColor: withAlpha(category.color.slice(0, 7), 0.12) }]}>
        {cover ? (
          <ItemImage
            image={{ uri: cover, source: cover.startsWith('library:') ? 'library' : 'photo' }}
            fallbackIcon={category.icon}
            fallbackColor={category.color}
            size="100%"
            rounded={0}
          />
        ) : pictures.length > 0 ? (
          <View style={styles.mosaic}>
            {pictures.map((item) => (
              <View key={item.id} style={pictures.length === 1 ? styles.mosaicFull : styles.mosaicCell}>
                <ItemImage image={item.image} fallbackIcon={category.icon} fallbackColor={category.color} size="100%" rounded={0} />
              </View>
            ))}
          </View>
        ) : (
          <Icon name={category.icon} size={40} color={category.color} />
        )}
      </View>
      <View style={styles.folderText}>
        <AppText variant="captionStrong" numberOfLines={1}>
          {category.name}
        </AppText>
        <AppText variant="caption" tone="textMuted" numberOfLines={1}>
          {active.length} {active.length === 1 ? 'item' : 'items'}
          {packed > 0 ? ` · ${packed} packed` : reserved > 0 ? ` · ${reserved} reserved` : ''}
        </AppText>
      </View>
    </Pressable>
  );
}

/* ------------------------------------------------------------------ */
/* B. Gallery card                                                     */
/* ------------------------------------------------------------------ */

export function ItemCard({ item, maps }: { item: InventoryItemSummary; maps: CategoryMaps }) {
  const status = effectiveStatus(item, item.usage);
  const placeholder = placeholderFor(item, maps);
  const isPacked = status === 'packed';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${item.name}, quantity ${item.quantity}, ${STATUS_META[status].label}`}
      onPress={() => openItem(item.id)}
      style={({ pressed }) => [styles.card, isPacked && styles.cardPacked, pressed && styles.pressed]}
      testID={`item-card-${item.id}`}
    >
      <View>
        <ItemImage image={item.image} fallbackIcon={placeholder.icon} fallbackColor={placeholder.color} size="100%" rounded={radii.md} />
        <View style={[styles.packedBadge, isPacked ? styles.packedOn : styles.packedOff]}>
          <Icon name={isPacked ? 'bag-checked' : 'bag-personal-outline'} size={14} tone={isPacked ? 'textOnAccent' : 'textSecondary'} />
        </View>
      </View>
      <AppText variant="captionStrong" numberOfLines={2} style={styles.cardTitle}>
        {item.name}
      </AppText>
      <View style={styles.cardMeta}>
        <AppText variant="caption" tone="textMuted">
          ×{item.quantity}
        </AppText>
        {status !== 'available' ? (
          <AppText variant="caption" style={{ color: STATUS_META[status].color }} numberOfLines={1}>
            {STATUS_META[status].label}
          </AppText>
        ) : null}
      </View>
    </Pressable>
  );
}

/* ------------------------------------------------------------------ */
/* C. Detailed list row                                                */
/* ------------------------------------------------------------------ */

export function ItemRow({
  item,
  maps,
  onAdjust,
  onMore,
}: {
  item: InventoryItemSummary;
  maps: CategoryMaps;
  onAdjust: (item: InventoryItemSummary, delta: number) => void;
  onMore: (item: InventoryItemSummary) => void;
}) {
  const status = effectiveStatus(item, item.usage);
  const placeholder = placeholderFor(item, maps);
  const category = item.categoryId ? maps.names.get(item.categoryId) : 'Uncategorised';
  const meta = [category, item.storageLocation].filter(Boolean).join(' · ');
  return (
    <Card padding="sm" testID={`item-row-${item.id}`}>
      <View style={styles.row}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${item.name} details`}
          onPress={() => openItem(item.id)}
          style={({ pressed }) => [styles.rowMain, pressed && styles.pressed]}
        >
          <ItemImage image={item.image} fallbackIcon={placeholder.icon} fallbackColor={placeholder.color} size={48} />
          <View style={styles.rowText}>
            <AppText variant="bodyStrong" numberOfLines={1}>
              {item.name}
            </AppText>
            <AppText variant="caption" tone="textMuted" numberOfLines={1}>
              {meta}
            </AppText>
            <StatusBadge status={status} />
          </View>
        </Pressable>
        <View style={styles.rowActions}>
          <MiniStepper
            value={item.quantity}
            min={0}
            max={INVENTORY_LIMITS.quantityMax}
            label={item.name}
            disabled={Boolean(item.archivedAt)}
            onChange={(next) => onAdjust(item, next - item.quantity)}
            testID={`item-qty-${item.id}`}
          />
          <IconButton
            icon="dots-vertical"
            variant="plain"
            size="sm"
            tone="textSecondary"
            accessibilityLabel={`Actions for ${item.name}`}
            onPress={() => onMore(item)}
            testID={`item-more-${item.id}`}
          />
        </View>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  pressed: {
    opacity: 0.8,
  },
  folder: {
    width: '48%',
    flexGrow: 1,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  cover: {
    width: '100%',
    aspectRatio: 1.35,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  mosaic: {
    width: '100%',
    height: '100%',
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  mosaicCell: {
    width: '50%',
    height: '50%',
    overflow: 'hidden',
  },
  mosaicFull: {
    width: '100%',
    height: '100%',
  },
  folderText: {
    padding: spacing.md,
    gap: spacing.xxs,
  },
  card: {
    width: '48%',
    flexGrow: 1,
    maxWidth: '50%',
    gap: spacing.xs,
    padding: spacing.sm,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  cardPacked: {
    borderColor: colors.accentBorder,
  },
  packedBadge: {
    position: 'absolute',
    top: spacing.xs,
    right: spacing.xs,
    width: 26,
    height: 26,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  packedOn: {
    backgroundColor: colors.accent,
  },
  packedOff: {
    backgroundColor: colors.overlay,
  },
  cardTitle: {
    minHeight: 36,
  },
  cardMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  rowMain: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  rowText: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xxs,
  },
  rowActions: {
    alignItems: 'flex-end',
    gap: spacing.xs,
  },
});
