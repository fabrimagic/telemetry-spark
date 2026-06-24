// Open-Meteo client — EXTERNAL weather fallback.
//
// Source: https://open-meteo.com (CC BY 4.0). This module is used ONLY when
// the on-board weather sensors are entirely absent from the .ld file; the
// engine in src/lib/ld/weatherEvolution.ts remains the source of truth as
// long as a single on-board channel is available.
//
// Limits to keep in mind (and to surface in the UI):
// - Spatial resolution is on the km order: it reflects the weather over the
//   area of the circuit, NOT asphalt temperature nor track-side micro-meteo.
// - Temporal resolution is 15 minutes (where available) or hourly — far
//   coarser than a single stint.
// - Forecast endpoint covers up to ~92 past days; older sessions fall back
//   to the archive (ERA5 reanalysis) endpoint.
//
// No API key, no personal data in URLs (only circuit coordinates), no
// third-party SDK: native fetch + AbortController.

export interface OpenMeteoQuery {
  lat: number;
  lon: number;
  /** Local session day expressed as ISO YYYY-MM-DD (local to the circuit). */
  date: string;
  /** Inclusive stint window in seconds from local midnight of `date`. Optional;
   *  when omitted the whole day is returned and the caller filters. */
  timeWindow?: { startSec: number; endSec: number };
  /** Abort signal forwarded to fetch. */
  signal?: AbortSignal;
  /** Defaults to 12 s. */
  timeoutMs?: number;
}

export type OpenMeteoResolution = "15min" | "hourly";

export interface OpenMeteoSeries {
  /** ISO local timestamps (interpreted per `utcOffsetSeconds`). */
  times: string[];
  /** °C, undefined entries when missing for that step. */
  temperature: Array<number | undefined>;
  /** %, relative humidity at 2 m. */
  humidity: Array<number | undefined>;
  /** hPa, surface_pressure (preferred) or pressure_msl. */
  pressure: Array<number | undefined>;
  /** mm in the interval. */
  precipitation: Array<number | undefined>;
  /** m/s or km/h depending on API default (km/h). Unit returned separately. */
  windSpeed: Array<number | undefined>;
  resolution: OpenMeteoResolution;
  utcOffsetSeconds: number;
  /** Origin endpoint used to fetch the data. */
  source: "forecast" | "archive";
  /** Reported units (verbatim from the response, e.g. "°C", "%", "hPa", "km/h"). */
  units: {
    temperature?: string;
    humidity?: string;
    pressure?: string;
    precipitation?: string;
    windSpeed?: string;
  };
  /** True when the response advertised surface_pressure; false => pressure_msl. */
  pressureIsSurface: boolean;
  /** Echo of the coordinates resolved by the API (may be snapped to grid). */
  resolvedLat: number;
  resolvedLon: number;
  /** Echo of the date the user requested. */
  requestedDate: string;
}

export type OpenMeteoErrorKind =
  | "network"
  | "timeout"
  | "aborted"
  | "http"
  | "api"
  | "no-data"
  | "bad-input";

export interface OpenMeteoError {
  kind: OpenMeteoErrorKind;
  message: string;
  /** HTTP status when applicable. */
  status?: number;
}

export type OpenMeteoResult =
  | { ok: true; data: OpenMeteoSeries }
  | { ok: false; error: OpenMeteoError };

const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive";

const HOURLY_VARS = [
  "temperature_2m",
  "relative_humidity_2m",
  "surface_pressure",
  "pressure_msl",
  "precipitation",
  "wind_speed_10m",
] as const;

const MINUTELY_VARS = [
  "temperature_2m",
  "relative_humidity_2m",
  "surface_pressure",
  "pressure_msl",
  "precipitation",
  "wind_speed_10m",
] as const;

/** Open-Meteo forecast model covers ≈ 92 past days; older requests must hit
 *  the archive endpoint. We use a conservative 80-day cutoff. */
const FORECAST_PAST_DAYS_LIMIT = 80;

function daysAgo(dateIso: string): number {
  const target = Date.parse(dateIso + "T12:00:00Z");
  if (!Number.isFinite(target)) return Number.POSITIVE_INFINITY;
  return (Date.now() - target) / (1000 * 60 * 60 * 24);
}

function pickEndpoint(dateIso: string): "forecast" | "archive" {
  return daysAgo(dateIso) > FORECAST_PAST_DAYS_LIMIT ? "archive" : "forecast";
}

function buildUrl(endpoint: "forecast" | "archive", q: OpenMeteoQuery): string {
  const base = endpoint === "forecast" ? FORECAST_URL : ARCHIVE_URL;
  const params = new URLSearchParams({
    latitude: q.lat.toFixed(4),
    longitude: q.lon.toFixed(4),
    start_date: q.date,
    end_date: q.date,
    hourly: HOURLY_VARS.join(","),
    timezone: "auto",
    wind_speed_unit: "kmh",
    timeformat: "iso8601",
  });
  if (endpoint === "forecast") {
    params.set("minutely_15", MINUTELY_VARS.join(","));
  }
  return `${base}?${params.toString()}`;
}

type Unknown = unknown;

function isObject(v: Unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function asStringArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  return v.every((x) => typeof x === "string") ? (v as string[]) : undefined;
}

function asNumOrUndefArray(v: unknown): Array<number | undefined> | undefined {
  if (!Array.isArray(v)) return undefined;
  return v.map((x) => (typeof x === "number" && Number.isFinite(x) ? x : undefined));
}

function readUnits(obj: unknown): Record<string, string | undefined> {
  if (!isObject(obj)) return {};
  const out: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

function isMostlyEmpty(arr: Array<number | undefined>): boolean {
  if (arr.length === 0) return true;
  const valid = arr.filter((x) => x !== undefined).length;
  return valid / arr.length < 0.1;
}

interface ParsedBlock {
  times: string[];
  temperature: Array<number | undefined>;
  humidity: Array<number | undefined>;
  pressure: Array<number | undefined>;
  precipitation: Array<number | undefined>;
  windSpeed: Array<number | undefined>;
  pressureIsSurface: boolean;
  units: OpenMeteoSeries["units"];
}

function parseBlock(block: unknown, blockUnits: unknown): ParsedBlock | null {
  if (!isObject(block)) return null;
  const times = asStringArray(block.time);
  if (!times || times.length === 0) return null;

  const temperature = asNumOrUndefArray(block.temperature_2m) ?? new Array(times.length).fill(undefined);
  const humidity = asNumOrUndefArray(block.relative_humidity_2m) ?? new Array(times.length).fill(undefined);
  const precipitation = asNumOrUndefArray(block.precipitation) ?? new Array(times.length).fill(undefined);
  const windSpeed = asNumOrUndefArray(block.wind_speed_10m) ?? new Array(times.length).fill(undefined);
  const surfP = asNumOrUndefArray(block.surface_pressure);
  const mslP = asNumOrUndefArray(block.pressure_msl);
  let pressure: Array<number | undefined>;
  let pressureIsSurface: boolean;
  if (surfP && !isMostlyEmpty(surfP)) {
    pressure = surfP;
    pressureIsSurface = true;
  } else if (mslP) {
    pressure = mslP;
    pressureIsSurface = false;
  } else {
    pressure = new Array(times.length).fill(undefined);
    pressureIsSurface = false;
  }

  const u = readUnits(blockUnits);
  return {
    times,
    temperature,
    humidity,
    pressure,
    precipitation,
    windSpeed,
    pressureIsSurface,
    units: {
      temperature: u.temperature_2m,
      humidity: u.relative_humidity_2m,
      pressure: pressureIsSurface ? u.surface_pressure : u.pressure_msl,
      precipitation: u.precipitation,
      windSpeed: u.wind_speed_10m,
    },
  };
}

function validateInput(q: OpenMeteoQuery): OpenMeteoError | null {
  if (!Number.isFinite(q.lat) || Math.abs(q.lat) > 90) {
    return { kind: "bad-input", message: "Latitudine non valida." };
  }
  if (!Number.isFinite(q.lon) || Math.abs(q.lon) > 180) {
    return { kind: "bad-input", message: "Longitudine non valida." };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(q.date)) {
    return { kind: "bad-input", message: "Data non valida (atteso YYYY-MM-DD)." };
  }
  return null;
}

export async function fetchOpenMeteo(q: OpenMeteoQuery): Promise<OpenMeteoResult> {
  const bad = validateInput(q);
  if (bad) return { ok: false, error: bad };

  const endpoint = pickEndpoint(q.date);
  const url = buildUrl(endpoint, q);

  const timeoutMs = q.timeoutMs ?? 12_000;
  const internal = new AbortController();
  const onAbort = () => internal.abort();
  if (q.signal) {
    if (q.signal.aborted) {
      return { ok: false, error: { kind: "aborted", message: "Richiesta annullata." } };
    }
    q.signal.addEventListener("abort", onAbort, { once: true });
  }
  const timer = setTimeout(() => internal.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(url, { signal: internal.signal, cache: "no-store" });
  } catch (err) {
    clearTimeout(timer);
    q.signal?.removeEventListener("abort", onAbort);
    if (q.signal?.aborted) {
      return { ok: false, error: { kind: "aborted", message: "Richiesta annullata." } };
    }
    if (internal.signal.aborted) {
      return { ok: false, error: { kind: "timeout", message: "Timeout della richiesta meteo." } };
    }
    return {
      ok: false,
      error: { kind: "network", message: err instanceof Error ? err.message : "Errore di rete." },
    };
  }
  clearTimeout(timer);
  q.signal?.removeEventListener("abort", onAbort);

  if (!response.ok) {
    return {
      ok: false,
      error: {
        kind: "http",
        status: response.status,
        message: `Open-Meteo HTTP ${response.status}`,
      },
    };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return { ok: false, error: { kind: "api", message: "Risposta Open-Meteo non leggibile." } };
  }

  if (!isObject(payload)) {
    return { ok: false, error: { kind: "api", message: "Risposta Open-Meteo non valida." } };
  }
  if (payload.error === true) {
    const reason = typeof payload.reason === "string" ? payload.reason : "Errore Open-Meteo.";
    return { ok: false, error: { kind: "api", message: reason } };
  }

  const utcOffsetSeconds =
    typeof payload.utc_offset_seconds === "number" ? payload.utc_offset_seconds : 0;
  const resolvedLat = typeof payload.latitude === "number" ? payload.latitude : q.lat;
  const resolvedLon = typeof payload.longitude === "number" ? payload.longitude : q.lon;

  // Prefer 15-minute resolution when present and populated.
  const minutely = parseBlock(payload.minutely_15, payload.minutely_15_units);
  const hourly = parseBlock(payload.hourly, payload.hourly_units);

  const chosen = minutely && !isMostlyEmpty(minutely.temperature) ? minutely : hourly;
  const resolution: OpenMeteoResolution = chosen === minutely ? "15min" : "hourly";
  if (!chosen) {
    return {
      ok: false,
      error: {
        kind: "no-data",
        message: "Open-Meteo non ha restituito serie temporali per la data/località richieste.",
      },
    };
  }

  // Optional time-window crop. Open-Meteo timestamps are local (timezone=auto).
  let { times, temperature, humidity, pressure, precipitation, windSpeed } = chosen;
  if (q.timeWindow && Number.isFinite(q.timeWindow.startSec) && Number.isFinite(q.timeWindow.endSec)) {
    const startTs = Date.parse(`${q.date}T00:00:00Z`) + q.timeWindow.startSec * 1000;
    const endTs = Date.parse(`${q.date}T00:00:00Z`) + q.timeWindow.endSec * 1000;
    const keep: number[] = [];
    for (let i = 0; i < times.length; i++) {
      const ts = Date.parse(times[i] + "Z"); // local ISO, treated as UTC for windowing
      if (!Number.isFinite(ts)) continue;
      // Allow a generous pad of one step on each side so a short stint still
      // shows context: ±1 hour for hourly, ±15 min for 15-minute resolution.
      const pad = resolution === "15min" ? 15 * 60 * 1000 : 60 * 60 * 1000;
      if (ts >= startTs - pad && ts <= endTs + pad) keep.push(i);
    }
    if (keep.length > 0) {
      times = keep.map((i) => times[i]);
      temperature = keep.map((i) => temperature[i]);
      humidity = keep.map((i) => humidity[i]);
      pressure = keep.map((i) => pressure[i]);
      precipitation = keep.map((i) => precipitation[i]);
      windSpeed = keep.map((i) => windSpeed[i]);
    }
  }

  return {
    ok: true,
    data: {
      times,
      temperature,
      humidity,
      pressure,
      precipitation,
      windSpeed,
      resolution,
      utcOffsetSeconds,
      source: endpoint,
      units: chosen.units,
      pressureIsSurface: chosen.pressureIsSurface,
      resolvedLat,
      resolvedLon,
      requestedDate: q.date,
    },
  };
}

/* ===================== Helpers exposed for the UI ===================== */

/** Parse a MoTeC-style date string (commonly DD/MM/YYYY, DD/MM/YY, or
 *  YYYY-MM-DD) into ISO `YYYY-MM-DD`. Returns undefined on failure. */
export function normalizeSessionDate(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const s = raw.trim();
  if (!s) return undefined;
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/.exec(s);
  if (dmy) {
    const d = dmy[1].padStart(2, "0");
    const m = dmy[2].padStart(2, "0");
    let y = dmy[3];
    if (y.length === 2) y = (Number(y) >= 70 ? "19" : "20") + y;
    return `${y}-${m}-${d}`;
  }
  return undefined;
}

/** Parse a MoTeC-style time string (HH:MM:SS or HH:MM) into seconds-from-
 *  midnight in the local frame the file was recorded in. Undefined on failure. */
export function sessionTimeToSeconds(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(raw.trim());
  if (!m) return undefined;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  const ss = m[3] ? Number(m[3]) : 0;
  if (!Number.isFinite(hh) || !Number.isFinite(mm) || !Number.isFinite(ss)) return undefined;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59 || ss < 0 || ss > 59) return undefined;
  return hh * 3600 + mm * 60 + ss;
}
