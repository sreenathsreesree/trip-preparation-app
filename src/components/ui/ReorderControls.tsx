import { StyleSheet, View } from 'react-native';

import { spacing } from '@/theme';

import { IconButton } from './IconButton';

export interface ReorderControlsProps {
  label: string;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMove: (direction: -1 | 1) => void;
  testID?: string;
}

/** Accessible up/down buttons for reordering a list row. */
export function ReorderControls({ label, canMoveUp, canMoveDown, onMove, testID }: ReorderControlsProps) {
  return (
    <View style={styles.row}>
      <IconButton
        icon="arrow-up"
        variant="plain"
        size="sm"
        accessibilityLabel={`Move ${label} up`}
        disabled={!canMoveUp}
        onPress={() => onMove(-1)}
        testID={testID ? `${testID}-up` : undefined}
      />
      <IconButton
        icon="arrow-down"
        variant="plain"
        size="sm"
        accessibilityLabel={`Move ${label} down`}
        disabled={!canMoveDown}
        onPress={() => onMove(1)}
        testID={testID ? `${testID}-down` : undefined}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: spacing.xxs,
  },
});
