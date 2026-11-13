import { useEffect, useState } from "react";

import { getRepositories } from "@/db/repositories";

import type { GeoPoint } from "../planner/model";
import { timeAgo } from "../remote/timeAgo";
import { WEATHER_STALE_MS } from "./weather";
import { getForecast, type WeatherResult } from "./weatherService";

export type ForecastState =
  | { status: "no_location" }
  | { status: "loading" }
  | { status: "ready"; result: WeatherResult; stale: boolean; age: string }
  | { status: "error"; message: string };

/** Loads (cache first) the forecast for a point, in the signed-in account's own database. */
export function useForecast(
  location: GeoPoint | null | undefined,
): ForecastState {
  const lat = location?.latitude;
  const lon = location?.longitude;
  const key = lat === undefined || lon === undefined ? null : `${lat},${lon}`;
  const [state, setState] = useState<{
    key: string;
    value: ForecastState;
  } | null>(null);
  useEffect(() => {
    if (lat === undefined || lon === undefined || key === null) return;
    let live = true;
    void getRepositories()
      .then(({ remoteCache }) =>
        getForecast({ latitude: lat, longitude: lon }, { cache: remoteCache }),
      )
      .then((result) => {
        if (!live) return;
        const now = new Date();
        const stale =
          result.from === "stale_cache" ||
          now.getTime() - Date.parse(result.fetchedAt) > WEATHER_STALE_MS;
        setState({
          key,
          value: {
            status: "ready",
            result,
            stale,
            age: timeAgo(result.fetchedAt, now),
          },
        });
      })
      .catch(
        (e: unknown) =>
          live &&
          setState({
            key,
            value: {
              status: "error",
              message:
                e instanceof Error ? e.message : "Weather is unavailable.",
            },
          }),
      );
    return () => {
      live = false;
    };
  }, [lat, lon, key]);
  if (key === null) return { status: "no_location" };
  return state?.key === key ? state.value : { status: "loading" };
}
