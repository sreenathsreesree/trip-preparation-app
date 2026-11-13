import { StyleSheet } from 'react-native';

import { radii } from '@/theme';

import { contextLocation } from '../places/discovery';
import { useTripPlan } from '../planner/plannerStore';
import type { TripSummary } from '../trips/model';
import { AutoCover } from './AutoCover';

/** The trip's cover: a representative photo of its first main destination (chosen automatically, with credit). */
export function TripCover({ trip }: { trip: TripSummary }) {
  const { plan } = useTripPlan(trip.id);
  const nodes = plan?.nodes ?? [];
  const main = nodes.filter((n) => n.parentId === null).sort((a, b) => a.position - b.position)[0] ?? null;
  const name = main?.name ?? trip.destinations[0]?.name ?? null;
  if (!name) return null;
  const located = main ? contextLocation(nodes, main.id) : null;
  const wikipedia = typeof main?.place?.metadata?.wikipedia === 'string' ? main.place.metadata.wikipedia : null;
  return (
    <AutoCover
      subject={{ type: 'trip', id: trip.id }}
      query={{ name, context: [main?.place?.state, main?.place?.country].filter(Boolean).join(', '), location: located?.location ?? null, wikipedia }}
      style={styles.cover}
      label={`Cover of ${trip.name}`}
      testID="trip-cover"
    />
  );
}

const styles = StyleSheet.create({
  cover: { height: 160, borderRadius: radii.lg },
});
