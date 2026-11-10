import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Screen } from '@/components/layout/Screen';
import { goBackOrHome, ScreenHeader } from '@/components/layout/ScreenHeader';
import {
  AppText,
  Button,
  EmptyState,
  LoadingState,
  Notice,
  OptionTile,
  Stepper,
  TextField,
} from '@/components/ui';
import { toErrorMessage } from '@/lib/errors';
import { successFeedback } from '@/lib/haptics';
import { colors, spacing } from '@/theme';

import { ImagePickerField } from './components/ImagePickerField';
import { useCategoryMaps, useEnsureInventoryLoaded } from './hooks';
import { useInventoryStore } from './inventoryStore';
import {
  AVAILABILITIES,
  CONDITION_LABELS,
  emptyItemInput,
  formatWeight,
  INVENTORY_LIMITS,
  ITEM_CONDITIONS,
  itemToInput,
  parseWeight,
  STATUS_META,
  validateItemInput,
  type ItemInput,
} from './model';

function Chips<T extends string>({
  label,
  options,
  value,
  onChange,
  testIDPrefix,
}: {
  label: string;
  options: { value: T; label: string; icon: React.ComponentProps<typeof OptionTile>['icon'] }[];
  value: T | null;
  onChange: (value: T) => void;
  testIDPrefix: string;
}) {
  return (
    <View style={styles.group}>
      <AppText variant="label" tone="textSecondary">
        {label}
      </AppText>
      <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel={label}>
        {options.map((option) => (
          <OptionTile
            key={option.value}
            layout="chip"
            label={option.label}
            icon={option.icon}
            selected={value === option.value}
            onPress={() => onChange(option.value)}
            testID={`${testIDPrefix}-${option.value}`}
          />
        ))}
      </View>
    </View>
  );
}

function Form({ itemId, initial }: { itemId: string | null; initial: ItemInput }) {
  const maps = useCategoryMaps();
  const [input, setInput] = useState<ItemInput>(initial);
  const [weightText, setWeightText] = useState(initial.weightGrams === null ? '' : String(initial.weightGrams));
  const [revealed, setRevealed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const patch = (value: Partial<ItemInput>) => setInput((current) => ({ ...current, ...value }));

  const weight = parseWeight(weightText);
  const errors = validateItemInput({ ...input, weightGrams: weight === null || Number.isNaN(weight) ? null : weight });
  if (Number.isNaN(weight)) errors.weightGrams = 'Use grams (e.g. 350) or kg (e.g. 1.2 kg).';
  const category = input.categoryId ? maps.byId.get(input.categoryId) : undefined;
  const subcategories = input.categoryId ? maps.childrenOf(input.categoryId) : [];

  async function save() {
    setRevealed(true);
    if (Object.keys(errors).length > 0) return;
    setSaving(true);
    setError(null);
    const value = { ...input, weightGrams: weight as number | null };
    try {
      const store = useInventoryStore.getState();
      const saved = itemId ? await store.updateItem(itemId, value) : await store.createItem(value);
      successFeedback();
      if (itemId) goBackOrHome();
      else router.replace({ pathname: '/inventory/item/[itemId]', params: { itemId: saved.id } });
    } catch (err) {
      setError(toErrorMessage(err, 'Could not save the item.'));
      setSaving(false);
    }
  }

  return (
    <Screen
      testID="item-form"
      footer={
        <View style={styles.footer}>
          <Button label="Cancel" variant="secondary" onPress={goBackOrHome} disabled={saving} />
          <Button
            label={itemId ? 'Save changes' : 'Add to inventory'}
            icon="content-save-outline"
            onPress={() => void save()}
            loading={saving}
            style={styles.primary}
            testID="item-save"
          />
        </View>
      }
    >
      <ScreenHeader showBack backIcon="close" eyebrow="Inventory" title={itemId ? 'Edit item' : 'New item'} />

      <TextField
        label="Name"
        placeholder="e.g. Merino T-shirt"
        value={input.name}
        onChangeText={(name) => patch({ name })}
        error={revealed ? errors.name : undefined}
        maxLength={INVENTORY_LIMITS.nameMax}
        autoCapitalize="sentences"
        testID="item-name-input"
      />

      <ImagePickerField
        label="Picture"
        image={input.image}
        onChange={(image) => patch({ image })}
        nameForSuggestion={input.name}
        fallbackIcon={category?.icon ?? 'shape-outline'}
        fallbackColor={category?.color ?? colors.info}
      />

      <Chips
        label="Category"
        value={input.categoryId}
        onChange={(categoryId) => patch({ categoryId: categoryId === input.categoryId ? null : categoryId, subcategoryId: null })}
        options={maps.topLevel.map((c) => ({ value: c.id, label: c.name, icon: c.icon }))}
        testIDPrefix="item-category"
      />
      {subcategories.length > 0 ? (
        <Chips
          label="Subcategory (optional)"
          value={input.subcategoryId}
          onChange={(subcategoryId) =>
            patch({ subcategoryId: subcategoryId === input.subcategoryId ? null : subcategoryId })
          }
          options={subcategories.map((c) => ({ value: c.id, label: c.name, icon: c.icon }))}
          testIDPrefix="item-subcategory"
        />
      ) : null}

      <Stepper
        label="Quantity"
        description="How many you own"
        value={input.quantity}
        min={0}
        max={INVENTORY_LIMITS.quantityMax}
        onChange={(quantity) => patch({ quantity })}
        testID="item-quantity"
      />

      <TextField
        label="Weight per item (optional)"
        placeholder="e.g. 350 g or 1.2 kg"
        value={weightText}
        onChangeText={setWeightText}
        error={revealed ? errors.weightGrams : undefined}
        helper={weight && !Number.isNaN(weight) ? `= ${formatWeight(weight)}` : 'Used for luggage weight estimates'}
        keyboardType="decimal-pad"
        testID="item-weight-input"
      />

      <View style={styles.twoCol}>
        <View style={styles.flex}>
          <TextField
            label="Brand"
            value={input.brand}
            onChangeText={(brand) => patch({ brand })}
            maxLength={INVENTORY_LIMITS.brandMax}
            testID="item-brand-input"
          />
        </View>
        <View style={styles.flex}>
          <TextField
            label="Model"
            value={input.model}
            onChangeText={(model) => patch({ model })}
            maxLength={INVENTORY_LIMITS.brandMax}
          />
        </View>
      </View>
      {revealed && errors.brand ? (
        <AppText variant="caption" tone="danger">
          {errors.brand}
        </AppText>
      ) : null}

      <TextField
        label="Storage location"
        placeholder="e.g. Hall cupboard, blue box"
        icon="map-marker-outline"
        value={input.storageLocation}
        onChangeText={(storageLocation) => patch({ storageLocation })}
        maxLength={INVENTORY_LIMITS.locationMax}
        testID="item-location-input"
      />

      <Chips
        label="Condition"
        value={input.condition}
        onChange={(condition) => patch({ condition })}
        options={ITEM_CONDITIONS.map((c) => ({
          value: c,
          label: CONDITION_LABELS[c],
          icon: c === 'needs_repair' ? 'wrench-outline' : c === 'new' ? 'star-outline' : 'check',
        }))}
        testIDPrefix="item-condition"
      />

      <Chips
        label="Availability"
        value={input.availability}
        onChange={(availability) => patch({ availability })}
        options={AVAILABILITIES.map((a) => ({
          value: a,
          label: a === 'borrowed' ? 'Borrowed (lent out)' : STATUS_META[a].label,
          icon: STATUS_META[a].icon,
        }))}
        testIDPrefix="item-availability"
      />

      <TextField
        label="Description (optional)"
        value={input.description}
        onChangeText={(description) => patch({ description })}
        maxLength={INVENTORY_LIMITS.descriptionMax}
        multiline
        testID="item-description-input"
      />

      {revealed && Object.keys(errors).length > 0 ? (
        <Notice tone="warning" title="Check the highlighted fields" />
      ) : null}
      {error ? <Notice tone="danger" title="Not saved" message={error} /> : null}
    </Screen>
  );
}

export function ItemFormScreen({ itemId, categoryId }: { itemId?: string; categoryId?: string }) {
  useEnsureInventoryLoaded();
  const status = useInventoryStore((state) => state.status);
  const item = useInventoryStore((state) => state.items.find((i) => i.id === itemId));

  if (status !== 'ready') {
    return (
      <Screen bottomInset>
        <LoadingState label="Loading…" />
      </Screen>
    );
  }
  if (itemId && !item) {
    return (
      <Screen bottomInset>
        <ScreenHeader showBack backIcon="close" title="Edit item" />
        <EmptyState icon="file-question-outline" title="Item not found" message="It may have been deleted." />
      </Screen>
    );
  }
  return (
    <Form
      key={itemId ?? 'new'}
      itemId={itemId ?? null}
      initial={item ? itemToInput(item) : emptyItemInput(categoryId && categoryId !== 'uncategorised' ? categoryId : null)}
    />
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
  group: {
    gap: spacing.sm,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  twoCol: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  flex: {
    flex: 1,
  },
});
