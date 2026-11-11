import { Pressable, StyleSheet, View } from 'react-native';

import { AppText, Icon, IconButton, ReorderControls } from '@/components/ui';
import { colors, radii, spacing } from '@/theme';

import type { PlanTreeNode } from '../model';

/** Indentation stops growing after a few levels so deep trees stay readable on phones. */
const INDENT = 16;
const MAX_VISUAL_DEPTH = 5;

export function PlanRow({
  item,
  descendants,
  expanded,
  routeNumber,
  reorder,
  canMoveUp,
  canMoveDown,
  onToggle,
  onOpen,
  onMore,
  onMove,
}: {
  item: PlanTreeNode;
  /** Places nested anywhere below this one. */
  descendants: number;
  expanded: boolean;
  /** 1-based position in the route, or null when not a route stop. */
  routeNumber: number | null;
  reorder: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onToggle: () => void;
  onOpen: () => void;
  onMore: () => void;
  onMove: (direction: -1 | 1) => void;
}) {
  const { node, depth } = item;
  const main = depth === 0;
  const inside = descendants;
  const meta = [
    inside > 0 ? `${inside} ${inside === 1 ? 'place' : 'places'} inside` : '',
    node.place?.formattedAddress ?? '',
  ]
    .filter(Boolean)
    .join(' · ');
  const visualDepth = Math.min(depth, MAX_VISUAL_DEPTH);

  return (
    <View
      style={[styles.row, main ? styles.main : styles.nested, { marginLeft: visualDepth * INDENT }]}
      testID={`plan-row-${node.name}`}
    >
      {item.children.length > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${expanded ? 'Collapse' : 'Expand'} ${node.name}`}
          accessibilityState={{ expanded }}
          onPress={onToggle}
          hitSlop={4}
          style={styles.toggle}
          testID={`plan-toggle-${node.name}`}
        >
          <Icon name={expanded ? 'chevron-down' : 'chevron-right'} tone="textSecondary" />
        </Pressable>
      ) : (
        <View style={styles.toggle}>
          <Icon name="circle-small" tone="textMuted" />
        </View>
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${node.name}${main ? ', main destination' : ''}${routeNumber ? `, route stop ${routeNumber}` : ''}. Open`}
        onPress={onOpen}
        style={({ pressed }) => [styles.body, pressed && styles.pressed]}
        testID={`plan-open-${node.name}`}
      >
        <View style={[styles.icon, main ? styles.iconMain : styles.iconNested]}>
          <Icon name={main ? 'map-marker-radius' : 'map-marker-outline'} size={main ? 20 : 18} tone={main ? 'accent' : 'info'} />
        </View>
        <View style={styles.text}>
          <AppText variant={main ? 'bodyStrong' : 'body'} numberOfLines={2}>
            {node.name}
          </AppText>
          {meta ? (
            <AppText variant="caption" tone="textMuted" numberOfLines={1}>
              {meta}
            </AppText>
          ) : null}
        </View>
        {routeNumber ? (
          <View style={styles.stop} accessibilityElementsHidden>
            <AppText variant="captionStrong" tone="textOnAccent">
              {routeNumber}
            </AppText>
          </View>
        ) : null}
      </Pressable>
      {reorder ? (
        <ReorderControls
          label={node.name}
          canMoveUp={canMoveUp}
          canMoveDown={canMoveDown}
          onMove={onMove}
          testID={`plan-move-${node.name}`}
        />
      ) : (
        <IconButton icon="dots-vertical" accessibilityLabel={`${node.name} actions`} onPress={onMore} testID={`plan-more-${node.name}`} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 56,
    paddingRight: spacing.xs,
    borderRadius: radii.md,
    borderWidth: 1,
  },
  main: {
    borderColor: colors.borderStrong,
    backgroundColor: colors.surfaceRaised,
  },
  nested: {
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  toggle: {
    width: 36,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  pressed: {
    opacity: 0.75,
  },
  icon: {
    width: 34,
    height: 34,
    borderRadius: radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconMain: {
    backgroundColor: colors.accentSoft,
  },
  iconNested: {
    backgroundColor: colors.infoSoft,
  },
  text: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  stop: {
    minWidth: 24,
    height: 24,
    paddingHorizontal: spacing.xs,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
  },
});
