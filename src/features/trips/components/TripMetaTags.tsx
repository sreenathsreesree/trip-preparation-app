import { StyleSheet, View } from 'react-native';

import { Tag } from '@/components/ui';
import { colors, spacing } from '@/theme';

import {
  describeTravellers,
  TRANSPORT_MODE_META,
  TRIP_CATEGORY_META,
  type Trip,
} from '../model';

export function TripMetaTags({ trip }: { trip: Trip }) {
  const transport = TRANSPORT_MODE_META[trip.transportMode];
  const category = TRIP_CATEGORY_META[trip.category];
  return (
    <View style={styles.row}>
      <Tag icon={transport.icon} label={transport.label} color={colors.info} />
      <Tag icon={category.icon} label={category.label} color={colors.warning} />
      <Tag icon="account-group-outline" label={describeTravellers(trip.travellers)} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
});
