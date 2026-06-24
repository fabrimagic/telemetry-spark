// Weather Evolution — per-lap evolution of on-board environmental sensors
// (airTemp, humidity, airPressure, wet) during the stint.
//
// Assumptions:
// - Data source is STRICTLY on-board sensors (PTH / wet flag) recorded
//   during the session. This engine does NOT perform any network call and
//   does NOT know anything about external weather providers (Open-Meteo or
//   others). External integration is the responsibility of a separate
//   module that will activate only when these channels are absent.
// - Channels are resolved via resolveChannel using existing logical keys
//   ("airTemp", "humidity", "airPressure", "wet"). Each is OPTIONAL; the
//   corresponding series/metric is omitted with a neutral placeholder when
//   the channel is missing.
// - Per-lap indexing uses Math.floor(t * channel.freq), consistent with the
//   other stint engines. Sentinel -1 and non-finite samples are discarded.
//   The wet channel is treated as a 0/1 flag via Math.round(v) === 1 — same
//   convention used by buildStintAnalysis when computing conditions.wetPct
//   (statistics intentionally REPLICATED here without modifying that file).
// - Pressure unit is reported verbatim from Channel.unit; no conversion is
//   applied. Temperature is assumed to be °C and humidity %, matching the
//   units used by the existing SessionConditions ribbon.
// - The "wet transition" lap is detected from a relevance threshold derived
//   from the data itself (see WET_TRANSITION_PCT below): no absolute legal
//   threshold is invented. The criterion is declared in the panel.

import type { Channel, LdFile } from "@/lib/ld/types";
import type { LapRow } from "@/lib/ld/stintAnalysis";
import { resolveChannel } from "@/lib/ld/channelResolver";

/** Minimum wet-percentage in a single lap required to mark that lap as
 *  the first "wet transition". Derived from data semantics: anything below
 *  this is interpreted as noise / spurious sensor activations on a dry
 *  surface. Documented in the panel and overridable here in one place. */
export const WET_TRANSITION_PCT = 10;

export interface LapWeatherRow {
  lap: number;
  isFastest?: boolean;
  airTempMean?: number;
  airTempMin?: number;
  airTempMax?: number;
  humidityMean?: number;
  airPressureMean?: number;
  /** Percentage 0..100 of samples in the lap with wet flag active. */
  wetPct?: number;
}

export interface SeriesDelta {
  first: number;
  last: number;
  delta: number;
  firstLap: number;
  lastLap: number;
  /** True when |delta| is below the stable-band derived from data noise. */
  stable: boolean;
}

export interface WetTransition {
  /** First lap whose wetPct exceeds WET_TRANSITION_PCT. */
  lap: number;
  wetPct: number;
}

export interface WeatherSummary {
  lapsAnalysed: number;
  airTemp?: SeriesDelta;
  humidity?: SeriesDelta;
  airPressure?: SeriesDelta;
  /** Undefined when wet channel missing. Null when channel present but no
   *  lap crosses WET_TRANSITION_PCT (i.e. dry throughout). */
  wetTransition?: WetTransition | null;
  /** Mean wet % across the stint (channel present only). */
  wetMeanPct?: number;
  /** Stability flag computed across all available numeric series. */
  overallStable: boolean;
}

export interface WeatherUnits {
  airTemp: string;
  humidity: string;
  airPressure: string;
}

export type WeatherEvolution =
  | { kind: "no-channels"; message: string }
  | {
      kind: "ok";
      perLap: LapWeatherRow[];
      summary: WeatherSummary;
      units: WeatherUnits;
      hasAirTemp: boolean;
      hasHumidity: boolean;
      hasAirPressure: boolean;
      hasWet: boolean;
    };

function isValid(v: number): boolean {
  return Number.isFinite(v) && v !== -1;
}

function sliceIndices(c: Channel, tStart: number, tEnd: number): { from: number; to: number } {
  const freq = c.freq || 1;
  const from = Math.max(0, Math.floor(tStart * freq));
  const to = Math.min(c.values.length - 1, Math.ceil(tEnd * freq));
  return { from, to };
}

function meanInRange(c: Channel, tStart: number, tEnd: number): number | undefined {
  const { from, to } = sliceIndices(c, tStart, tEnd);
  let s = 0;
  let n = 0;
  for (let i = from; i <= to; i++) {
    const v = c.values[i];
    if (!isValid(v)) continue;
    s += v;
    n++;
  }
  return n > 0 ? s / n : undefined;
}

function statsInRange(
  c: Channel,
  tStart: number,
  tEnd: number,
): { mean?: number; min?: number; max?: number } {
  const { from, to } = sliceIndices(c, tStart, tEnd);
  let s = 0;
  let n = 0;
  let mn = Infinity;
  let mx = -Infinity;
  for (let i = from; i <= to; i++) {
    const v = c.values[i];
    if (!isValid(v)) continue;
    s += v;
    n++;
    if (v < mn) mn = v;
    if (v > mx) mx = v;
  }
  if (n === 0) return {};
  return { mean: s / n, min: mn, max: mx };
}

/** Wet percentage in [0..100] for the lap window. Aligned with the same
 *  rule used by buildStintAnalysis: Math.round(v) === 1 counts as active.
 *  Replicated locally so this engine stays decoupled from stintAnalysis. */
function wetPctInRange(c: Channel, tStart: number, tEnd: number): number | undefined {
  const { from, to } = sliceIndices(c, tStart, tEnd);
  let on = 0;
  let tot = 0;
  for (let i = from; i <= to; i++) {
    const v = c.values[i];
    if (!isValid(v)) continue;
    tot++;
    if (Math.round(v) === 1) on++;
  }
  return tot > 0 ? (on / tot) * 100 : undefined;
}

/** Stability band: a delta is considered "substantially stable" when its
 *  absolute value is at most max(absFloor, relFrac * |mean|). Both terms
 *  are data-driven (no invented legal threshold). */
function isStable(delta: number, mean: number, absFloor: number, relFrac: number): boolean {
  const band = Math.max(absFloor, Math.abs(mean) * relFrac);
  return Math.abs(delta) <= band;
}

function pickEnds(
  perLap: LapWeatherRow[],
  key: keyof Pick<LapWeatherRow, "airTempMean" | "humidityMean" | "airPressureMean">,
  absFloor: number,
  relFrac: number,
): SeriesDelta | undefined {
  const valid = perLap.filter((r) => r[key] !== undefined && Number.isFinite(r[key] as number));
  if (valid.length < 2) return undefined;
  const first = valid[0];
  const last = valid[valid.length - 1];
  const fv = first[key] as number;
  const lv = last[key] as number;
  const meanRef = (fv + lv) / 2;
  return {
    first: fv,
    last: lv,
    delta: lv - fv,
    firstLap: first.lap,
    lastLap: last.lap,
    stable: isStable(lv - fv, meanRef, absFloor, relFrac),
  };
}

export function buildWeatherEvolution(file: LdFile, lapRows: LapRow[]): WeatherEvolution {
  const airT = resolveChannel(file.channels, "airTemp");
  const hum = resolveChannel(file.channels, "humidity");
  const airP = resolveChannel(file.channels, "airPressure");
  const wet = resolveChannel(file.channels, "wet");

  if (!airT && !hum && !airP && !wet) {
    return {
      kind: "no-channels",
      message: "Nessun canale meteo disponibile nei dati di bordo per questo file.",
    };
  }

  const validLaps = lapRows.filter((l) => l.isValidLap);
  if (validLaps.length === 0) {
    return {
      kind: "no-channels",
      message: "Nessun giro valido per costruire l'evoluzione meteo.",
    };
  }

  const perLap: LapWeatherRow[] = validLaps.map((lap) => {
    const row: LapWeatherRow = { lap: lap.lap, isFastest: lap.isFastest };
    if (airT) {
      const s = statsInRange(airT, lap.tStart, lap.tEnd);
      row.airTempMean = s.mean;
      row.airTempMin = s.min;
      row.airTempMax = s.max;
    }
    if (hum) row.humidityMean = meanInRange(hum, lap.tStart, lap.tEnd);
    if (airP) row.airPressureMean = meanInRange(airP, lap.tStart, lap.tEnd);
    if (wet) row.wetPct = wetPctInRange(wet, lap.tStart, lap.tEnd);
    return row;
  });

  // Stability bands are data-driven:
  //   - airTemp:    ≥ 0.5 °C floor, or 2% of |mean|
  //   - humidity:   ≥ 2 % pts floor, or 5% of |mean|
  //   - pressure:   ≥ 0.5 unit floor, or 0.1% of |mean|  (units come from sensor)
  const tempDelta = airT ? pickEnds(perLap, "airTempMean", 0.5, 0.02) : undefined;
  const humDelta = hum ? pickEnds(perLap, "humidityMean", 2, 0.05) : undefined;
  const pressDelta = airP ? pickEnds(perLap, "airPressureMean", 0.5, 0.001) : undefined;

  let wetTransition: WetTransition | null | undefined;
  let wetMeanPct: number | undefined;
  if (wet) {
    const wetVals = perLap
      .map((r) => r.wetPct)
      .filter((v): v is number => v !== undefined && Number.isFinite(v));
    if (wetVals.length > 0) {
      wetMeanPct = wetVals.reduce((a, b) => a + b, 0) / wetVals.length;
    }
    const firstHit = perLap.find((r) => r.wetPct !== undefined && r.wetPct >= WET_TRANSITION_PCT);
    wetTransition = firstHit ? { lap: firstHit.lap, wetPct: firstHit.wetPct as number } : null;
  }

  const stableFlags: boolean[] = [];
  if (tempDelta) stableFlags.push(tempDelta.stable);
  if (humDelta) stableFlags.push(humDelta.stable);
  if (pressDelta) stableFlags.push(pressDelta.stable);
  // Wet sub-stream: stable when transition is null and mean is below threshold
  if (wet) {
    stableFlags.push(
      wetTransition === null && (wetMeanPct === undefined || wetMeanPct < WET_TRANSITION_PCT),
    );
  }
  const overallStable = stableFlags.length > 0 && stableFlags.every(Boolean);

  const summary: WeatherSummary = {
    lapsAnalysed: validLaps.length,
    airTemp: tempDelta,
    humidity: humDelta,
    airPressure: pressDelta,
    wetTransition,
    wetMeanPct,
    overallStable,
  };

  const units: WeatherUnits = {
    airTemp: airT?.unit?.trim() || "°C",
    humidity: hum?.unit?.trim() || "%",
    airPressure: airP?.unit?.trim() || "",
  };

  return {
    kind: "ok",
    perLap,
    summary,
    units,
    hasAirTemp: !!airT,
    hasHumidity: !!hum,
    hasAirPressure: !!airP,
    hasWet: !!wet,
  };
}
