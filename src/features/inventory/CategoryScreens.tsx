import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Screen } from '@/components/layout/Screen';
import { goBackOrHome, ScreenHeader } from '@/components/layout/ScreenHeader';
import {
  AppText,
  Button,
  Card,
  EmptyState,
  Icon,
  IconButton,
  LoadingState,
  Notice,
  OptionTile,
  ReorderControls,
  SegmentedControl,
  TextField,
} from '@/components/ui';
import { confirmAction } from '@/lib/confirm';
import { toErrorMessage } from '@/lib/errors';
import { successFeedback } from '@/lib/haptics';
import { colors, radii, spacing } from '@/theme';

import { ImagePickerField } from './components/ImagePickerField';
import { useCategoryMaps, useEnsureInventoryLoaded } from './hooks';
import { useInventoryStore } from './inventoryStore';
import { ItemCollection } from './InventoryScreen';
import {
  CATEGORY_COLORS,
  CATEGORY_ICONS,
  INVENTORY_LIMITS,
  matchesFilters,
  sortItems,
  validateCategoryInput,
  type CategoryInput,
  type InventoryCategory,
} from './model';

/* ------------------------------------------------------------------ */
/* One category: gallery or list of its items                          */
/* ------------------------------------------------------------------ */

export function CategoryScreen({ categoryId }: { categoryId: string | undefined }) {
  useEnsureInventoryLoaded();
  const status = useInventoryStore((state) => state.status);
  const items = useInventoryStore((state) => state.items);
  const sort = useInventoryStore((state) => state.sort);
  const maps = useCategoryMaps();
  const [mode, setMode] = useState<'gallery' | 'list'>('gallery');
  const [subId, setSubId] = useState<string | null>(null);
  const uncategorised = categoryId === 'uncategorised';
  const category = categoryId && !uncategorised ? maps.byId.get(categoryId) : undefined;
  const subs = category ? maps.childrenOf(category.id) : [];

  const visible = useMemo(() => {
    const filtered = items.filter(
      (item) =>
        matchesFilters(item, { query: '', status: 'active', categoryId: uncategorised ? 'uncategorised' : (categoryId ?? null) }, maps.names) &&
        (!subId || item.subcategoryId === subId),
    );
    return sortItems(filtered, sort, maps.names);
  }, [items, categoryId, uncategorised, subId, sort, maps.names]);

  if (status !== 'ready') {
    return (
      <Screen bottomInset>
        <LoadingState label="Loading…" />
      </Screen>
    );
  }
  if (!category && !uncategorised) {
    return (
      <Screen bottomInset>
        <ScreenHeader showBack title="Category" />
        <EmptyState icon="shape-outline" title="Category not found" message="It may have been deleted." />
      </Screen>
    );
  }

  const packed = visible.filter((i) => i.usage.packedQuantity > 0).length;
  return (
    <Screen testID="category-screen" bottomInset>
      <ScreenHeader
        showBack
        eyebrow="Category"
        title={category?.name ?? 'Uncategorised'}
        subtitle={`${visible.length} ${visible.length === 1 ? 'item' : 'items'}${packed ? ` · ${packed} packed` : ''}`}
        trailing={
          category ? (
            <IconButton
              icon="pencil-outline"
              accessibilityLabel="Edit category"
              onPress={() => router.push({ pathname: '/inventory/categories/[categoryId]', params: { categoryId: category.id } })}
              testID="category-edit"
            />
          ) : undefined
        }
      />
      {subs.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          <OptionTile layout="chip" label="All" icon="shape-outline" selected={!subId} onPress={() => setSubId(null)} />
          {subs.map((sub) => (
            <OptionTile
              key={sub.id}
              layout="chip"
              label={sub.name}
              icon={sub.icon}
              selected={subId === sub.id}
              onPress={() => setSubId(sub.id)}
              testID={`subcategory-${sub.name}`}
            />
          ))}
        </ScrollView>
      ) : null}
      <View style={styles.toolbar}>
        <SegmentedControl<'gallery' | 'list'>
          accessibilityLabel="Category view"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'gallery', label: 'Gallery' },
            { value: 'list', label: 'List' },
          ]}
        />
        <Button
          label="Add item here"
          icon="plus"
          size="sm"
          onPress={() => router.push({ pathname: '/inventory/item/new', params: { categoryId: categoryId ?? '' } })}
          style={styles.left}
          testID="category-add-item"
        />
      </View>
      <ItemCollection items={visible} mode={mode} emptyMessage="Nothing in this category yet." />
    </Screen>
  );
}

/* ------------------------------------------------------------------ */
/* Category manager                                                    */
/* ------------------------------------------------------------------ */

function CategoryRow({
  category,
  index,
  total,
  itemCount,
  onMove,
  sub = false,
}: {
  category: InventoryCategory;
  index: number;
  total: number;
  itemCount: number;
  onMove: (direction: -1 | 1) => void;
  sub?: boolean;
}) {
  return (
    <View style={[styles.row, sub && styles.subRow]}>
      <View style={[styles.swatch, { backgroundColor: category.color }]}>
        <Icon name={category.icon} size={16} tone="textOnAccent" />
      </View>
      <View style={styles.flex}>
        <AppText variant={sub ? 'body' : 'bodyStrong'} numberOfLines={1}>
          {category.name}
        </AppText>
        <AppText variant="caption" tone="textMuted">
          {itemCount} {itemCount === 1 ? 'item' : 'items'}
        </AppText>
      </View>
      <ReorderControls label={category.name} canMoveUp={index > 0} canMoveDown={index < total - 1} onMove={onMove} />
      <IconButton
        icon="pencil-outline"
        variant="plain"
        size="sm"
        accessibilityLabel={`Edit ${category.name}`}
        onPress={() => router.push({ pathname: '/inventory/categories/[categoryId]', params: { categoryId: category.id } })}
        testID={`category-row-edit-${category.name}`}
      />
    </View>
  );
}

export function CategoriesScreen() {
  useEnsureInventoryLoaded();
  const status = useInventoryStore((state) => state.status);
  const items = useInventoryStore((state) => state.items);
  const maps = useCategoryMaps();
  const [error, setError] = useState<string | null>(null);
  const count = (id: string) => items.filter((i) => (i.categoryId === id || i.subcategoryId === id) && !i.archivedAt).length;
  const move = (id: string, direction: -1 | 1) => {
    setError(null);
    useInventoryStore
      .getState()
      .moveCategory(id, direction)
      .catch((err: unknown) => setError(toErrorMessage(err, 'Could not reorder.')));
  };

  return (
    <Screen testID="categories-screen" bottomInset>
      <ScreenHeader
        showBack
        eyebrow="Inventory"
        title="Categories"
        subtitle="Reorder, edit or add categories and subcategories. Changes never alter your items."
        trailing={
          <Button
            label="New"
            icon="plus"
            size="sm"
            onPress={() => router.push('/inventory/categories/new')}
            testID="category-new"
          />
        }
      />
      {error ? <Notice tone="danger" title="Not updated" message={error} /> : null}
      {status !== 'ready' ? (
        <LoadingState label="Loading…" />
      ) : (
        <View style={styles.list}>
          {maps.topLevel.map((category, index) => {
            const subs = maps.childrenOf(category.id);
            return (
              <Card key={category.id} padding="sm">
                <CategoryRow
                  category={category}
                  index={index}
                  total={maps.topLevel.length}
                  itemCount={count(category.id)}
                  onMove={(d) => move(category.id, d)}
                />
                {subs.map((sub, subIndex) => (
                  <CategoryRow
                    key={sub.id}
                    category={sub}
                    index={subIndex}
                    total={subs.length}
                    itemCount={count(sub.id)}
                    onMove={(d) => move(sub.id, d)}
                    sub
                  />
                ))}
                <Button
                  label="Add subcategory"
                  icon="plus"
                  variant="ghost"
                  size="sm"
                  onPress={() =>
                    router.push({ pathname: '/inventory/categories/new', params: { parentId: category.id } })
                  }
                  style={styles.left}
                  testID={`add-subcategory-${category.name}`}
                />
              </Card>
            );
          })}
        </View>
      )}
    </Screen>
  );
}

/* ------------------------------------------------------------------ */
/* Category form                                                       */
/* ------------------------------------------------------------------ */

function CategoryForm({ category, parent }: { category?: InventoryCategory; parent?: InventoryCategory }) {
  const items = useInventoryStore((state) => state.items);
  const [input, setInput] = useState<CategoryInput>({
    name: category?.name ?? '',
    icon: category?.icon ?? parent?.icon ?? 'shape-outline',
    color: category?.color ?? parent?.color ?? CATEGORY_COLORS[1],
    parentId: category?.parentId ?? parent?.id ?? null,
    coverImageUri: category?.coverImageUri ?? null,
  });
  const [revealed, setRevealed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errors = validateCategoryInput(input);
  const patch = (value: Partial<CategoryInput>) => setInput((current) => ({ ...current, ...value }));
  const isSub = Boolean(input.parentId);
  const itemCount = category ? items.filter((i) => i.categoryId === category.id || i.subcategoryId === category.id).length : 0;

  async function save() {
    setRevealed(true);
    if (Object.keys(errors).length > 0) return;
    setSaving(true);
    setError(null);
    try {
      const store = useInventoryStore.getState();
      if (category) await store.updateCategory(category.id, input);
      else await store.createCategory(input);
      successFeedback();
      goBackOrHome();
    } catch (err) {
      setError(toErrorMessage(err, 'Could not save the category.'));
      setSaving(false);
    }
  }

  async function remove() {
    if (!category) return;
    const confirmed = await confirmAction({
      title: `Delete “${category.name}”?`,
      message: `${isSub ? 'The subcategory' : 'The category and its subcategories'} will be removed. Its ${itemCount} ${
        itemCount === 1 ? 'item stays' : 'items stay'
      } in your inventory${isSub ? ' under the parent category' : ' as uncategorised'}; trip packing lists are unchanged.`,
      confirmLabel: 'Delete category',
      destructive: true,
    });
    if (!confirmed) return;
    try {
      await useInventoryStore.getState().deleteCategory(category.id);
      router.back();
    } catch (err) {
      setError(toErrorMessage(err, 'Could not delete the category.'));
    }
  }

  return (
    <Screen
      testID="category-form"
      footer={
        <View style={styles.footer}>
          <Button label="Cancel" variant="secondary" onPress={goBackOrHome} disabled={saving} />
          <Button
            label={category ? 'Save changes' : isSub ? 'Add subcategory' : 'Add category'}
            icon="content-save-outline"
            onPress={() => void save()}
            loading={saving}
            style={styles.primary}
            testID="category-save"
          />
        </View>
      }
    >
      <ScreenHeader
        showBack
        backIcon="close"
        eyebrow={parent ? `Subcategory of ${parent.name}` : 'Inventory'}
        title={category ? 'Edit category' : isSub ? 'New subcategory' : 'New category'}
      />
      <TextField
        label="Name"
        value={input.name}
        onChangeText={(name) => patch({ name })}
        error={revealed ? errors.name : undefined}
        maxLength={INVENTORY_LIMITS.categoryNameMax}
        testID="category-name-input"
      />
      <View style={styles.group}>
        <AppText variant="label" tone="textSecondary">
          Colour
        </AppText>
        <View style={styles.swatchRow} accessibilityRole="radiogroup" accessibilityLabel="Colour">
          {CATEGORY_COLORS.map((color, index) => (
            <Pressable
              key={color}
              accessibilityRole="radio"
              accessibilityLabel={`Colour ${index + 1}`}
              accessibilityState={{ checked: input.color === color }}
              hitSlop={6}
              onPress={() => patch({ color })}
              style={[styles.colorDot, { backgroundColor: color }, input.color === color && styles.colorDotSelected]}
              testID={`category-color-${index}`}
            >
              {input.color === color ? <Icon name="check" size={16} tone="textOnAccent" /> : null}
            </Pressable>
          ))}
        </View>
      </View>
      <View style={styles.group}>
        <AppText variant="label" tone="textSecondary">
          Icon
        </AppText>
        <View style={styles.icons} accessibilityRole="radiogroup" accessibilityLabel="Icon">
          {CATEGORY_ICONS.map((icon) => (
            <IconButton
              key={icon}
              icon={icon}
              variant={input.icon === icon ? 'accent' : 'filled'}
              tone={input.icon === icon ? 'textOnAccent' : 'textSecondary'}
              accessibilityLabel={`Icon ${icon.replace(/-/g, ' ')}`}
              onPress={() => patch({ icon })}
            />
          ))}
        </View>
      </View>
      {!isSub ? (
        <ImagePickerField
          label="Cover image (optional)"
          image={
            input.coverImageUri
              ? { uri: input.coverImageUri, source: input.coverImageUri.startsWith('library:') ? 'library' : 'photo' }
              : null
          }
          onChange={(image) => patch({ coverImageUri: image?.uri ?? null })}
          fallbackIcon={input.icon}
          fallbackColor={input.color}
        />
      ) : null}
      {error ? <Notice tone="danger" title="Not saved" message={error} /> : null}
      {category ? (
        <Button
          label={isSub ? 'Delete subcategory' : 'Delete category'}
          icon="trash-can-outline"
          variant="danger"
          size="sm"
          onPress={() => void remove()}
          style={styles.left}
          testID="category-delete"
        />
      ) : null}
    </Screen>
  );
}

export function CategoryFormScreen({ categoryId, parentId }: { categoryId?: string; parentId?: string }) {
  useEnsureInventoryLoaded();
  const status = useInventoryStore((state) => state.status);
  const maps = useCategoryMaps();
  if (status !== 'ready') {
    return (
      <Screen bottomInset>
        <LoadingState label="Loading…" />
      </Screen>
    );
  }
  const category = categoryId ? maps.byId.get(categoryId) : undefined;
  if (categoryId && !category) {
    return (
      <Screen bottomInset>
        <ScreenHeader showBack backIcon="close" title="Category" />
        <EmptyState icon="shape-outline" title="Category not found" message="It may have been deleted." />
      </Screen>
    );
  }
  const parent = parentId ? maps.byId.get(parentId) : category?.parentId ? maps.byId.get(category.parentId) : undefined;
  return <CategoryForm key={categoryId ?? `new-${parentId ?? ''}`} category={category} parent={parent} />;
}

const styles = StyleSheet.create({
  chips: {
    gap: spacing.sm,
    paddingRight: spacing.lg,
  },
  toolbar: {
    gap: spacing.md,
  },
  left: {
    alignSelf: 'flex-start',
  },
  list: {
    gap: spacing.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  subRow: {
    paddingLeft: spacing.xl,
  },
  swatch: {
    width: 30,
    height: 30,
    borderRadius: radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flex: {
    flex: 1,
    minWidth: 0,
  },
  footer: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  primary: {
    flex: 1,
  },
  group: {
    gap: spacing.sm,
  },
  swatchRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  colorDot: {
    width: 36,
    height: 36,
    borderRadius: radii.pill,
    borderWidth: 2,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  colorDotSelected: {
    borderColor: colors.textPrimary,
  },
  icons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
});
