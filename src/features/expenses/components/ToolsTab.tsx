import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText, Button, Collapsible, Notice, OptionTile, SegmentedControl, TextField, ToggleRow } from '@/components/ui';
import { confirmAction } from '@/lib/confirm';
import { toErrorMessage } from '@/lib/errors';
import { successFeedback } from '@/lib/haptics';
import { spacing } from '@/theme';

import type { PlanNode } from '../../planner/model';
import { useTripPlan } from '../../planner/plannerStore';
import { useRouteLegs } from '../../route/RouteOverview';
import { formatDuration, formatKm, ROUTING_ATTRIBUTION } from '../../route/routing';
import type { Workspace } from '../expenseRepository';
import { useExpenseStore } from '../expenseStore';
import { routeDistanceKm } from '../ledger';
import { formatMoney, minorToInput, MoneyError, parseAmount, parsePercent, SPLIT_LABELS, SPLIT_METHODS, splitAmount, type Share, type SplitInput, type SplitMethod } from '../money';
import { placeOptions } from '../overview';
import {
  accommodationEstimate,
  ESTIMATE_LINES,
  estimateAsBudget,
  foodEstimate,
  fuelCostMinor,
  parseDecimal,
  tripEstimate,
  type EstimateKey,
} from '../planning';

/** Amount text → minor units; 0 when empty; null when invalid. */
const money = (text: string, currency: string) => {
  if (!text.trim()) return 0;
  const p = parseAmount(text, currency);
  return p.ok ? p.minor : null;
};
const count = (text: string) => {
  const n = Number(text.trim());
  return Number.isInteger(n) && n >= 1 && n <= 10_000 ? n : null;
};
const attempt = <T,>(fn: () => T): { value: T | null; error: string | null } => {
  try {
    return { value: fn(), error: null };
  } catch (e) {
    return { value: null, error: e instanceof Error ? e.message : 'Check the numbers.' };
  }
};

function Result({ lines, testID }: { lines: [string, string][]; testID: string }) {
  return (
    <View style={styles.result} testID={testID}>
      {lines.map(([label, value]) => (
        <View key={label} style={styles.inline}>
          <AppText variant="body" tone="textSecondary" style={styles.flex}>
            {label}
          </AppText>
          <AppText variant="bodyStrong">{value}</AppText>
        </View>
      ))}
    </View>
  );
}

const EstimateNote = () => (
  <AppText variant="caption" tone="textMuted">
    An estimate only — it is not saved as an expense.
  </AppText>
);

export function ToolsTab({ tripId, ws }: { tripId: string; ws: Workspace }) {
  const currency = ws.currency;
  const canAddGroup = !ws.groupReadOnly;
  const plan = useTripPlan(tripId).plan;
  const active = ws.participants.filter((p) => !p.archived);
  const route = plan ? routeDistanceKm(plan.route.map((s) => plan.nodes.find((n) => n.id === s.nodeId)?.place?.location ?? null)) : null;
  const addExpense = (params: Record<string, string>) => router.push({ pathname: '/calculator/[tripId]/expense', params: { tripId, currency, ...params } });

  /* A. Fuel */
  const [distance, setDistance] = useState('');
  const [unit, setUnit] = useState<'km_per_l' | 'l_per_100km'>('km_per_l');
  const [efficiency, setEfficiency] = useState('');
  const [price, setPrice] = useState('');
  const [roundTrip, setRoundTrip] = useState(false);
  const km = parseDecimal(distance);
  const eff = parseDecimal(efficiency);
  const priceMinor = money(price, currency);
  const fuel =
    km && eff && priceMinor
      ? attempt(() => ({ ...fuelCostMinor(roundTrip ? km * 2 : km, { unit, value: eff }, priceMinor), km: Math.round((roundTrip ? km * 2 : km) * 10) / 10 }))
      : { value: null, error: price.trim() && priceMinor === null ? 'Check the fuel price.' : null };

  /* B. Accommodation */
  const [roomCost, setRoomCost] = useState('');
  const [rooms, setRooms] = useState('1');
  const [nights, setNights] = useState('');
  const roomMinor = money(roomCost, currency);
  const stay = roomMinor && count(rooms) && count(nights) ? attempt(() => accommodationEstimate(roomMinor, count(rooms) as number, count(nights) as number)) : { value: null, error: null };

  /* C. Food */
  const [foodDaily, setFoodDaily] = useState('');
  const [foodPeople, setFoodPeople] = useState(String(Math.max(1, active.length)));
  const [foodDays, setFoodDays] = useState('');
  const foodMinor = money(foodDaily, currency);
  const food = foodMinor && count(foodPeople) && count(foodDays) ? attempt(() => foodEstimate(foodMinor, count(foodPeople) as number, count(foodDays) as number)) : { value: null, error: null };

  /* D. Total estimate */
  const [est, setEst] = useState<Record<EstimateKey, string>>({ fuel: '', stay: '', food: '', tolls: '', activities: '', other: '' });
  const estValues = Object.fromEntries(ESTIMATE_LINES.map((l) => [l.key, money(est[l.key], currency)])) as Record<EstimateKey, number | null>;
  const estInvalid = ESTIMATE_LINES.filter((l) => estValues[l.key] === null).map((l) => l.label);
  const estimate = estInvalid.length === 0 ? attempt(() => tripEstimate(estValues as Record<EstimateKey, number>)) : { value: null, error: `Check: ${estInvalid.join(', ')}.` };
  const fillFromTools = () =>
    setEst((s) => ({
      ...s,
      fuel: fuel.value ? minorToInput(fuel.value.costMinor, currency) : s.fuel,
      stay: stay.value ? minorToInput(stay.value, currency) : s.stay,
      food: food.value ? minorToInput(food.value, currency) : s.food,
    }));
  const [estMessage, setEstMessage] = useState<string | null>(null);
  async function applyAsBudget() {
    if (!estimate.value || estimate.value.totalMinor <= 0) return;
    const ok = await confirmAction({
      title: 'Use this estimate as the planned budget?',
      message: `The ${currency} budget total and category plans are replaced with this estimate. Recorded expenses are not changed.`,
      confirmLabel: 'Use as budget',
    });
    if (!ok) return;
    try {
      const existing = ws.budgets.find((b) => b.currency === currency) ?? null;
      await useExpenseStore.getState().saveBudget(tripId, estimateAsBudget(estimate.value, currency, existing?.dailyLimitMinor ?? null));
      successFeedback();
      setEstMessage('Saved as the planned budget.');
    } catch (e) {
      setEstMessage(toErrorMessage(e, 'Could not save the budget.'));
    }
  }

  /* E. Splitter (existing split logic) */
  const [billTitle, setBillTitle] = useState('');
  const [bill, setBill] = useState('');
  const [method, setMethod] = useState<SplitMethod>('equal');
  const [included, setIncluded] = useState<Set<string>>(new Set(active.map((p) => p.id)));
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const billMinor = money(bill, currency);
  const people = active.filter((p) => included.has(p.id));
  let shares: Share[] | null = null;
  let splitError: string | null = null;
  let splitInputs: SplitInput[] = [];
  if (billMinor && people.length > 0) {
    try {
      splitInputs = people.map((p) => {
        const text = (inputs[p.id] ?? '').trim();
        if (method === 'equal') return { participantId: p.id, value: 0 };
        if (method === 'exact') {
          const v = text ? parseAmount(text, currency) : ({ ok: true, minor: 0 } as const);
          if (!v.ok) throw new MoneyError(`${p.name}: ${v.error}`);
          return { participantId: p.id, value: v.minor };
        }
        if (method === 'percent') {
          const v = text ? parsePercent(text) : 0;
          if (v === null) throw new MoneyError(`${p.name}: use a percentage like 33.33.`);
          return { participantId: p.id, value: v };
        }
        const v = text ? Number(text) : 1;
        if (!Number.isInteger(v) || v < 0) throw new MoneyError(`${p.name}: shares are whole numbers.`);
        return { participantId: p.id, value: v };
      });
      shares = splitAmount(billMinor, method, splitInputs, currency);
    } catch (e) {
      splitError = e instanceof MoneyError ? e.message : 'Check the split.';
    }
  } else if (bill.trim() && billMinor === null) splitError = 'Check the amount.';

  /* F. Distance and travel time */
  const nodes = plan?.nodes ?? [];
  const located = placeOptions(nodes.map((n) => ({ id: n.id, parentId: n.parentId, name: n.name }))).filter((o) => nodes.find((n) => n.id === o.id)?.place?.location);
  const [fromId, setFromId] = useState<string | null>(null);
  const [toId, setToId] = useState<string | null>(null);
  const from = nodes.find((n) => n.id === fromId);
  const to = nodes.find((n) => n.id === toId);
  const pair: PlanNode[] = from && to && from.id !== to.id ? [from, to] : [];
  const legs = useRouteLegs(pair);
  const leg = pair.length === 2 && legs.status === 'ready' ? (legs.result.legs[0] ?? null) : null;

  return (
    <View style={styles.root} testID="calc-tools">
      <Collapsible title="Fuel cost" icon="gas-station-outline" summary={fuel.value ? formatMoney(fuel.value.costMinor, currency) : 'Distance, mileage and fuel price'} initiallyOpen testID="calc-tool-fuel">
        <View style={styles.group}>
          <TextField label="Distance (km, one way)" value={distance} onChangeText={setDistance} keyboardType="decimal-pad" testID="calc-fuel-distance" />
          {route && route.legs > 0 ? (
            <Button label={`Use route: ${route.km} km (straight line)`} icon="map-marker-path" variant="ghost" size="sm" onPress={() => setDistance(String(route.km))} style={styles.left} testID="calc-fuel-route" />
          ) : null}
          <SegmentedControl
            options={[
              { value: 'km_per_l', label: 'km per litre' },
              { value: 'l_per_100km', label: 'L per 100 km' },
            ]}
            value={unit}
            onChange={setUnit}
            accessibilityLabel="Fuel efficiency unit"
          />
          <TextField label={unit === 'km_per_l' ? 'Mileage (km/L)' : 'Consumption (L/100 km)'} value={efficiency} onChangeText={setEfficiency} keyboardType="decimal-pad" testID="calc-fuel-efficiency" />
          <TextField label={`Fuel price per litre (${currency})`} value={price} onChangeText={setPrice} keyboardType="decimal-pad" testID="calc-fuel-price" />
          <ToggleRow label="Round trip" description="Doubles the distance" value={roundTrip} onChange={setRoundTrip} testID="calc-fuel-round" />
          {fuel.value ? (
            <>
              <Result
                testID="calc-fuel-result"
                lines={[
                  ['Distance', `${fuel.value.km} km`],
                  ['Fuel needed', `${fuel.value.litres} L`],
                  ['Fuel cost', formatMoney(fuel.value.costMinor, currency)],
                ]}
              />
              <EstimateNote />
              <Button
                label="Add as an expense"
                icon="plus"
                variant="secondary"
                size="sm"
                onPress={() => addExpense({ title: 'Fuel', amount: minorToInput((fuel.value as { costMinor: number }).costMinor, currency), category: 'fuel', scope: canAddGroup ? 'group' : 'personal' })}
                style={styles.left}
                testID="calc-fuel-add"
              />
            </>
          ) : fuel.error ? (
            <AppText variant="caption" tone="danger">
              {fuel.error}
            </AppText>
          ) : null}
        </View>
      </Collapsible>

      <Collapsible title="Accommodation" icon="bed-outline" summary={stay.value ? formatMoney(stay.value, currency) : 'Rooms × nights'} testID="calc-tool-stay">
        <View style={styles.group}>
          <TextField label={`Cost per room per night (${currency})`} value={roomCost} onChangeText={setRoomCost} keyboardType="decimal-pad" testID="calc-stay-cost" />
          <View style={styles.inline}>
            <View style={styles.flex}>
              <TextField label="Rooms" value={rooms} onChangeText={setRooms} keyboardType="number-pad" maxLength={4} testID="calc-stay-rooms" />
            </View>
            <View style={styles.flex}>
              <TextField label="Nights" value={nights} onChangeText={setNights} keyboardType="number-pad" maxLength={4} testID="calc-stay-nights" />
            </View>
          </View>
          {stay.value ? (
            <>
              <Result testID="calc-stay-result" lines={[['Accommodation estimate', formatMoney(stay.value, currency)]]} />
              <EstimateNote />
            </>
          ) : stay.error ? (
            <AppText variant="caption" tone="danger">
              {stay.error}
            </AppText>
          ) : null}
        </View>
      </Collapsible>

      <Collapsible title="Food budget" icon="silverware-fork-knife" summary={food.value ? formatMoney(food.value, currency) : 'Per person per day'} testID="calc-tool-food">
        <View style={styles.group}>
          <TextField label={`Daily food budget per person (${currency})`} value={foodDaily} onChangeText={setFoodDaily} keyboardType="decimal-pad" testID="calc-food-daily" />
          <View style={styles.inline}>
            <View style={styles.flex}>
              <TextField label="People" value={foodPeople} onChangeText={setFoodPeople} keyboardType="number-pad" maxLength={4} testID="calc-food-people" />
            </View>
            <View style={styles.flex}>
              <TextField label="Days" value={foodDays} onChangeText={setFoodDays} keyboardType="number-pad" maxLength={4} testID="calc-food-days" />
            </View>
          </View>
          {food.value ? (
            <>
              <Result testID="calc-food-result" lines={[['Food estimate', formatMoney(food.value, currency)]]} />
              <EstimateNote />
            </>
          ) : food.error ? (
            <AppText variant="caption" tone="danger">
              {food.error}
            </AppText>
          ) : null}
        </View>
      </Collapsible>

      <Collapsible title="Total trip cost estimate" icon="calculator-variant-outline" summary={estimate.value && estimate.value.totalMinor > 0 ? formatMoney(estimate.value.totalMinor, currency) : 'Combine fuel, stay, food and more'} testID="calc-tool-estimate">
        <View style={styles.group}>
          <Button label="Fill from the calculators above" icon="arrow-down-bold-circle-outline" variant="ghost" size="sm" disabled={!fuel.value && !stay.value && !food.value} onPress={fillFromTools} style={styles.left} testID="calc-est-fill" />
          {ESTIMATE_LINES.map((l) => (
            <TextField key={l.key} label={`${l.label} (${currency})`} value={est[l.key]} onChangeText={(v) => setEst((s) => ({ ...s, [l.key]: v }))} keyboardType="decimal-pad" testID={`calc-est-${l.key}`} />
          ))}
          {estimate.value ? (
            <Result
              testID="calc-est-result"
              lines={[...estimate.value.lines.filter((l) => l.minor > 0).map((l) => [l.label, formatMoney(l.minor, currency)] as [string, string]), ['Estimated total', formatMoney(estimate.value.totalMinor, currency)]]}
            />
          ) : (
            <AppText variant="caption" tone="danger">
              {estimate.error}
            </AppText>
          )}
          <EstimateNote />
          {canAddGroup && estimate.value && estimate.value.totalMinor > 0 ? (
            <Button label="Use as planned budget" icon="target" variant="secondary" size="sm" onPress={() => void applyAsBudget()} style={styles.left} testID="calc-est-budget" />
          ) : null}
          {estMessage ? <Notice tone="info" title={estMessage} testID="calc-est-message" /> : null}
        </View>
      </Collapsible>

      <Collapsible title="Per-person splitter" icon="call-split" summary="Equal, exact, percentage or shares" testID="calc-tool-split">
        <View style={styles.group}>
          <TextField label={`Amount (${currency})`} value={bill} onChangeText={setBill} keyboardType="decimal-pad" testID="calc-pp-total" />
          <View style={styles.chips}>
            {SPLIT_METHODS.map((m) => (
              <OptionTile key={m} layout="chip" label={SPLIT_LABELS[m]} icon="call-split" selected={method === m} onPress={() => setMethod(m)} testID={`calc-pp-method-${m}`} />
            ))}
          </View>
          {active.map((p) => {
            const on = included.has(p.id);
            const share = shares?.find((s) => s.participantId === p.id);
            return (
              <View key={p.id} style={styles.inline} testID={`calc-pp-row-${p.name}`}>
                <View style={styles.flex}>
                  <OptionTile
                    layout="chip"
                    role="button"
                    label={p.name}
                    icon={on ? 'checkbox-marked' : 'checkbox-blank-outline'}
                    selected={on}
                    onPress={() =>
                      setIncluded((s) => {
                        const next = new Set(s);
                        if (next.has(p.id)) next.delete(p.id);
                        else next.add(p.id);
                        return next;
                      })
                    }
                    testID={`calc-pp-include-${p.name}`}
                  />
                </View>
                {on && method !== 'equal' ? (
                  <View style={styles.small}>
                    <TextField
                      label={method === 'exact' ? currency : method === 'percent' ? '%' : 'Shares'}
                      value={inputs[p.id] ?? ''}
                      placeholder={method === 'shares' ? '1' : '0'}
                      onChangeText={(v) => setInputs((s) => ({ ...s, [p.id]: v }))}
                      keyboardType={method === 'shares' ? 'number-pad' : 'decimal-pad'}
                      testID={`calc-pp-input-${p.name}`}
                    />
                  </View>
                ) : null}
                <AppText variant="bodyStrong" style={styles.share} testID={`calc-pp-share-${p.name}`}>
                  {on && share ? formatMoney(share.minor, currency) : '—'}
                </AppText>
              </View>
            );
          })}
          {splitError ? <Notice tone="warning" title={splitError} testID="calc-pp-error" /> : null}
          {shares && canAddGroup ? (
            <>
              <TextField label="What for (optional)" value={billTitle} onChangeText={setBillTitle} maxLength={120} testID="calc-pp-title" />
              <Button
                label="Save as a group expense"
                icon="plus"
                variant="secondary"
                size="sm"
                onPress={() =>
                  addExpense({
                    title: billTitle.trim() || 'Shared bill',
                    amount: minorToInput(billMinor as number, currency),
                    scope: 'group',
                    method,
                    splits: JSON.stringify(Object.fromEntries(people.map((p) => [p.id, inputs[p.id] ?? '']))),
                  })
                }
                style={styles.left}
                testID="calc-pp-add"
              />
              <AppText variant="caption" tone="textMuted">
                Opens the expense form with this split; balances and settlements use it only after you save.
              </AppText>
            </>
          ) : null}
          {!canAddGroup ? (
            <AppText variant="caption" tone="textMuted">
              You can view this shared trip’s group expenses but not add them.
            </AppText>
          ) : null}
        </View>
      </Collapsible>

      <Collapsible title="Distance and travel time" icon="map-marker-distance" summary="Between two of the trip’s places" testID="calc-tool-distance">
        <View style={styles.group}>
          {located.length < 2 ? (
            <AppText variant="caption" tone="textMuted" testID="calc-dist-none">
              Add at least two destinations with a map location in the trip plan to see road distance and driving time.
            </AppText>
          ) : (
            <>
              <AppText variant="label" tone="textSecondary">
                From
              </AppText>
              <View style={styles.chips}>
                {located.map((o) => (
                  <OptionTile key={o.id} layout="chip" label={o.depth ? o.path : o.name} icon="map-marker-outline" selected={fromId === o.id} onPress={() => setFromId(o.id)} testID={`calc-dist-from-${o.name}`} />
                ))}
              </View>
              <AppText variant="label" tone="textSecondary">
                To
              </AppText>
              <View style={styles.chips}>
                {located.map((o) => (
                  <OptionTile key={o.id} layout="chip" label={o.depth ? o.path : o.name} icon="flag-checkered" selected={toId === o.id} onPress={() => setToId(o.id)} testID={`calc-dist-to-${o.name}`} />
                ))}
              </View>
              {pair.length === 2 ? (
                legs.status === 'loading' ? (
                  <AppText variant="caption" tone="textMuted">
                    Looking up the road route…
                  </AppText>
                ) : leg && leg.meters !== null && leg.seconds !== null ? (
                  <>
                    <Result
                      testID="calc-dist-result"
                      lines={[
                        ['Road distance', formatKm(leg.meters)],
                        ['Driving time', formatDuration(leg.seconds)],
                      ]}
                    />
                    <Button label="Use for fuel cost" icon="gas-station-outline" variant="ghost" size="sm" onPress={() => setDistance(String(Math.round(((leg.meters as number) / 1000) * 10) / 10))} style={styles.left} testID="calc-dist-fuel" />
                    <AppText variant="caption" tone="textMuted">
                      {ROUTING_ATTRIBUTION}
                    </AppText>
                  </>
                ) : (
                  <Notice
                    tone="info"
                    title="Road route unavailable"
                    message={
                      leg?.reason === 'no_route'
                        ? 'No road route was found between these places.'
                        : 'The road route could not be fetched (offline or the service is busy). No distance or time is shown rather than a guess.'
                    }
                    testID="calc-dist-unavailable"
                  />
                )
              ) : fromId && toId && fromId === toId ? (
                <AppText variant="caption" tone="textMuted">
                  Choose two different places.
                </AppText>
              ) : null}
            </>
          )}
        </View>
      </Collapsible>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: spacing.md,
  },
  group: {
    gap: spacing.md,
  },
  inline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  flex: {
    flex: 1,
  },
  small: {
    width: 96,
  },
  share: {
    minWidth: 80,
    textAlign: 'right',
  },
  left: {
    alignSelf: 'flex-start',
  },
  result: {
    gap: spacing.xs,
  },
});
