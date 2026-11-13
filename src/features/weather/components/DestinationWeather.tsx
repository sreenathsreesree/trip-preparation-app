import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";

import { AppText, Button, TextField } from "@/components/ui";
import { getRepositories } from "@/db/repositories";
import { toErrorMessage } from "@/lib/errors";
import { spacing } from "@/theme";

import { contextLocation } from "../../places/discovery";
import { dateOfDay } from "../../planner/dayPlanRepository";
import type { DetailContext } from "../../planner/detail/shared";
import { WeatherCard } from "./WeatherCard";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Destination weather (its own location, or the nearest place above it with one) and its planned day. */
export function DestinationWeather({
  ctx,
  tripStart = null,
}: {
  ctx: DetailContext;
  tripStart?: string | null;
}) {
  const located = contextLocation(ctx.plan.nodes, ctx.node.id);
  const [planned, setPlanned] = useState<{
    date: string | null;
    dayNumber: number | null;
  } | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void getRepositories()
      .then(({ dayPlan }) => dayPlan.list(ctx.tripId))
      .then((days) => {
        const d = days.find((x) => x.nodeId === ctx.node.id);
        if (live)
          setPlanned(
            d
              ? { date: d.date, dayNumber: d.dayNumber }
              : { date: null, dayNumber: null },
          );
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [ctx.tripId, ctx.node.id]);
  const plannedDate =
    planned?.date ??
    (planned?.dayNumber && tripStart
      ? dateOfDay(tripStart, planned.dayNumber)
      : null);
  const value = draft ?? plannedDate ?? "";

  const save = async () => {
    const date = value.trim();
    if (date && !DATE.test(date)) {
      setError("Use the format YYYY-MM-DD.");
      return;
    }
    setError(null);
    try {
      const { dayPlan } = await getRepositories();
      await dayPlan.set(ctx.tripId, ctx.node.id, { date: date || null });
      setPlanned({ date: date || null, dayNumber: null });
      setDraft(null);
    } catch (e) {
      setError(toErrorMessage(e, "Could not save the day."));
    }
  };

  return (
    <View style={styles.group} testID="detail-weather">
      <AppText variant="label" tone="textSecondary">
        Weather
      </AppText>
      <WeatherCard
        location={located?.location}
        name={ctx.node.name}
        plannedDate={plannedDate}
      />
      <View style={styles.row}>
        <View style={styles.flex}>
          <TextField
            label="Planned day (YYYY-MM-DD)"
            value={value}
            onChangeText={setDraft}
            placeholder="e.g. 2026-11-21"
            error={error ?? undefined}
            testID="detail-planned-day"
          />
        </View>
        {draft !== null ? (
          <Button
            label="Save"
            size="sm"
            onPress={() => void save()}
            testID="detail-planned-day-save"
          />
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: spacing.md },
  row: { flexDirection: "row", alignItems: "flex-end", gap: spacing.sm },
  flex: { flex: 1 },
});
