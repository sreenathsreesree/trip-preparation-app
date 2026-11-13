import { StyleSheet, View } from "react-native";

import { AppText, Card, Icon } from "@/components/ui";
import { formatDate } from "@/lib/dates";
import { spacing } from "@/theme";

import type { GeoPoint } from "../../planner/model";
import {
  describeCode,
  outlookFor,
  WEATHER_ATTRIBUTION,
  type DayOutlook,
} from "../weather";
import { useForecast } from "../useForecast";

const fmt = (v: number | null, unit: string) =>
  v === null ? "—" : `${Math.round(v)}${unit}`;

/** One day's forecast line, or why there is none (never a guess). */
export function OutlookLine({
  outlook,
  label,
  testID,
}: {
  outlook: DayOutlook;
  label: string;
  testID?: string;
}) {
  if (outlook.kind !== "forecast") {
    const text =
      outlook.kind === "past"
        ? "Day has passed"
        : outlook.kind === "beyond_horizon"
          ? `Forecast not available yet (from ${formatDate(outlook.availableFrom)})`
          : "No forecast for this day";
    return (
      <View style={styles.line} testID={testID}>
        <AppText variant="caption" tone="textSecondary" style={styles.flex}>
          {label}
        </AppText>
        <AppText variant="caption" tone="textMuted">
          {text}
        </AppText>
      </View>
    );
  }
  const { day } = outlook;
  const d = describeCode(day.code);
  return (
    <View style={styles.line} testID={testID}>
      <Icon name={d.icon} size={18} tone="info" />
      <AppText variant="caption" tone="textSecondary" style={styles.flex}>
        {label} · {d.label}
        {outlook.certainty === "uncertain"
          ? " (uncertain, more than a week ahead)"
          : ""}
      </AppText>
      <AppText variant="captionStrong">
        {fmt(day.maxC, "°")}/{fmt(day.minC, "°")}
      </AppText>
      <AppText variant="caption" tone="info">
        {day.rainChance === null ? "" : ` ${day.rainChance}%☂`}
      </AppText>
    </View>
  );
}

/** Weather for one destination: now, today, and its planned day when set. */
export function WeatherCard({
  location,
  name,
  plannedDate,
}: {
  location: GeoPoint | null | undefined;
  name: string;
  plannedDate?: string | null;
}) {
  const state = useForecast(location);
  if (state.status === "no_location") {
    return (
      <Card testID="weather-no-location">
        <AppText variant="caption" tone="textMuted">
          Weather needs {name}’s location. Set it in the Location section to see
          the forecast.
        </AppText>
      </Card>
    );
  }
  if (state.status === "loading") {
    return (
      <Card testID="weather-loading">
        <AppText variant="caption" tone="textMuted">
          Loading the forecast…
        </AppText>
      </Card>
    );
  }
  if (state.status === "error") {
    return (
      <Card testID="weather-error">
        <AppText variant="caption" tone="textMuted">
          {state.message}
        </AppText>
      </Card>
    );
  }
  const { forecast } = state.result;
  const { stale, age } = state;
  const today =
    forecast.daily[0]?.date ?? new Date().toISOString().slice(0, 10);
  const now = forecast.current;
  const code = describeCode(now?.code ?? forecast.daily[0]?.code ?? null);
  const todayOutlook = outlookFor(forecast, today, today);
  return (
    <Card testID="weather-card">
      <View style={styles.group}>
        <View style={styles.line}>
          <Icon name={code.icon} size={32} tone="info" />
          <View style={styles.flex}>
            <AppText variant="h3" testID="weather-now">
              {now ? fmt(now.temperatureC, "°C") : "—"} · {code.label}
            </AppText>
            <AppText variant="caption" tone="textSecondary">
              {todayOutlook.kind === "forecast"
                ? `Today ${fmt(todayOutlook.day.maxC, "°")} / ${fmt(todayOutlook.day.minC, "°")} · Rain ${fmt(todayOutlook.day.rainChance, "%")}`
                : "No forecast for today"}
            </AppText>
            <AppText variant="caption" tone="textSecondary">
              Humidity {fmt(now?.humidity ?? null, "%")} · Wind{" "}
              {fmt(now?.windKmh ?? null, " km/h")}
            </AppText>
          </View>
        </View>
        {plannedDate ? (
          <OutlookLine
            outlook={outlookFor(forecast, plannedDate, today)}
            label={`Your visit, ${formatDate(plannedDate)}`}
            testID="weather-planned"
          />
        ) : null}
        <AppText
          variant="caption"
          tone={stale ? "warning" : "textMuted"}
          testID={stale ? "weather-stale" : "weather-updated"}
        >
          {stale
            ? `Saved forecast from ${age} — may be out of date.`
            : `Updated ${age}.`}{" "}
          Severe-weather warnings aren’t provided by this source; check the
          local weather service. {WEATHER_ATTRIBUTION}.
        </AppText>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  group: { gap: spacing.sm },
  line: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  flex: { flex: 1, minWidth: 0 },
});
