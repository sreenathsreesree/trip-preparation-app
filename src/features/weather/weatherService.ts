import type { GeoPoint } from "../planner/model";
import {
  cachedFetch,
  type RemoteCacheRepository,
} from "../remote/remoteCacheRepository";
import {
  forecastUrl,
  parseForecast,
  WEATHER_MAX_AGE_MS,
  WEATHER_SOURCE,
  weatherCacheKey,
  type Forecast,
} from "./weather";

export class WeatherError extends Error {
  constructor(
    readonly kind: "offline" | "unavailable" | "busy",
    message: string,
  ) {
    super(message);
    this.name = "WeatherError";
  }
}

export interface WeatherResult {
  forecast: Forecast;
  fetchedAt: string;
  /** live: just fetched; cache: recent enough; stale_cache: offline or failed, older data shown. */
  from: "live" | "cache" | "stale_cache";
}

/**
 * Forecast for a destination, cache first: a forecast younger than 3 hours is
 * reused (Open-Meteo's free tier asks for fewer than 10 000 calls a day; a
 * trip needs a handful), else fetched and stored; offline, the last stored one
 * is returned and marked stale. Only coordinates are sent.
 */
export async function getForecast(
  location: GeoPoint,
  deps: { cache: RemoteCacheRepository; fetchImpl?: typeof fetch; now?: Date },
): Promise<WeatherResult> {
  const fetchImpl =
    deps.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const now = deps.now ?? new Date();
  const result = await cachedFetch<Forecast>(
    deps.cache,
    {
      key: weatherCacheKey(location.latitude, location.longitude),
      kind: "weather",
      source: WEATHER_SOURCE,
      maxAgeMs: WEATHER_MAX_AGE_MS,
      now,
    },
    async () => {
      let response: Response;
      try {
        response = await fetchImpl(
          forecastUrl(location.latitude, location.longitude),
          { headers: { Accept: "application/json" } },
        );
      } catch {
        throw new WeatherError(
          "offline",
          "No connection, and no saved forecast for this place yet.",
        );
      }
      if (response.status === 429)
        throw new WeatherError(
          "busy",
          "The weather service is busy. Try again later.",
        );
      if (!response.ok)
        throw new WeatherError(
          "unavailable",
          "The weather service could not give a forecast for this place.",
        );
      const forecast = parseForecast(await response.json());
      if (forecast.daily.length === 0 && !forecast.current)
        throw new WeatherError(
          "unavailable",
          "No forecast is available for this place.",
        );
      return forecast;
    },
  );
  return {
    forecast: result.payload,
    fetchedAt: result.fetchedAt,
    from: result.from,
  };
}
