import { Image } from 'expo-image';
import { Linking, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { AppText, Button, Icon, IconButton } from '@/components/ui';
import { colors, spacing } from '@/theme';

import { useAutoCover } from './useAutoCover';
import { imageSource } from './wikimediaClient';
import type { CoverQuery } from './wikimedia';

/**
 * A representative image chosen automatically, with its credit and licence
 * (required by Wikimedia Commons), a "Change" action and a plain placeholder
 * when nothing suitable exists. Used only when the user has no cover of their own.
 */
export function AutoCover({
  subject,
  query,
  style,
  label,
  compact = false,
  creditAtTop = false,
  hideWhenMissing = false,
  testID,
}: {
  subject: { type: 'trip' | 'node'; id: string };
  query: CoverQuery | null;
  style?: StyleProp<ViewStyle>;
  label: string;
  compact?: boolean;
  /** Put the credit line at the top (when the bottom of the picture carries a title). */
  creditAtTop?: boolean;
  /** Render nothing (no placeholder or retry panel) until a photo is found; the caller shows its own backdrop. */
  hideWhenMissing?: boolean;
  testID?: string;
}) {
  const { state, refresh, retry, busy } = useAutoCover(subject, query);
  const cover = state.status === 'ready' ? state.cover : null;
  const uri = state.status === 'ready' ? state.uri : null;
  if (hideWhenMissing && !(cover?.status === 'found' && uri)) return null;
  return (
    <View style={[styles.frame, style]} testID={testID}>
      {cover?.status === 'found' && uri ? (
        <>
          <Image source={imageSource(uri)} style={StyleSheet.absoluteFill} contentFit="cover" accessibilityLabel={`${label}: ${cover.title}`} cachePolicy="memory-disk" transition={150} />
          <View style={[styles.credit, creditAtTop && styles.creditTop]}>
            <AppText variant="caption" style={styles.creditText} numberOfLines={1} onPress={() => void Linking.openURL(cover.sourceUrl)} testID={testID ? `${testID}-credit` : undefined}>
              {cover.title} · {cover.credit} · {cover.license} · Wikimedia Commons
            </AppText>
            {!compact ? (
              <IconButton icon="image-refresh-outline" size="sm" accessibilityLabel="Show a different photo" onPress={() => void refresh()} disabled={busy} testID={testID ? `${testID}-change` : undefined} />
            ) : null}
          </View>
        </>
      ) : (
        <View style={styles.placeholder} testID={testID ? `${testID}-${state.status === 'loading' ? 'loading' : state.status === 'error' ? 'error' : 'none'}` : undefined}>
          <Icon name={state.status === 'error' ? 'image-off-outline' : 'image-filter-hdr'} size={compact ? 24 : 40} color={colors.textMuted} />
          {!compact ? (
            <>
              <AppText variant="caption" tone="textMuted" align="center">
                {state.status === 'loading'
                  ? 'Finding a photo of this place…'
                  : state.status === 'error'
                    ? 'Couldn’t load a photo right now (offline or the photo service is busy).'
                    : 'No free photo of this place was found. Add your own, or search again later.'}
              </AppText>
              {state.status !== 'loading' ? (
                <Button
                  label={state.status === 'error' ? 'Retry' : 'Search again'}
                  icon="refresh"
                  size="sm"
                  variant="secondary"
                  loading={busy}
                  onPress={() => void retry()}
                  testID={testID ? `${testID}-retry` : undefined}
                />
              ) : null}
            </>
          ) : null}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { overflow: 'hidden', backgroundColor: colors.surfaceRaised },
  placeholder: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg },
  credit: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingLeft: spacing.sm,
    backgroundColor: colors.photoChrome,
  },
  creditTop: { top: 0, bottom: undefined },
  creditText: { flex: 1, color: colors.textPrimary },
});
