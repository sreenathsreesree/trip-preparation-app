import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { StyleSheet, useWindowDimensions, View, type LayoutChangeEvent, type ScrollViewInstance } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, { LinearTransition, useAnimatedStyle, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';

import { Icon } from '@/components/ui';
import { selectionFeedback } from '@/lib/haptics';
import { colors, radii, spacing } from '@/theme';

import { computeDrop, isNoOp, type DropTarget } from '../dragDrop';

export interface DraggableItem {
  id: string;
  parentId: string | null;
  depth: number;
  /** Whether the item's children are shown below it. */
  expanded: boolean;
  hasChildren: boolean;
  /** Footer rows (e.g. "Add place") are not draggable and are never drop targets. */
  draggable: boolean;
}

export type MoveAction = 'up' | 'down' | 'out';

export interface RenderContext {
  /** The drag handle to place in the row (already wired up). */
  handle: ReactNode;
  isDragging: boolean;
  /** The row is the "drop inside" target right now. */
  isDropInside: boolean;
  /** Another row is being dragged. */
  dragActive: boolean;
}

export interface ScrollBinding {
  ref: RefObject<ScrollViewInstance | null>;
  /** Latest vertical scroll offset (kept up to date by the screen). */
  offset: RefObject<number>;
}

const EDGE = 96;
/** Vertical gap between rows (matches styles.list). */
const GAP = spacing.sm;
const MAX_SPEED = 14;

/**
 * A list whose rows can be reordered (and, for trees, nested / promoted) by
 * dragging their handle. Rows stay in place while dragging; an insertion line
 * or a highlighted parent shows where the item will go. Drops are validated
 * by `canPlaceIn` before they are allowed, and only committed through `onDrop`.
 */
export function DraggableList<T extends DraggableItem>({
  items,
  allowNest,
  siblings,
  subtreeOf,
  canPlaceIn,
  onDrop,
  onAccessibleMove,
  renderItem,
  indent,
  scroll,
  onDragActiveChange,
  testID,
}: {
  items: readonly T[];
  allowNest: boolean;
  siblings: ReadonlyMap<string | null, readonly string[]>;
  /** The item and everything inside it. */
  subtreeOf: (id: string) => readonly string[];
  canPlaceIn: (draggedId: string, parentId: string | null) => boolean;
  onDrop: (id: string, target: { parentId: string | null; index: number }) => void;
  /** Screen-reader alternative to dragging. */
  onAccessibleMove: (id: string, action: MoveAction) => void;
  renderItem: (item: T, context: RenderContext) => ReactNode;
  indent: number;
  scroll?: ScrollBinding;
  onDragActiveChange?: (active: boolean) => void;
  testID?: string;
}) {
  /** Row heights (onLayout fires reliably for size changes on every platform). */
  const heights = useRef(new Map<string, number>());
  const drag = useRef<{
    id: string;
    grab: number;
    startTop: number;
    startScroll: number;
    translation: number;
    absoluteY: number;
    /** Where the pointer started (screen); auto-scroll only follows movement away from it. */
    startAbsoluteY: number;
    target: DropTarget | null;
  } | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [target, setTarget] = useState<DropTarget | null>(null);
  /** Where the insertion line is drawn (list coordinates), computed when the target changes. */
  const [line, setLine] = useState<{ top: number; left: number } | null>(null);
  const translate = useSharedValue(0);
  /** Id of the row being dragged ('' when none); every row reads it so offsets always reset. */
  const activeId = useSharedValue('');
  const autoScroll = useRef<ReturnType<typeof setInterval> | null>(null);
  const { height: windowHeight } = useWindowDimensions();

  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  const onLayout = (id: string) => (event: LayoutChangeEvent) => {
    heights.current.set(id, event.nativeEvent.layout.height);
  };

  /**
   * Row tops from the stacked heights. Positions are derived rather than
   * measured because web only reports layout when a row's size changes, not
   * when it merely moves (after another row was dropped elsewhere).
   */
  const geometry = () => {
    const result = new Map<string, { top: number; height: number }>();
    let top = 0;
    for (const item of itemsRef.current) {
      const height = heights.current.get(item.id) ?? 0;
      result.set(item.id, { top, height });
      top += height + GAP;
    }
    return result;
  };

  const scrollOffset = () => scroll?.offset.current ?? 0;

  const update = useCallback(() => {
    const state = drag.current;
    if (!state) return;
    const delta = scrollOffset() - state.startScroll;
    translate.set(state.translation + delta);
    const y = state.startTop + state.grab + state.translation + delta;
    const dragged = new Set(subtreeOf(state.id));
    const layouts = geometry();
    const rows = itemsRef.current
      .filter((item) => item.draggable)
      .flatMap((item) => {
        const layout = layouts.get(item.id);
        return layout ? [{ ...item, top: layout.top, height: layout.height }] : [];
      });
    const next = computeDrop(rows, y, {
      allowNest,
      siblings,
      dragged,
      canPlaceIn: (parentId) => canPlaceIn(state.id, parentId),
    });
    const changed = next?.kind !== state.target?.kind || next?.rowId !== state.target?.rowId || next?.parentId !== state.target?.parentId;
    state.target = next;
    if (changed) {
      setTarget(next);
      const layout = next && next.kind !== 'inside' ? layouts.get(next.rowId) : undefined;
      setLine(
        next && layout
          ? { top: next.kind === 'before' ? layout.top - 3 : layout.top + layout.height + 1, left: Math.min(next.depth, 5) * indent }
          : null,
      );
      if (next) selectionFeedback();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowNest, siblings, subtreeOf, canPlaceIn, translate]);

  const stopAutoScroll = () => {
    if (autoScroll.current) clearInterval(autoScroll.current);
    autoScroll.current = null;
  };

  const tickAutoScroll = useCallback(() => {
    const state = drag.current;
    if (!state || !scroll?.ref.current) return;
    const { absoluteY, startAbsoluteY } = state;
    let speed = 0;
    // Only scroll in the direction the item is being moved, so starting a drag near an edge does not scroll.
    if (absoluteY < EDGE && absoluteY < startAbsoluteY - 12) speed = -Math.ceil(((EDGE - absoluteY) / EDGE) * MAX_SPEED);
    else if (absoluteY > windowHeight - EDGE && absoluteY > startAbsoluteY + 12)
      speed = Math.ceil(((absoluteY - (windowHeight - EDGE)) / EDGE) * MAX_SPEED);
    if (speed === 0) return;
    const nextOffset = Math.max(0, scrollOffset() + speed);
    // The screen's onScroll keeps `scroll.offset` current; targets follow on the next tick.
    scroll.ref.current.scrollTo({ y: nextOffset, animated: false });
    update();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scroll, windowHeight, update]);

  const start = (id: string, grab: number, absoluteY: number) => {
    const layout = geometry().get(id);
    if (!layout) return;
    drag.current = {
      id,
      grab,
      startTop: layout.top,
      startScroll: scrollOffset(),
      translation: 0,
      absoluteY,
      startAbsoluteY: absoluteY,
      target: null,
    };
    translate.set(0);
    activeId.set(id);
    setDraggingId(id);
    setTarget(null);
    onDragActiveChange?.(true);
    selectionFeedback();
    stopAutoScroll();
    autoScroll.current = setInterval(tickAutoScroll, 16);
  };

  const move = (translationY: number, absoluteY: number) => {
    if (!drag.current) return;
    drag.current.translation = translationY;
    drag.current.absoluteY = absoluteY;
    update();
  };

  const finish = (commit: boolean) => {
    stopAutoScroll();
    const state = drag.current;
    drag.current = null;
    translate.set(withTiming(0, { duration: 150 }));
    activeId.set('');
    setDraggingId(null);
    setTarget(null);
    setLine(null);
    onDragActiveChange?.(false);
    if (!commit || !state?.target) return;
    const item = itemsRef.current.find((i) => i.id === state.id);
    if (!item || isNoOp(state.target, item, siblings)) return;
    onDrop(state.id, { parentId: state.target.parentId, index: state.target.index });
  };

  useEffect(() => stopAutoScroll, []);

  const indicator = line ? (
    <View pointerEvents="none" style={[styles.indicator, { top: line.top, left: line.left }]} testID="drop-indicator">
      <View style={styles.indicatorDot} />
    </View>
  ) : null;

  return (
    <View style={styles.list} testID={testID}>
      {items.map((item) => {
        const isDragging = draggingId === item.id;
        const handle = item.draggable ? (
          <DragHandle
            label={`Drag to move. Swipe up or down for actions.`}
            onStart={(grab, absoluteY) => start(item.id, grab, absoluteY)}
            onMove={move}
            onEnd={finish}
            onAction={(action) => onAccessibleMove(item.id, action)}
            canMoveOut={item.parentId !== null && allowNest}
            testID={`drag-${item.id}`}
          />
        ) : null;
        return (
          <DraggableRow
            key={item.id}
            id={item.id}
            activeId={activeId}
            translate={translate}
            isDragging={isDragging}
            onLayout={onLayout(item.id)}
          >
            {renderItem(item, {
              handle,
              isDragging,
              isDropInside: target?.kind === 'inside' && target.rowId === item.id,
              dragActive: draggingId !== null && !isDragging,
            })}
          </DraggableRow>
        );
      })}
      {indicator}
    </View>
  );
}

function DraggableRow({
  id,
  activeId,
  translate,
  isDragging,
  onLayout,
  children,
}: {
  id: string;
  activeId: SharedValue<string>;
  translate: SharedValue<number>;
  isDragging: boolean;
  onLayout: (event: LayoutChangeEvent) => void;
  children: ReactNode;
}) {
  const style = useAnimatedStyle(() => ({ transform: [{ translateY: activeId.get() === id ? translate.get() : 0 }] }));
  return (
    <Animated.View layout={LinearTransition.duration(180)} onLayout={onLayout} style={[isDragging && styles.dragging, style]}>
      {children}
    </Animated.View>
  );
}

function DragHandle({
  label,
  onStart,
  onMove,
  onEnd,
  onAction,
  canMoveOut,
  testID,
}: {
  label: string;
  onStart: (grab: number, absoluteY: number) => void;
  onMove: (translationY: number, absoluteY: number) => void;
  onEnd: (commit: boolean) => void;
  onAction: (action: MoveAction) => void;
  canMoveOut: boolean;
  testID: string;
}) {
  // Runs on the JS thread: drop targets are computed from measured row layouts.
  const gesture = usePanGesture({
    runOnJS: true,
    minDistance: 2,
    // The handle sits centred in the row; its top is ~6 pt below the row's top.
    onActivate: (event) => onStart(event.y + 6, event.absoluteY),
    onUpdate: (event) => onMove(event.translationY, event.absoluteY),
    onDeactivate: (event) => onEnd(!event.canceled),
    onFinalize: (event) => {
      if (event.canceled) onEnd(false);
    },
  });

  return (
    <GestureDetector gesture={gesture}>
      <View
        style={styles.handle}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={label}
        accessibilityActions={[
          { name: 'increment', label: 'Move down' },
          { name: 'decrement', label: 'Move up' },
          ...(canMoveOut ? [{ name: 'moveOut', label: 'Move out of its parent' }] : []),
        ]}
        onAccessibilityAction={(event) => {
          const name = event.nativeEvent.actionName;
          onAction(name === 'increment' ? 'down' : name === 'decrement' ? 'up' : 'out');
        }}
        testID={testID}
      >
        <Icon name="drag-vertical" tone="textMuted" />
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: spacing.sm,
  },
  handle: {
    width: 36,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'grab',
    touchAction: 'none',
  },
  dragging: {
    zIndex: 10,
    opacity: 0.92,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  indicator: {
    position: 'absolute',
    right: 0,
    height: 3,
    borderRadius: radii.pill,
    backgroundColor: colors.accent,
  },
  indicatorDot: {
    position: 'absolute',
    left: -4,
    top: -3,
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: colors.accent,
  },
});
