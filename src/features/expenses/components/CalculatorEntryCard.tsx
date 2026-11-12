import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { AppText, Card, Icon } from '@/components/ui';
import { colors, radii, spacing } from '@/theme';

/** Home entry to the standalone Trip Calculator. */
export function CalculatorEntryCard() {
  return (
    <Card onPress={() => router.push('/calculator')} accessibilityLabel="Open the trip calculator" testID="home-calculator">
      <View style={styles.row}>
        <View style={styles.icon}>
          <Icon name="calculator-variant-outline" tone="accent" />
        </View>
        <View style={styles.flex}>
          <AppText variant="title">Trip calculator</AppText>
          <AppText variant="caption" tone="textSecondary">
            Expenses, who owes whom, budget and fuel costs
          </AppText>
        </View>
        <Icon name="chevron-right" color={colors.textMuted} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  icon: {
    width: 40,
    height: 40,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentSoft,
  },
  flex: {
    flex: 1,
    gap: spacing.xxs,
  },
});
