import { useState, type ComponentRef, type Ref } from 'react';
import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

import { colors, fontFamilies, radii, sizes, spacing } from '@/theme';
import type { IconName } from '@/theme/icons';

import { AppText } from './AppText';
import { Icon } from './Icon';

export interface TextFieldProps extends Omit<TextInputProps, 'style' | 'placeholderTextColor'> {
  label: string;
  helper?: string;
  error?: string;
  icon?: IconName;
  /** Shows a live "12/60" counter when `maxLength` is set. */
  showCount?: boolean;
  ref?: Ref<ComponentRef<typeof TextInput>>;
}

export function TextField({
  label,
  helper,
  error,
  icon,
  showCount = false,
  maxLength,
  value,
  onFocus,
  onBlur,
  ref,
  multiline,
  ...rest
}: TextFieldProps) {
  const [focused, setFocused] = useState(false);
  const borderColor = error ? colors.danger : focused ? colors.accent : colors.border;
  const message = error ?? helper;

  return (
    <View style={styles.container}>
      <View style={styles.labelRow}>
        <AppText variant="label" tone="textSecondary" nativeID={`${label}-label`}>
          {label}
        </AppText>
        {showCount && maxLength ? (
          <AppText variant="caption" tone="textMuted">
            {(value ?? '').length}/{maxLength}
          </AppText>
        ) : null}
      </View>
      <View
        style={[
          styles.inputShell,
          multiline && styles.inputShellMultiline,
          { borderColor },
          focused && styles.inputFocused,
        ]}
      >
        {icon ? <Icon name={icon} tone={focused ? 'accent' : 'textMuted'} /> : null}
        <TextInput
          ref={ref}
          {...rest}
          value={value}
          maxLength={maxLength}
          multiline={multiline}
          textAlignVertical={multiline ? 'top' : 'center'}
          accessibilityLabel={label}
          aria-invalid={Boolean(error)}
          placeholderTextColor={colors.textMuted}
          selectionColor={colors.accent}
          cursorColor={colors.accent}
          onFocus={(event) => {
            setFocused(true);
            onFocus?.(event);
          }}
          onBlur={(event) => {
            setFocused(false);
            onBlur?.(event);
          }}
          style={[styles.input, multiline && styles.inputMultiline]}
        />
      </View>
      {message ? (
        <AppText
          variant="caption"
          tone={error ? 'danger' : 'textMuted'}
          accessibilityLiveRegion={error ? 'polite' : 'none'}
        >
          {message}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.sm,
  },
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  inputShell: {
    minHeight: sizes.inputHeight,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.md,
    borderWidth: 1,
    backgroundColor: colors.surface,
  },
  inputShellMultiline: {
    alignItems: 'flex-start',
  },
  inputFocused: {
    backgroundColor: colors.surfaceRaised,
  },
  input: {
    flex: 1,
    minHeight: sizes.inputHeight,
    color: colors.textPrimary,
    fontFamily: fontFamilies.body,
    fontSize: 16,
    paddingVertical: spacing.md,
  },
  inputMultiline: {
    minHeight: 96,
    maxHeight: 200,
  },
});
