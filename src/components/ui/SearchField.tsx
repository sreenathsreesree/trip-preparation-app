import { StyleSheet, TextInput, View } from 'react-native';

import { colors, fontFamilies, radii, spacing } from '@/theme';

import { Icon } from './Icon';
import { IconButton } from './IconButton';

export interface SearchFieldProps {
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  testID?: string;
}

export function SearchField({ value, onChangeText, placeholder, testID }: SearchFieldProps) {
  return (
    <View style={styles.shell}>
      <Icon name="magnify" tone="textMuted" />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        selectionColor={colors.accent}
        cursorColor={colors.accent}
        accessibilityLabel={placeholder}
        returnKeyType="search"
        autoCorrect={false}
        style={styles.input}
        testID={testID}
      />
      {value ? (
        <IconButton
          icon="close-circle"
          variant="plain"
          size="sm"
          tone="textMuted"
          accessibilityLabel="Clear search"
          onPress={() => onChangeText('')}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 46,
    paddingLeft: spacing.md,
    paddingRight: spacing.xs,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  input: {
    flex: 1,
    minWidth: 0,
    color: colors.textPrimary,
    fontFamily: fontFamilies.body,
    fontSize: 15,
    paddingVertical: spacing.sm,
  },
});
