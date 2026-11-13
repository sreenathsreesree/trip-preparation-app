import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";

import { AppText, Button, Card, Icon } from "@/components/ui";
import { getRepositories } from "@/db/repositories";
import { formatDate } from "@/lib/dates";
import { toErrorMessage } from "@/lib/errors";
import { spacing } from "@/theme";

import { usePackingStore } from "../../packing/packingStore";
import { dateOfDay, type PlannedDay } from "../../planner/dayPlanRepository";
import type { PlanNode } from "../../planner/model";
import { usePlannerStore, useTripPlan } from "../../planner/plannerStore";
import type { TripSummary } from "../../trips/model";
import {
  outlookFor,
  packingHints,
  WEATHER_ATTRIBUTION,
  type DailyForecast,
  type PackingHint,
} from "../weather";
import { useForecast } from "../useForecast";
import { OutlookLine } from "./WeatherCard";

interface Stop {
  node: PlanNode;
  date: string;
  label: string;
}

/** One destination-day row; reports its forecast day upwards for packing ideas. */
function StopWeather({
  stop,
  onDay,
}: {
  stop: Stop;
  onDay: (key: string, day: DailyForecast | null) => void;
}) {
  const state = useForecast(stop.node.place?.location);
  const outlook =
    state.status === "ready"
      ? outlookFor(
          state.result.forecast,
          stop.date,
          state.result.forecast.daily[0]?.date ?? stop.date,
        )
      : null;
  const key = `${stop.node.id}|${stop.date}`;
  const day = outlook?.kind === "forecast" ? outlook.day : null;
  useEffect(() => onDay(key, day), [key, day, onDay]);
  if (state.status === "no_location") {
    return (
      <AppText variant="caption" tone="textMuted">
        {stop.label} · set {stop.node.name}’s location for weather
      </AppText>
    );
  }
  if (state.status !== "ready" || !outlook) {
    return (
      <AppText variant="caption" tone="textMuted">
        {stop.label} · {state.status === "error" ? state.message : "Loading…"}
      </AppText>
    );
  }
  return (
    <OutlookLine
      outlook={outlook}
      label={stop.label}
      testID={`trip-weather-${stop.node.name}`}
    />
  );
}

/**
 * Weather along the trip: each main destination on its planned day (from the
 * day plan) or on the first day of the trip, with packing ideas from those
 * forecasts. Ideas are added to the packing list only when the user taps Add.
 */
export function TripWeatherCard({ trip }: { trip: TripSummary }) {
  const { plan } = useTripPlan(trip.id);
  const [days, setDays] = useState<PlannedDay[]>([]);
  const [forecastDays, setForecastDays] = useState<
    Record<string, DailyForecast | null>
  >({});
  const [added, setAdded] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  useFocusEffect(
    useCallback(() => {
      void usePlannerStore.getState().load(trip.id);
      void getRepositories()
        .then(({ dayPlan }) => dayPlan.list(trip.id))
        .then(setDays)
        .catch(() => undefined);
    }, [trip.id]),
  );

  const stops = useMemo<Stop[]>(() => {
    const nodes = plan?.nodes ?? [];
    const byNode = new Map(days.map((d) => [d.nodeId, d]));
    const planned = days
      .map((d) => {
        const node = nodes.find((n) => n.id === d.nodeId);
        const date =
          d.date ??
          (d.dayNumber ? dateOfDay(trip.startDate, d.dayNumber) : null);
        return node && date
          ? {
              node,
              date,
              label: `${d.dayNumber ? `Day ${d.dayNumber} · ` : ""}${formatDate(date)} · ${node.name}`,
            }
          : null;
      })
      .filter((s): s is Stop => s !== null)
      .sort((a, b) => a.date.localeCompare(b.date));
    const unplanned = nodes
      .filter((n) => n.parentId === null && !byNode.has(n.id))
      .map((node) => ({
        node,
        date: trip.startDate,
        label: `${formatDate(trip.startDate)} · ${node.name}`,
      }));
    return [...planned, ...unplanned].slice(0, 10);
  }, [plan?.nodes, days, trip.startDate]);

  const onDay = useCallback((key: string, day: DailyForecast | null) => {
    setForecastDays((cur) => (cur[key] === day ? cur : { ...cur, [key]: day }));
  }, []);
  const hints = useMemo(
    () =>
      packingHints(
        Object.values(forecastDays).filter(
          (d): d is DailyForecast => d !== null,
        ),
      ),
    [forecastDays],
  );

  const add = async (hint: PackingHint) => {
    setError(null);
    try {
      await usePackingStore
        .getState()
        .addEntry(trip.id, {
          name: hint.item,
          notes: `Weather: ${hint.reason}`,
          source: "manual",
        });
      setAdded((s) => new Set([...s, hint.key]));
    } catch (e) {
      setError(toErrorMessage(e, "Could not add it to your packing list."));
    }
  };

  if (stops.length === 0) return null;
  return (
    <Card testID="trip-weather">
      <View style={styles.group}>
        <View style={styles.row}>
          <Icon name="weather-partly-cloudy" size={20} tone="info" />
          <AppText variant="bodyStrong">Weather on your trip</AppText>
        </View>
        {stops.map((s) => (
          <StopWeather key={`${s.node.id}|${s.date}`} stop={s} onDay={onDay} />
        ))}
        {hints.length > 0 ? (
          <View style={styles.group} testID="weather-packing-hints">
            <AppText variant="label" tone="textSecondary">
              Pack for the weather
            </AppText>
            {hints.map((h) => (
              <View key={h.key} style={styles.row}>
                <Icon name={h.icon} size={18} tone="accent" />
                <View style={styles.flex}>
                  <AppText variant="body">{h.item}</AppText>
                  <AppText variant="caption" tone="textMuted">
                    {h.reason}
                  </AppText>
                </View>
                {added.has(h.key) ? (
                  <AppText
                    variant="caption"
                    tone="accent"
                    testID={`weather-hint-added-${h.key}`}
                  >
                    Added
                  </AppText>
                ) : (
                  <Button
                    label="Add"
                    size="sm"
                    variant="ghost"
                    onPress={() => void add(h)}
                    testID={`weather-hint-add-${h.key}`}
                  />
                )}
              </View>
            ))}
            <AppText variant="caption" tone="textMuted">
              Suggestions only — nothing is added to your packing list unless
              you tap Add.
            </AppText>
          </View>
        ) : null}
        {error ? (
          <AppText variant="caption" tone="danger">
            {error}
          </AppText>
        ) : null}
        <AppText variant="caption" tone="textMuted">
          {WEATHER_ATTRIBUTION}. Forecasts more than a week ahead are uncertain;
          beyond 16 days there is no forecast yet.
        </AppText>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  group: { gap: spacing.sm },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  flex: { flex: 1, minWidth: 0 },
});
