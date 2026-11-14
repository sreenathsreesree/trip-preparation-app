import { Image } from 'expo-image';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Icon } from '@/components/ui';
import { colors, radii } from '@/theme';

import { DrivePhoto } from '../journal/components/DrivePhoto';
import type { PlanNode } from '../planner/model';
import { useTripPlan } from '../planner/plannerStore';
import { nodeCoverQuery } from './coverQuery';
import { useAutoCover } from './useAutoCover';

/**
 * A small picture of a destination for cards, route stops and lists. The
 * user's own cover photo always wins; otherwise the automatic cover's small
 * variant (stored on the device, so it shows offline); otherwise a plain icon.
 * Credit and licence for automatic covers are shown on the destination page.
 */
export function DestinationThumb({ tripId, node, size = 56, style, testID }: { tripId: string; node: PlanNode; size?: number; style?: StyleProp<ViewStyle>; testID?: string }) {
  const { plan, companion } = useTripPlan(tripId);
  const own = companion?.profiles.find((p) => p.nodeId === node.id)?.coverImageUri ?? null;
  const query = own ? null : nodeCoverQuery(plan?.nodes ?? [node], node);
  const { state } = useAutoCover({ type: 'node', id: node.id }, query);
  const box = [styles.frame, { width: size, height: size }, style];
  if (own) {
    return (
      <View style={box} testID={testID}>
        <DrivePhoto uri={own} style={StyleSheet.absoluteFill} label={`Photo of ${node.name}`} />
      </View>
    );
  }
  const uri = state.status === 'ready' && state.cover.status === 'found' ? state.thumbUri : null;
  return (
    <View style={box} testID={testID}>
      {uri ? (
        <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" recyclingKey={node.id} transition={120} accessibilityLabel={`Photo of ${node.name}`} />
      ) : (
        <View style={styles.placeholder}>
          <Icon name="image-filter-hdr" size={Math.round(size * 0.4)} color={colors.textMuted} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { overflow: 'hidden', borderRadius: radii.md, backgroundColor: colors.surfaceRaised },
  placeholder: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
