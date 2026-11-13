import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText, Button, Card, Icon, Notice } from '@/components/ui';
import { getRepositories } from '@/db/repositories';
import { toErrorMessage } from '@/lib/errors';
import { colors, radii, spacing } from '@/theme';

import { journeyLegs } from '../places/mapsLinks';
import { canTargetMapsApp } from '../places/openMaps';
import type { PlanNode } from '../planner/model';
import { usePlannerStore } from '../planner/plannerStore';
import { timeAgo } from '../remote/timeAgo';
import { optimisedOrder, restorableOrder } from './routeUndoRepository';
import { formatDuration, formatKm, osrmBase, ROUTING_ATTRIBUTION, routeLegs, suggestOrder, type RouteLeg, type RouteResult } from './routing';

const BASE = osrmBase(process.env.EXPO_PUBLIC_ROUTING_URL);

export type LegsState = { status: 'loading' } | { status: 'ready'; result: RouteResult; age: string | null } | { status: 'error'; message: string };

/** Road legs for the upcoming stops, in route order (cache first; recomputed when the order or locations change). */
export function useRouteLegs(stops: readonly PlanNode[]): LegsState {
  const key = stops.map((s) => `${s.id}@${s.place?.location?.latitude ?? ''},${s.place?.location?.longitude ?? ''}`).join('|');
  const [state, setState] = useState<{ key: string; value: LegsState } | null>(null);
  useEffect(() => {
    let live = true;
    const list = key ? key.split('|').map((part) => {
      const [id, loc] = part.split('@') as [string, string];
      const [lat, lon] = loc.split(',');
      return { id, name: id, location: lat && lon ? { latitude: Number(lat), longitude: Number(lon) } : null };
    }) : [];
    void getRepositories()
      .then(({ remoteCache }) => routeLegs(list, { cache: remoteCache, base: BASE }))
      .then((result) => live && setState({ key, value: { status: 'ready', result, age: result.fetchedAt ? timeAgo(result.fetchedAt, new Date()) : null } }))
      .catch((e: unknown) => live && setState({ key, value: { status: 'error', message: toErrorMessage(e, 'Road distances are unavailable.') } }));
    return () => {
      live = false;
    };
  }, [key]);
  return state?.key === key ? state.value : { status: 'loading' };
}

/** One leg's text: road distance and driving time, or why there is none (never straight-line). */
export function legText(leg: RouteLeg | undefined, toName: string): { text: string; tone: 'textSecondary' | 'textMuted' | 'warning' } {
  if (!leg) return { text: `→ ${toName}`, tone: 'textMuted' };
  if (leg.meters !== null && leg.seconds !== null) return { text: `→ ${toName} · ${formatKm(leg.meters)} · about ${formatDuration(leg.seconds)} by road`, tone: 'textSecondary' };
  if (leg.reason === 'missing_location') return { text: `→ ${toName} · road distance needs both locations`, tone: 'warning' };
  if (leg.reason === 'no_route') return { text: `→ ${toName} · no road route found`, tone: 'warning' };
  return { text: `→ ${toName} · road distance unavailable offline`, tone: 'textMuted' };
}

/**
 * Journey overview above the stops: total road distance and driving time of
 * the upcoming stops, how many legs could be measured, stops without a
 * location, how Google Maps will split the journey, and route optimisation
 * that is only ever a proposal (shown first, applied on request, with undo).
 */
export function RouteOverview({ tripId, order, upcoming, visited, legs }: { tripId: string; order: string[]; upcoming: PlanNode[]; visited: ReadonlySet<string>; legs: LegsState }) {
  const [proposal, setProposal] = useState<{ order: string[]; names: string[] } | null>(null);
  const [saved, setSaved] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'info' | 'danger' | 'success'; text: string } | null>(null);
  const missing = upcoming.filter((s) => !s.place?.location);
  const mapsLegs = journeyLegs(upcoming, canTargetMapsApp ? 'app' : 'browser').length;

  const loadUndo = useCallback(async () => {
    const { routeUndo } = await getRepositories();
    setSaved(await routeUndo.get(tripId));
  }, [tripId]);
  useEffect(() => {
    let live = true;
    void getRepositories()
      .then(({ routeUndo }) => routeUndo.get(tripId))
      .then((v) => live && setSaved(v));
    return () => {
      live = false;
    };
  }, [tripId]);

  const propose = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const suggested = await suggestOrder(
        upcoming.map((s) => ({ id: s.id, name: s.name, location: s.place?.location ?? null })),
        { base: BASE },
      );
      const next = suggested ? optimisedOrder(order, visited, suggested) : null;
      if (!suggested) setMessage({ tone: 'info', text: missing.length ? 'Every upcoming stop needs a location to suggest an order.' : 'A shorter order could not be worked out right now (needs internet and 4–25 stops).' });
      else if (!next) setMessage({ tone: 'success', text: 'Your order is already the shortest the router found. Nothing changed.' });
      else setProposal({ order: next, names: next.filter((id) => !visited.has(id)).map((id) => upcoming.find((s) => s.id === id)?.name ?? '') });
    } catch (e) {
      setMessage({ tone: 'danger', text: toErrorMessage(e, 'Could not suggest an order.') });
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    if (!proposal) return;
    const { routeUndo } = await getRepositories();
    await routeUndo.save(tripId, order, new Date().toISOString());
    await usePlannerStore.getState().setRouteOrder(tripId, proposal.order);
    setProposal(null);
    setMessage({ tone: 'success', text: 'New order applied. You can restore the previous order.' });
    await loadUndo();
  };

  const restore = async () => {
    if (!saved) return;
    const { routeUndo } = await getRepositories();
    await usePlannerStore.getState().setRouteOrder(tripId, restorableOrder(saved, order));
    await routeUndo.clear(tripId);
    setSaved(null);
    setMessage({ tone: 'success', text: 'Previous order restored.' });
  };

  const result = legs.status === 'ready' ? legs.result : null;
  const totalLegs = Math.max(0, upcoming.length - 1);
  return (
    <Card testID="route-overview">
      <View style={styles.group}>
        <View style={styles.row}>
          <Icon name="map-marker-path" size={20} tone="accent" />
          <AppText variant="bodyStrong" style={styles.flex}>
            Journey
          </AppText>
        </View>
        {upcoming.length < 2 ? (
          <AppText variant="caption" tone="textMuted">
            Add at least two upcoming stops to see road distances and driving times.
          </AppText>
        ) : legs.status === 'loading' ? (
          <AppText variant="caption" tone="textMuted">
            Measuring road distances…
          </AppText>
        ) : result && result.covered > 0 ? (
          <AppText variant="h3" testID="route-total">
            {formatKm(result.totalMeters)} · about {formatDuration(result.totalSeconds)} driving
          </AppText>
        ) : (
          <AppText variant="caption" tone="warning" testID="route-total-unavailable">
            Road distances unavailable{missing.length ? ' — some stops have no location' : ' right now (offline or the routing service is busy)'}.
          </AppText>
        )}
        {result && totalLegs > 0 ? (
          <AppText variant="caption" tone="textMuted" testID="route-coverage">
            {result.covered} of {totalLegs} legs measured by road
            {result.from === 'live' ? ' · live' : result.from === 'stale_cache' ? ` · saved ${legs.status === 'ready' ? (legs.age ?? '') : ''}, may be out of date` : result.from === 'cache' || result.from === 'mixed' ? ` · saved ${legs.status === 'ready' ? (legs.age ?? '') : ''}` : ''}
          </AppText>
        ) : null}
        {missing.length > 0 ? (
          <Notice tone="warning" title={`${missing.length} ${missing.length === 1 ? 'stop has' : 'stops have'} no location`} message={`${missing.map((m) => m.name).join(', ')} — set a location on the place page to measure its legs.`} testID="route-missing" />
        ) : null}
        {upcoming.length > 0 ? (
          <AppText variant="caption" tone="textMuted" testID="route-maps-legs">
            Google Maps: {mapsLegs === 1 ? 'one route for the whole journey' : `${mapsLegs} linked legs (each starts where the last ended)`}.
          </AppText>
        ) : null}
        {message ? <Notice tone={message.tone} title={message.text} testID="route-message" /> : null}
        {proposal ? (
          <View style={styles.proposal} testID="route-proposal">
            <AppText variant="label" tone="textSecondary">
              Suggested order (not applied yet)
            </AppText>
            <AppText variant="body">{proposal.names.map((n, i) => `${i + 1}. ${n}`).join('  ')}</AppText>
            <View style={styles.row}>
              <Button label="Use this order" size="sm" onPress={() => void apply()} testID="route-proposal-apply" />
              <Button label="Keep mine" size="sm" variant="ghost" onPress={() => setProposal(null)} testID="route-proposal-dismiss" />
            </View>
          </View>
        ) : upcoming.length >= 4 ? (
          <Button label="Suggest a shorter order" icon="vector-polyline" size="sm" variant="secondary" onPress={() => void propose()} loading={busy} testID="route-optimise" />
        ) : null}
        {saved ? <Button label="Restore previous order" icon="undo" size="sm" variant="ghost" onPress={() => void restore()} testID="route-restore" /> : null}
        <AppText variant="caption" tone="textMuted">
          {ROUTING_ATTRIBUTION}. Your order is never changed unless you choose to.
        </AppText>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  group: { gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  flex: { flex: 1, minWidth: 0 },
  proposal: { gap: spacing.xs, padding: spacing.sm, borderRadius: radii.md, borderWidth: 1, borderColor: colors.accentBorder },
});
