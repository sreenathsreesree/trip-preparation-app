import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText, Button, Card, SegmentedControl, TextField } from '@/components/ui';
import { spacing } from '@/theme';

import { useTripPlan } from '../../planner/plannerStore';
import { routeDistanceKm } from '../ledger';
import { formatMoney, minorToInput, parseAmount } from '../money';
import { fuelCostMinor, parseDecimal, perPerson, travelCost } from '../planning';

const money = (text: string, currency: string) => {
  if (!text.trim()) return 0;
  const p = parseAmount(text, currency);
  return p.ok ? p.minor : null;
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

export function ToolsTab({ tripId, currency, people, canAddGroup }: { tripId: string; currency: string; people: number; canAddGroup: boolean }) {
  const plan = useTripPlan(tripId).plan;
  const route = plan ? routeDistanceKm(plan.route.map((s) => plan.nodes.find((n) => n.id === s.nodeId)?.place?.location ?? null)) : null;

  const [distance, setDistance] = useState('');
  const [unit, setUnit] = useState<'km_per_l' | 'l_per_100km'>('km_per_l');
  const [efficiency, setEfficiency] = useState('');
  const [price, setPrice] = useState('');
  const [total, setTotal] = useState('');
  const [split, setSplit] = useState(String(Math.max(1, people)));
  const [tolls, setTolls] = useState('');
  const [parking, setParking] = useState('');
  const [other, setOther] = useState('');

  const km = parseDecimal(distance);
  const eff = parseDecimal(efficiency);
  const priceMinor = money(price, currency);
  let fuel: { litres: number; costMinor: number } | null = null;
  let fuelError: string | null = null;
  if (km && eff && priceMinor) {
    try {
      fuel = fuelCostMinor(km, { unit, value: eff }, priceMinor);
    } catch (e) {
      fuelError = e instanceof Error ? e.message : 'Check the numbers.';
    }
  } else if (price.trim() && priceMinor === null) fuelError = 'Check the fuel price.';

  const count = Number(split);
  const validCount = Number.isInteger(count) && count >= 1 && count <= 100;
  const totalMinor = money(total, currency);
  const each = totalMinor && validCount ? perPerson(totalMinor, count) : null;

  const extras = [tolls, parking, other].map((t) => money(t, currency));
  const trip = fuel && validCount && extras.every((x) => x !== null)
    ? travelCost({ fuelMinor: fuel.costMinor, tollsMinor: extras[0] as number, parkingMinor: extras[1] as number, otherMinor: extras[2] as number, people: count, distanceKm: km }, currency)
    : null;

  return (
    <View style={styles.root} testID="calc-tools">
      <Card>
        <View style={styles.group}>
          <AppText variant="title">Fuel cost</AppText>
          <TextField label="Distance (km)" value={distance} onChangeText={setDistance} keyboardType="decimal-pad" testID="calc-fuel-distance" />
          {route && route.legs > 0 ? (
            <Button
              label={`Use route: ${route.km} km (straight line)`}
              icon="map-marker-path"
              variant="ghost"
              size="sm"
              onPress={() => setDistance(String(route.km))}
              style={styles.left}
              testID="calc-fuel-route"
            />
          ) : null}
          {route && route.legs > 0 ? (
            <AppText variant="caption" tone="textMuted">
              Straight lines between route stops{route.missing ? ` (${route.missing} leg(s) without a location left out)` : ''}; roads are longer.
            </AppText>
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
          {fuel ? (
            <>
              <Result
                testID="calc-fuel-result"
                lines={[
                  ['Fuel needed', `${fuel.litres} L`],
                  ['Fuel cost', formatMoney(fuel.costMinor, currency)],
                ]}
              />
              <Button
                label="Add as an expense"
                icon="plus"
                variant="secondary"
                size="sm"
                onPress={() =>
                  router.push({
                    pathname: '/calculator/[tripId]/expense',
                    params: { tripId, title: 'Fuel', amount: minorToInput(fuel.costMinor, currency), currency, category: 'fuel', scope: canAddGroup ? 'group' : 'personal' },
                  })
                }
                style={styles.left}
                testID="calc-fuel-add"
              />
            </>
          ) : fuelError ? (
            <AppText variant="caption" tone="danger">
              {fuelError}
            </AppText>
          ) : null}
        </View>
      </Card>

      <Card>
        <View style={styles.group}>
          <AppText variant="title">Split a bill</AppText>
          <TextField label={`Total (${currency})`} value={total} onChangeText={setTotal} keyboardType="decimal-pad" testID="calc-pp-total" />
          <TextField label="People" value={split} onChangeText={setSplit} keyboardType="number-pad" maxLength={3} testID="calc-pp-people" />
          {each ? (
            <Result
              testID="calc-pp-result"
              lines={[
                ['Each pays', formatMoney(each.eachMinor, currency)],
                ...(each.extra > 0 ? ([[`${each.extra} ${each.extra === 1 ? 'person pays' : 'people pay'} one more`, formatMoney(each.eachMinor + 1, currency)]] as [string, string][]) : []),
              ]}
            />
          ) : null}
        </View>
      </Card>

      <Card>
        <View style={styles.group}>
          <AppText variant="title">Road trip cost</AppText>
          <AppText variant="caption" tone="textMuted">
            Uses the fuel cost above and the number of people.
          </AppText>
          <TextField label="Tolls" value={tolls} onChangeText={setTolls} keyboardType="decimal-pad" testID="calc-trip-tolls" />
          <TextField label="Parking" value={parking} onChangeText={setParking} keyboardType="decimal-pad" />
          <TextField label="Other (driver, permits…)" value={other} onChangeText={setOther} keyboardType="decimal-pad" />
          {trip ? (
            <Result
              testID="calc-trip-result"
              lines={[
                ['Total', formatMoney(trip.totalMinor, currency)],
                ['Per person', formatMoney(trip.eachMinor, currency)],
                ...(trip.perKmMinor !== null ? ([['Per km', formatMoney(trip.perKmMinor, currency)]] as [string, string][]) : []),
              ]}
            />
          ) : (
            <AppText variant="caption" tone="textMuted">
              Fill in the fuel cost first.
            </AppText>
          )}
        </View>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: spacing.lg,
  },
  group: {
    gap: spacing.md,
  },
  inline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  flex: {
    flex: 1,
  },
  left: {
    alignSelf: 'flex-start',
  },
  result: {
    gap: spacing.xs,
  },
});
