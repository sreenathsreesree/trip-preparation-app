import { useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText, Button, Icon, Notice } from '@/components/ui';
import { toErrorMessage } from '@/lib/errors';
import { pickAndStoreImage, type PickSource } from '@/lib/imageStore';
import { colors, radii, sizes, spacing } from '@/theme';
import type { IconName } from '@/theme/icons';

import { ILLUSTRATIONS, illustrationUri, suggestIllustration, type ItemImage as ItemImageValue } from '../model';
import { ItemImage } from './ItemImage';

function IllustrationPicker({
  visible,
  color,
  onPick,
  onClose,
}: {
  visible: boolean;
  color: string;
  onPick: (key: string) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.modalRoot}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close">
          <View style={styles.backdrop} />
        </Pressable>
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]} testID="illustration-picker">
          <AppText variant="title">Choose an illustration</AppText>
          <AppText variant="caption" tone="textMuted">
            Generic icons, not photos of your item. Add a photo for the real thing.
          </AppText>
          <ScrollView contentContainerStyle={styles.illustrations}>
            {ILLUSTRATIONS.map((illustration) => (
              <Pressable
                key={illustration.key}
                accessibilityRole="button"
                accessibilityLabel={illustration.label}
                onPress={() => {
                  onPick(illustration.key);
                  onClose();
                }}
                style={({ pressed }) => [styles.illustration, pressed && styles.pressed]}
                testID={`illustration-${illustration.key}`}
              >
                <Icon name={illustration.icon} size={28} color={color} />
                <AppText variant="caption" tone="textSecondary" numberOfLines={1}>
                  {illustration.label}
                </AppText>
              </Pressable>
            ))}
          </ScrollView>
          <Button label="Cancel" variant="secondary" onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

export interface ImagePickerFieldProps {
  label: string;
  image: ItemImageValue | null;
  onChange: (image: ItemImageValue | null) => void;
  /** Item name, used to offer (never apply) a matching illustration. */
  nameForSuggestion?: string;
  fallbackIcon: IconName;
  fallbackColor: string;
}

/**
 * Photo first: take or choose a picture. Otherwise pick an illustration, or
 * approve a suggested one. Nothing is ever assigned without the user's tap.
 */
export function ImagePickerField({
  label,
  image,
  onChange,
  nameForSuggestion,
  fallbackIcon,
  fallbackColor,
}: ImagePickerFieldProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState<PickSource | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const suggestion = nameForSuggestion ? suggestIllustration(nameForSuggestion) : null;
  const showSuggestion = !image && suggestion && dismissed !== suggestion.key;

  async function pick(source: PickSource) {
    setError(null);
    setBusy(source);
    try {
      const uri = await pickAndStoreImage(source);
      if (uri) onChange({ uri, source: 'photo' });
    } catch (err) {
      setError(toErrorMessage(err, 'Could not get that photo.'));
    } finally {
      setBusy(null);
    }
  }

  const describe =
    image?.source === 'photo'
      ? 'Your photo'
      : image?.source === 'library'
        ? 'Illustration you chose'
        : image?.source === 'suggested'
          ? 'Suggested illustration (approved)'
          : 'No picture yet — the category icon is shown';

  return (
    <View style={styles.container}>
      <AppText variant="label" tone="textSecondary">
        {label}
      </AppText>
      <View style={styles.row}>
        <ItemImage image={image} fallbackIcon={fallbackIcon} fallbackColor={fallbackColor} size={88} />
        <View style={styles.flex}>
          <AppText variant="caption" tone="textSecondary">
            {describe}
          </AppText>
          {image ? (
            <Button
              label="Remove picture"
              icon="image-remove"
              variant="ghost"
              size="sm"
              onPress={() => onChange(null)}
              style={styles.left}
              testID="image-remove"
            />
          ) : null}
        </View>
      </View>
      <View style={styles.buttons}>
        {Platform.OS !== 'web' ? (
          <Button
            label="Take photo"
            icon="camera-outline"
            variant="secondary"
            size="sm"
            loading={busy === 'camera'}
            onPress={() => void pick('camera')}
            testID="image-camera"
          />
        ) : null}
        <Button
          label="Choose photo"
          icon="image-outline"
          variant="secondary"
          size="sm"
          loading={busy === 'library'}
          onPress={() => void pick('library')}
          testID="image-library"
        />
        <Button
          label="Illustration"
          icon="shape-outline"
          variant="secondary"
          size="sm"
          onPress={() => setPickerOpen(true)}
          testID="image-illustration"
        />
      </View>
      {showSuggestion && suggestion ? (
        <View style={styles.suggestion} testID="image-suggestion">
          <Icon name={suggestion.icon} color={fallbackColor} />
          <AppText variant="caption" tone="textSecondary" style={styles.flex}>
            Use the “{suggestion.label}” illustration?
          </AppText>
          <Button
            label="Use it"
            size="sm"
            variant="ghost"
            onPress={() => onChange({ uri: illustrationUri(suggestion.key), source: 'suggested' })}
            testID="image-suggestion-accept"
          />
          <Button label="No" size="sm" variant="ghost" onPress={() => setDismissed(suggestion.key)} />
        </View>
      ) : null}
      {error ? <Notice tone="danger" title="No photo added" message={error} /> : null}
      <IllustrationPicker
        visible={pickerOpen}
        color={fallbackColor}
        onClose={() => setPickerOpen(false)}
        onPick={(key) => onChange({ uri: illustrationUri(key), source: 'library' })}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  flex: {
    flex: 1,
  },
  left: {
    alignSelf: 'flex-start',
  },
  buttons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  suggestion: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  modalRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    flex: 1,
    backgroundColor: colors.overlay,
  },
  sheet: {
    maxHeight: '80%',
    width: '100%',
    maxWidth: sizes.maxContentWidth,
    alignSelf: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.backgroundElevated,
  },
  illustrations: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  illustration: {
    width: 76,
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  pressed: {
    opacity: 0.7,
  },
});
