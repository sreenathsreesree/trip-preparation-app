import type { IconName } from "@/theme/icons";

/**
 * Weather from Open-Meteo (open-meteo.com): free, no key, no billing; data
 * under CC BY 4.0 (credited in the UI). Forecasts reach 16 days; beyond about
 * 7 days they are marked uncertain, beyond 16 they are not available. Nothing
 * is ever filled in when the provider has no value. Open-Meteo has no
 * official severe-weather warnings, and the UI says so.
 */
export const WEATHER_SOURCE = "Open-Meteo";
export const WEATHER_ATTRIBUTION = "Weather data by Open-Meteo.com (CC BY 4.0)";
export const FORECAST_DAYS = 16;
export const RELIABLE_DAYS = 7;
export const OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast";

export interface DailyForecast {
  date: string;
  code: number | null;
  maxC: number | null;
  minC: number | null;
  rainChance: number | null;
  windMaxKmh: number | null;
  uvMax: number | null;
}

export interface Forecast {
  latitude: number;
  longitude: number;
  timezone: string | null;
  current: {
    temperatureC: number | null;
    humidity: number | null;
    windKmh: number | null;
    code: number | null;
    time: string | null;
  } | null;
  daily: DailyForecast[];
}

export function forecastUrl(lat: number, lon: number): string {
  const params = new URLSearchParams({
    latitude: lat.toFixed(3),
    longitude: lon.toFixed(3),
    current: "temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m",
    daily:
      "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max,uv_index_max",
    timezone: "auto",
    forecast_days: String(FORECAST_DAYS),
  });
  return `${OPEN_METEO_URL}?${params.toString()}`;
}

const num = (v: unknown) =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

/** Parses an Open-Meteo response; missing values stay null (never invented). */
export function parseForecast(body: unknown): Forecast {
  const b = (body ?? {}) as Record<string, unknown>;
  const daily = (b.daily ?? {}) as Record<string, unknown[]>;
  const dates = Array.isArray(daily.time) ? (daily.time as unknown[]) : [];
  const col = (name: string, i: number) =>
    num(Array.isArray(daily[name]) ? daily[name][i] : null);
  const c = b.current as Record<string, unknown> | undefined;
  return {
    latitude: num(b.latitude) ?? 0,
    longitude: num(b.longitude) ?? 0,
    timezone: typeof b.timezone === "string" ? b.timezone : null,
    current: c
      ? {
          temperatureC: num(c.temperature_2m),
          humidity: num(c.relative_humidity_2m),
          windKmh: num(c.wind_speed_10m),
          code: num(c.weather_code),
          time: typeof c.time === "string" ? c.time : null,
        }
      : null,
    daily: dates.flatMap((d, i) =>
      typeof d === "string"
        ? [
            {
              date: d,
              code: col("weather_code", i),
              maxC: col("temperature_2m_max", i),
              minC: col("temperature_2m_min", i),
              rainChance: col("precipitation_probability_max", i),
              windMaxKmh: col("wind_speed_10m_max", i),
              uvMax: col("uv_index_max", i),
            },
          ]
        : [],
    ),
  };
}

/** WMO weather codes (as used by Open-Meteo) → words and an icon. */
export function describeCode(code: number | null): {
  label: string;
  icon: IconName;
} {
  if (code === null) return { label: "Unknown", icon: "weather-cloudy-alert" };
  if (code === 0) return { label: "Clear", icon: "weather-sunny" };
  if (code <= 2)
    return { label: "Partly cloudy", icon: "weather-partly-cloudy" };
  if (code === 3) return { label: "Overcast", icon: "weather-cloudy" };
  if (code === 45 || code === 48) return { label: "Fog", icon: "weather-fog" };
  if (code >= 51 && code <= 57)
    return { label: "Drizzle", icon: "weather-rainy" };
  if (code >= 61 && code <= 67)
    return {
      label: code >= 65 ? "Heavy rain" : "Rain",
      icon: code >= 65 ? "weather-pouring" : "weather-rainy",
    };
  if (code >= 71 && code <= 77) return { label: "Snow", icon: "weather-snowy" };
  if (code >= 80 && code <= 82)
    return {
      label: code === 82 ? "Violent showers" : "Showers",
      icon: "weather-pouring",
    };
  if (code >= 85 && code <= 86)
    return { label: "Snow showers", icon: "weather-snowy-heavy" };
  if (code >= 95)
    return {
      label: code >= 96 ? "Thunderstorm with hail" : "Thunderstorm",
      icon: "weather-lightning-rainy",
    };
  return { label: "Unknown", icon: "weather-cloudy-alert" };
}

export type DayOutlook =
  | {
      kind: "forecast";
      day: DailyForecast;
      certainty: "reliable" | "uncertain";
    }
  | { kind: "past" }
  | { kind: "beyond_horizon"; availableFrom: string }
  | { kind: "missing" };

const dayDiff = (from: string, to: string) =>
  Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
      86_400_000,
  );

/** The forecast for one date, or why there is none. `today` is the destination's local date. */
export function outlookFor(
  forecast: Forecast | null,
  date: string,
  today: string,
): DayOutlook {
  const ahead = dayDiff(today, date);
  if (ahead < 0) return { kind: "past" };
  if (ahead >= FORECAST_DAYS) {
    const from = new Date(
      Date.parse(`${date}T00:00:00Z`) - (FORECAST_DAYS - 1) * 86_400_000,
    )
      .toISOString()
      .slice(0, 10);
    return { kind: "beyond_horizon", availableFrom: from };
  }
  const day = forecast?.daily.find((d) => d.date === date);
  if (!day || (day.maxC === null && day.code === null))
    return { kind: "missing" };
  return {
    kind: "forecast",
    day,
    certainty: ahead < RELIABLE_DAYS ? "reliable" : "uncertain",
  };
}

export const WEATHER_MAX_AGE_MS = 3 * 60 * 60 * 1000;
/** Older than this, a cached forecast is shown as stale. */
export const WEATHER_STALE_MS = 12 * 60 * 60 * 1000;

/** One cache entry per ~1 km grid cell, so nearby destinations share a request. */
export const weatherCacheKey = (lat: number, lon: number) =>
  `weather:${lat.toFixed(2)},${lon.toFixed(2)}`;

export interface PackingHint {
  key: string;
  item: string;
  reason: string;
  icon: IconName;
}

/**
 * Packing ideas from the forecast days of a trip (only real forecast values;
 * no hints when there is no forecast). They are suggestions: the user adds
 * them, nothing changes the packing list by itself.
 */
export function packingHints(days: readonly DailyForecast[]): PackingHint[] {
  if (days.length === 0) return [];
  const hints: PackingHint[] = [];
  const max = (f: (d: DailyForecast) => number | null) =>
    days.reduce<number | null>(
      (m, d) => (f(d) === null ? m : Math.max(m ?? -Infinity, f(d) as number)),
      null,
    );
  const min = (f: (d: DailyForecast) => number | null) =>
    days.reduce<number | null>(
      (m, d) => (f(d) === null ? m : Math.min(m ?? Infinity, f(d) as number)),
      null,
    );
  const rain = max((d) => d.rainChance);
  const wet = days.some(
    (d) =>
      d.code !== null &&
      ((d.code >= 51 && d.code <= 67) ||
        (d.code >= 80 && d.code <= 82) ||
        d.code >= 95),
  );
  if ((rain !== null && rain >= 50) || wet)
    hints.push({
      key: "rain",
      item: "Umbrella or raincoat",
      reason: `Rain likely${rain !== null ? ` (up to ${rain}% chance)` : ""}`,
      icon: "umbrella-outline",
    });
  const cold = min((d) => d.minC);
  if (cold !== null && cold <= 12)
    hints.push({
      key: "cold",
      item: "Warm jacket",
      reason: `Lows down to ${Math.round(cold)}°C`,
      icon: "coat-rack",
    });
  const hot = max((d) => d.maxC);
  if (hot !== null && hot >= 30)
    hints.push({
      key: "heat",
      item: "Light, breathable clothes and water bottle",
      reason: `Highs up to ${Math.round(hot)}°C`,
      icon: "water-outline",
    });
  const uv = max((d) => d.uvMax);
  if (uv !== null && uv >= 6)
    hints.push({
      key: "sun",
      item: "Sunscreen, sunglasses and a hat",
      reason: `Strong sun (UV up to ${Math.round(uv)})`,
      icon: "sunglasses",
    });
  const wind = max((d) => d.windMaxKmh);
  if (wind !== null && wind >= 40)
    hints.push({
      key: "wind",
      item: "Windproof layer",
      reason: `Wind up to ${Math.round(wind)} km/h`,
      icon: "weather-windy",
    });
  return hints;
}
