import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText, Icon, IconButton } from '@/components/ui';
import { colors, radii, spacing } from '@/theme';

import type { PlanTreeNode } from '../model';

/** Indentation stops growing after a few levels so deep trees stay readable on phones. */
export const PLAN_INDENT = 16;
export const MAX_VISUAL_DEPTH = 5;
export const indentFor = (depth: number) => Math.min(depth, MAX_VISUAL_DEPTH) * PLAN_INDENT;

export function PlanRow({
  item,
  descendants,
  expanded,
  routeNumber,
  visited = false,
  inNavigation = false,
  handle,
  highlight = false,
  dimmed = false,
  onToggle,
  onOpen,
  onMore,
}: {
  item: PlanTreeNode;
  /** Places nested anywhere below this one. */
  descendants: number;
  expanded: boolean;
  /** 1-based position in the route, or null when not a route stop. */
  routeNumber: number | null;
  visited?: boolean;
  inNavigation?: boolean;
  /** Drag handle (from DraggableList). */
  handle?: ReactNode;
  /** Shown as the parent a dragged place would be dropped into. */
  highlight?: boolean;
  /** Another place is being dragged. */
  dimmed?: boolean;
  onToggle: () => void;
  onOpen: () => void;
  onMore: () => void;
}) {
  const { node, depth } = item;
  const main = depth === 0;
  const meta = [
    descendants > 0 ? `${descendants} ${descendants === 1 ? 'place' : 'places'} inside` : '',
    visited ? 'Visited' : '',
    node.place?.formattedAddress ?? '',
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <View
      style={[
        styles.row,
        main ? styles.main : styles.nested,
        { marginLeft: indentFor(depth) },
        highlight && styles.highlight,
        dimmed && styles.dimmed,
      ]}
      testID={`plan-row-${node.name}`}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${expanded ? 'Collapse' : 'Expand'} ${node.name}`}
        accessibilityState={{ expanded }}
        onPress={onToggle}
        hitSlop={4}
        style={styles.toggle}
        testID={`plan-toggle-${node.name}`}
      >
        <Icon
          name={expanded ? 'chevron-down' : 'chevron-right'}
          tone={item.children.length > 0 ? 'textSecondary' : 'textMuted'}
        />
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${node.name}${main ? ', main destination' : ''}${routeNumber ? `, route stop ${routeNumber}` : ''}${visited ? ', visited' : ''}. Open`}
        onPress={onOpen}
        style={({ pressed }) => [styles.body, pressed && styles.pressed]}
        testID={`plan-open-${node.name}`}
      >
        <View style={[styles.icon, main ? styles.iconMain : styles.iconNested, visited && styles.iconVisited]}>
          <Icon
            name={visited ? 'check' : main ? 'map-marker-radius' : 'map-marker-outline'}
            size={main ? 20 : 18}
            tone={visited ? 'textOnAccent' : main ? 'accent' : 'info'}
          />
        </View>
        <View style={styles.text}>
          <AppText variant={main ? 'bodyStrong' : 'body'} tone={visited ? 'textSecondary' : 'textPrimary'} numberOfLines={2}>
            {node.name}
          </AppText>
          {meta ? (
            <AppText variant="caption" tone="textMuted" numberOfLines={1}>
              {meta}
            </AppText>
          ) : null}
        </View>
        {inNavigation ? <Icon name="navigation-variant-outline" size={16} tone="info" /> : null}
        {routeNumber ? (
          <View style={styles.stop} accessibilityElementsHidden>
            <AppText variant="captionStrong" tone="textOnAccent">
              {routeNumber}
            </AppText>
          </View>
        ) : null}
      </Pressable>
      <IconButton icon="dots-vertical" variant="plain" size="sm" accessibilityLabel={`${node.name} actions`} onPress={onMore} testID={`plan-more-${node.name}`} />
      {handle}
    </View>
  );
}

/** "Add place" line at the end of an expanded place's children. */
export function AddPlaceRow({ parentName, depth, onPress }: { parentName: string; depth: number; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Add a place in ${parentName}`}
      onPress={onPress}
      style={({ pressed }) => [styles.add, { marginLeft: indentFor(depth) }, pressed && styles.pressed]}
      testID={`plan-add-in-${parentName}`}
    >
      <Icon name="plus" size={18} tone="accent" />
      <AppText variant="caption" tone="accent" numberOfLines={1} style={styles.text}>
        Add place in {parentName}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 56,
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
  highlight: {
    borderColor: colors.accent,
    borderWidth: 2,
    backgroundColor: colors.accentSoft,
  },
  dimmed: {
    opacity: 0.85,
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
  iconVisited: {
    backgroundColor: colors.accent,
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
  add: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 44,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.accentBorder,
  },
});
