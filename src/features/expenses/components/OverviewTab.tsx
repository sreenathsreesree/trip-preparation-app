import { StyleSheet, View } from 'react-native';

import { AppText, Card, EmptyState, ProgressBar } from '@/components/ui';
import { colors, spacing } from '@/theme';

import { useTripPlan } from '../../planner/plannerStore';
import type { Workspace } from '../expenseRepository';
import { formatMoney } from '../money';
import { financialOverview, UNASSIGNED_LABEL, type PlaceTotal } from '../overview';
import { categoryMeta } from '../planning';

function Line({ label, value, strong, tone, testID }: { label: string; value: string; strong?: boolean; tone?: 'danger' | 'accent'; testID?: string }) {
  return (
    <View style={styles.line} testID={testID}>
      <AppText variant="body" tone="textSecondary" style={styles.flex} numberOfLines={2}>
        {label}
      </AppText>
      <AppText variant={strong ? 'bodyStrong' : 'body'} tone={tone}>
        {value}
      </AppText>
    </View>
  );
}

function PlaceRows({ place, currency, depth }: { place: PlaceTotal; currency: string; depth: number }) {
  return (
    <>
      <View style={[styles.line, { paddingLeft: depth * spacing.lg }]} testID={`calc-ov-place-${place.name}`}>
        <AppText variant={depth === 0 ? 'bodyStrong' : 'body'} style={styles.flex} numberOfLines={1}>
          {depth > 0 ? '› ' : ''}
          {place.name}
        </AppText>
        <AppText variant={depth === 0 ? 'bodyStrong' : 'body'}>{formatMoney(place.totalMinor, currency)}</AppText>
      </View>
      {place.children.length > 0 && place.ownMinor > 0 ? (
        <View style={[styles.line, { paddingLeft: (depth + 1) * spacing.lg }]}>
          <AppText variant="caption" tone="textMuted" style={styles.flex}>
            At {place.name} itself
          </AppText>
          <AppText variant="caption" tone="textMuted">
            {formatMoney(place.ownMinor, currency)}
          </AppText>
        </View>
      ) : null}
      {place.children.map((c) => (
        <PlaceRows key={c.nodeId} place={c} currency={currency} depth={depth + 1} />
      ))}
    </>
  );
}

/** Budget vs recorded spending, by destination, category, scope and person. Estimates never appear here. */
export function OverviewTab({ tripId, ws }: { tripId: string; ws: Workspace }) {
  const nodes = useTripPlan(tripId).plan?.nodes ?? [];
  const overview = financialOverview(
    ws,
    nodes.map((n) => ({ id: n.id, parentId: n.parentId, name: n.name })),
  );
  const isShared = ws.participants.some((p) => p.userId);

  if (overview.length === 0) {
    return <EmptyState icon="chart-donut" title="Nothing recorded yet" message="Add expenses or set a budget to see the trip’s money at a glance." testID="calc-ov-empty" />;
  }

  return (
    <View style={styles.root} testID="calc-overview">
      {overview.map((o) => {
        const pct = o.plannedMinor && o.plannedMinor > 0 ? Math.min(1, o.actualMinor / o.plannedMinor) : null;
        return (
          <View key={o.currency} style={styles.root} testID={`calc-ov-${o.currency}`}>
            <Card>
              <View style={styles.group}>
                <AppText variant="label" tone="textMuted">
                  {o.currency} · Budget and actual spending
                </AppText>
                <Line label="Planned budget" value={o.plannedMinor === null ? 'Not set' : formatMoney(o.plannedMinor, o.currency)} testID="calc-ov-planned" />
                <Line label="Actual (recorded expenses)" value={formatMoney(o.actualMinor, o.currency)} strong testID="calc-ov-actual" />
                {pct !== null ? <ProgressBar value={pct} color={o.plannedMinor !== null && o.actualMinor > o.plannedMinor ? colors.danger : colors.accent} accessibilityLabel="Budget used" /> : null}
                {o.remainingGroupMinor !== null ? (
                  <Line
                    label="Remaining after group spending"
                    value={formatMoney(o.remainingGroupMinor, o.currency)}
                    tone={o.remainingGroupMinor < 0 ? 'danger' : 'accent'}
                    testID="calc-ov-remaining"
                  />
                ) : null}
                {o.remainingMineMinor !== null && o.personalMinor > 0 ? (
                  <Line label="Remaining after my spending" value={formatMoney(o.remainingMineMinor, o.currency)} tone={o.remainingMineMinor < 0 ? 'danger' : undefined} />
                ) : null}
                <AppText variant="caption" tone="textMuted">
                  Only saved expenses count as actual spending. Estimates from Travel tools are never added here.
                </AppText>
              </View>
            </Card>

            <Card>
              <View style={styles.group}>
                <AppText variant="title">By destination</AppText>
                {o.places.map((p) => (
                  <PlaceRows key={p.nodeId} place={p} currency={o.currency} depth={0} />
                ))}
                {o.unassignedCount > 0 ? <Line label={UNASSIGNED_LABEL} value={formatMoney(o.unassignedMinor, o.currency)} testID="calc-ov-unassigned" /> : null}
                {o.places.length === 0 && o.unassignedCount === 0 ? (
                  <AppText variant="caption" tone="textMuted">
                    No expenses in {o.currency} yet.
                  </AppText>
                ) : null}
              </View>
            </Card>

            <Card>
              <View style={styles.group}>
                <AppText variant="title">By category</AppText>
                {o.categories.map((c) => (
                  <Line key={c.category} label={categoryMeta(c.category, ws.categories).label} value={formatMoney(c.minor, o.currency)} testID={`calc-ov-cat-${c.category}`} />
                ))}
                {o.categories.length === 0 ? (
                  <AppText variant="caption" tone="textMuted">
                    No expenses in {o.currency} yet.
                  </AppText>
                ) : null}
              </View>
            </Card>

            <Card>
              <View style={styles.group}>
                <AppText variant="title">Group and personal</AppText>
                <Line label="Group (shared) expenses" value={formatMoney(o.groupMinor, o.currency)} testID="calc-ov-group" />
                <Line label="My personal expenses (private)" value={formatMoney(o.personalMinor, o.currency)} testID="calc-ov-personal" />
                <Line label="My spending (my shares + personal)" value={formatMoney(o.myMinor, o.currency)} strong testID="calc-ov-mine" />
                {isShared ? (
                  <AppText variant="caption" tone="textMuted">
                    Personal expenses stay on your device and are never shown to other members.
                  </AppText>
                ) : null}
              </View>
            </Card>

            {o.people.length > 0 ? (
              <Card>
                <View style={styles.group}>
                  <AppText variant="title">Per person (group expenses)</AppText>
                  {o.people.map((p) => (
                    <View key={p.participantId} style={styles.person} testID={`calc-ov-person-${p.name}`}>
                      <AppText variant="bodyStrong" numberOfLines={1}>
                        {p.name}
                      </AppText>
                      <AppText variant="caption" tone="textSecondary">
                        Paid {formatMoney(p.paidMinor, o.currency)} · Share {formatMoney(p.shareMinor, o.currency)}
                      </AppText>
                    </View>
                  ))}
                </View>
              </Card>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: spacing.md,
  },
  group: {
    gap: spacing.sm,
  },
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 28,
  },
  flex: {
    flex: 1,
  },
  person: {
    gap: spacing.xxs,
    paddingVertical: spacing.xxs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
});
