import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { AppText, IconButton } from '@/components/ui';
import { toErrorMessage } from '@/lib/errors';
import { colors, fontFamilies, radii, sizes, spacing } from '@/theme';

import { normalizeItemTitle, PREP_ITEM_TITLE_MAX } from '../model';

export interface AddItemBarProps {
  placeholder: string;
  onAdd: (title: string) => Promise<void>;
}

export function AddItemBar({ placeholder, onAdd }: AddItemBarProps) {
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canAdd = normalizeItemTitle(value).length > 0 && !saving;

  async function submit() {
    if (!canAdd) return;
    setSaving(true);
    setError(null);
    try {
      await onAdd(value);
      setValue('');
    } catch (err) {
      setError(toErrorMessage(err, 'Could not add the item.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.bar}>
        <TextInput
          value={value}
          onChangeText={(text) => {
            setValue(text);
            if (error) setError(null);
          }}
          placeholder={placeholder}
          placeholderTextColor={colors.textMuted}
          selectionColor={colors.accent}
          cursorColor={colors.accent}
          maxLength={PREP_ITEM_TITLE_MAX}
          returnKeyType="done"
          submitBehavior="submit"
          onSubmitEditing={() => void submit()}
          accessibilityLabel={placeholder}
          style={styles.input}
          testID="add-item-input"
        />
        <IconButton
          icon="plus"
          tone={canAdd ? 'textOnAccent' : 'textMuted'}
          accessibilityLabel="Add item"
          disabled={!canAdd}
          onPress={() => void submit()}
          testID="add-item-button"
          variant={canAdd ? 'accent' : 'plain'}
        />
      </View>
      {error ? (
        <AppText variant="caption" tone="danger" accessibilityLiveRegion="polite">
          {error}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.xs,
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingLeft: spacing.lg,
    paddingRight: spacing.xs,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
  },
  input: {
    flex: 1,
    minHeight: sizes.inputHeight,
    color: colors.textPrimary,
    fontFamily: fontFamilies.body,
    fontSize: 16,
  },
});
