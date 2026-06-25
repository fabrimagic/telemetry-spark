// Suspension & Platform engine.
//
// Reliability discipline (verified against the project's reference .ld files):
//
//   • Suspension travel channels ("log susp travel *", 100 Hz, mm) are
//     RELIABLE direct measurements: oscillate around zero with ±15-35 mm
//     excursions. These drive Section A (suspension work, dynamic rake).
//
//   • Ride-height channels ("log rideheight *", 100 Hz) are RAW / NOT
//     CALIBRATED: non-physical ranges (up to ~268 mm), long zero zones
//     (pit / stationary), no zero reference. Treat as RELATIVE TREND ONLY
//     — never as absolute height in mm. Drives Section B (informative).
//
//   • The raw "rideheight rake" channel (±200 mm) is NON-PHYSICAL and is
//     NEVER used. The dynamic rake index, when shown, is CALCULATED from
//     suspension travels and declared as a RELATIVE platform variation,
//     NOT an absolute rake in mm or degrees.
//
//   • No setup verdicts (no "spring too stiff/soft"). Aggregations are
//     facts; engineering judgement stays with the engineer.

import type { Channel, LdFile } from "@/lib/ld/types";
import type { LapRow } from "@/lib/ld/stintAnalysis";
import { resolveChannel } from "@/lib/ld/channelResolver";

export type WheelKey = "fl" | "fr" | "rl" | "rr";

const WHEELS: WheelKey[] = ["fl", "fr", "rl", "rr"];

export interface WheelAvailability {
  fl: boolean;
  fr: boolean;
  rl: boolean;
  rr: boolean;
}

/** Per-lap, per-wheel statistics extracted from suspension travel. */
export interface SuspLapStat {
  lap: number;
  /** Sample count actually used (valid, finite). */
  n: number;
  min: number;
  max: number;
  /** max - min, the travel range in the lap (mm). */
  range: number;
  mean: number;
  std: number;
  /** Median (used as data-derived zero reference for compression/extension split). */
  median: number;
  /** Fraction of samples strictly above median (compression by convention). */
  compressionFrac: number;
  /** Fraction of samples strictly below median (extension by convention). */
  extensionFrac: number;
  /** Distribution skewness (sample skew, NaN-safe). */
  skew: number;
}

export interface WheelSuspSeries {
  available: boolean;
  /** "channel missing" | "no valid samples" — empty when available. */
  unavailableReason?: string;
  perLap: SuspLapStat[];
  /** Stint-level averages over valid laps. */
  meanRange: number;
  meanCompressionFrac: number;
  meanExtensionFrac: number;
  meanSkew: number;
}

/** Per-lap calculated dynamic rake (front travel mean - rear travel mean). */
export interface DynamicRakeLap {
  lap: number;
  /** Mean front travel (avg of available FL/FR means). */
  front: number;
  /** Mean rear travel (avg of available RL/RR means). */
  rear: number;
  /** front - rear (mm). RELATIVE platform variation, NOT absolute rake. */
  delta: number;
}

export interface DynamicRake {
  available: boolean;
  perLap: DynamicRakeLap[];
  /** Mean delta over the stint (mm). */
  meanDelta: number;
  /** Which wheels contributed (at least one front and one rear required). */
  frontWheels: WheelKey[];
  rearWheels: WheelKey[];
}

export interface AxleSideBalance {
  /** Mean travel range, front axle (avg of available FL/FR meanRange). */
  frontRangeMean?: number;
  rearRangeMean?: number;
  leftRangeMean?: number;
  rightRangeMean?: number;
  /** Differences when both sides of a comparison are available. */
  frontMinusRear?: number;
  leftMinusRight?: number;
  /** True if a comparison was built from a single wheel only on one side. */
  axlePartial: boolean;
  sidePartial: boolean;
}

/** Per-lap, per-wheel mean of raw ride-height (RELATIVE trend only). */
export interface RideHeightLap {
  lap: number;
  fl?: number;
  fr?: number;
  rl?: number;
  rr?: number;
}

export interface RideHeightSeries {
  available: WheelAvailability;
  perLap: RideHeightLap[];
  /** Count of samples filtered out as implausible per wheel (<= 0 or > 400 mm). */
  filteredOut: Record<WheelKey, number>;
}

export interface SuspensionResult {
  /** True when at least one suspension-travel channel is available. */
  hasTravel: boolean;
  /** True when at least one ride-height channel is available. */
  hasRideHeight: boolean;
  travelAvailable: WheelAvailability;
  rideHeightAvailable: WheelAvailability;
  /** Per-wheel suspension travel work. */
  travel: Record<WheelKey, WheelSuspSeries>;
  /** Stint-level axle/side balance built from per-wheel ranges. */
  balance: AxleSideBalance;
  /** Calculated dynamic rake (front - rear travel means). */
  dynamicRake: DynamicRake;
  /** RAW ride-height trend (Section B). */
  rideHeight: RideHeightSeries;
}

function isFiniteSentinel(v: number): boolean {
  return Number.isFinite(v) && v !== -1;
}

function windowSlice(c: Channel, tStart: number, tEnd: number): number[] {
  const freq = c.freq || 1;
  const from = Math.max(0, Math.floor(tStart * freq));
  const to = Math.min(c.values.length - 1, Math.ceil(tEnd * freq));
  const out: number[] = [];
  for (let i = from; i <= to; i++) {
    const v = c.values[i];
    if (isFiniteSentinel(v)) out.push(v);
  }
  return out;
}

function median(sorted: number[]): number {
  const n = sorted.length;
  if (n === 0) return NaN;
  const mid = n >> 1;
  return n % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function mean(xs: number[]): number {
  if (xs.length === 0) return NaN;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

function std(xs: number[], m: number): number {
  if (xs.length === 0) return NaN;
  let s = 0;
  for (const x of xs) s += (x - m) * (x - m);
  return Math.sqrt(s / xs.length);
}

function skewness(xs: number[], m: number, s: number): number {
  if (xs.length === 0 || s === 0 || !Number.isFinite(s)) return NaN;
  let acc = 0;
  for (const x of xs) {
    const z = (x - m) / s;
    acc += z * z * z;
  }
  return acc / xs.length;
}

function buildTravelSeries(c: Channel | undefined, laps: LapRow[]): WheelSuspSeries {
  if (!c) {
    return {
      available: false,
      unavailableReason: "channel missing",
      perLap: [],
      meanRange: NaN,
      meanCompressionFrac: NaN,
      meanExtensionFrac: NaN,
      meanSkew: NaN,
    };
  }
  const perLap: SuspLapStat[] = [];
  for (const lap of laps) {
    if (!lap.isValidLap) continue;
    const samples = windowSlice(c, lap.tStart, lap.tEnd);
    if (samples.length === 0) continue;
    const sorted = [...samples].sort((a, b) => a - b);
    const m = mean(samples);
    const s = std(samples, m);
    const med = median(sorted);
    let compN = 0;
    let extN = 0;
    for (const v of samples) {
      if (v > med) compN++;
      else if (v < med) extN++;
    }
    perLap.push({
      lap: lap.lap,
      n: samples.length,
      min: sorted[0],
      max: sorted[sorted.length - 1],
      range: sorted[sorted.length - 1] - sorted[0],
      mean: m,
      std: s,
      median: med,
      compressionFrac: compN / samples.length,
      extensionFrac: extN / samples.length,
      skew: skewness(samples, m, s),
    });
  }
  if (perLap.length === 0) {
    return {
      available: false,
      unavailableReason: "no valid samples",
      perLap: [],
      meanRange: NaN,
      meanCompressionFrac: NaN,
      meanExtensionFrac: NaN,
      meanSkew: NaN,
    };
  }
  const ranges = perLap.map((p) => p.range);
  const comp = perLap.map((p) => p.compressionFrac);
  const ext = perLap.map((p) => p.extensionFrac);
  const sk = perLap.map((p) => p.skew).filter((v) => Number.isFinite(v));
  return {
    available: true,
    perLap,
    meanRange: mean(ranges),
    meanCompressionFrac: mean(comp),
    meanExtensionFrac: mean(ext),
    meanSkew: sk.length ? mean(sk) : NaN,
  };
}

function buildBalance(travel: Record<WheelKey, WheelSuspSeries>): AxleSideBalance {
  const present = (w: WheelKey) => travel[w].available;
  const meanRange = (ws: WheelKey[]): number | undefined => {
    const vals = ws.filter(present).map((w) => travel[w].meanRange).filter(Number.isFinite);
    if (vals.length === 0) return undefined;
    return mean(vals);
  };
  const frontWheels = (["fl", "fr"] as WheelKey[]).filter(present);
  const rearWheels = (["rl", "rr"] as WheelKey[]).filter(present);
  const leftWheels = (["fl", "rl"] as WheelKey[]).filter(present);
  const rightWheels = (["fr", "rr"] as WheelKey[]).filter(present);

  const frontRangeMean = meanRange(["fl", "fr"]);
  const rearRangeMean = meanRange(["rl", "rr"]);
  const leftRangeMean = meanRange(["fl", "rl"]);
  const rightRangeMean = meanRange(["fr", "rr"]);

  return {
    frontRangeMean,
    rearRangeMean,
    leftRangeMean,
    rightRangeMean,
    frontMinusRear:
      frontRangeMean !== undefined && rearRangeMean !== undefined
        ? frontRangeMean - rearRangeMean
        : undefined,
    leftMinusRight:
      leftRangeMean !== undefined && rightRangeMean !== undefined
        ? leftRangeMean - rightRangeMean
        : undefined,
    axlePartial: frontWheels.length < 2 || rearWheels.length < 2,
    sidePartial: leftWheels.length < 2 || rightWheels.length < 2,
  };
}

function buildDynamicRake(
  travel: Record<WheelKey, WheelSuspSeries>,
  laps: LapRow[],
): DynamicRake {
  const frontWheels = (["fl", "fr"] as WheelKey[]).filter((w) => travel[w].available);
  const rearWheels = (["rl", "rr"] as WheelKey[]).filter((w) => travel[w].available);
  if (frontWheels.length === 0 || rearWheels.length === 0) {
    return {
      available: false,
      perLap: [],
      meanDelta: NaN,
      frontWheels,
      rearWheels,
    };
  }
  const lookup: Record<WheelKey, Map<number, number>> = {
    fl: new Map(),
    fr: new Map(),
    rl: new Map(),
    rr: new Map(),
  };
  for (const w of WHEELS) {
    for (const p of travel[w].perLap) lookup[w].set(p.lap, p.mean);
  }
  const perLap: DynamicRakeLap[] = [];
  for (const lap of laps) {
    if (!lap.isValidLap) continue;
    const fronts = frontWheels.map((w) => lookup[w].get(lap.lap)).filter((v): v is number => Number.isFinite(v as number));
    const rears = rearWheels.map((w) => lookup[w].get(lap.lap)).filter((v): v is number => Number.isFinite(v as number));
    if (fronts.length === 0 || rears.length === 0) continue;
    const front = mean(fronts);
    const rear = mean(rears);
    perLap.push({ lap: lap.lap, front, rear, delta: front - rear });
  }
  return {
    available: perLap.length > 0,
    perLap,
    meanDelta: perLap.length ? mean(perLap.map((p) => p.delta)) : NaN,
    frontWheels,
    rearWheels,
  };
}

/** Plausibility window for raw ride-height (mm). Values outside are filtered
 *  out of the per-lap mean: clearly non-physical (negative, zero from pit/stop,
 *  or > 400 mm) entries do not contribute, but no calibration is implied. */
const RH_MIN_PLAUSIBLE = 1;   // mm — exclude flat-zero zones (box / stationary)
const RH_MAX_PLAUSIBLE = 400; // mm — exclude obvious garbage spikes

function rideHeightLapMean(c: Channel, tStart: number, tEnd: number): { mean: number | undefined; filtered: number } {
  const freq = c.freq || 1;
  const from = Math.max(0, Math.floor(tStart * freq));
  const to = Math.min(c.values.length - 1, Math.ceil(tEnd * freq));
  let s = 0;
  let n = 0;
  let filtered = 0;
  for (let i = from; i <= to; i++) {
    const v = c.values[i];
    if (!isFiniteSentinel(v)) continue;
    if (v < RH_MIN_PLAUSIBLE || v > RH_MAX_PLAUSIBLE) {
      filtered++;
      continue;
    }
    s += v;
    n++;
  }
  return { mean: n > 0 ? s / n : undefined, filtered };
}

function buildRideHeight(
  channels: Record<WheelKey, Channel | undefined>,
  laps: LapRow[],
): RideHeightSeries {
  const available: WheelAvailability = {
    fl: !!channels.fl,
    fr: !!channels.fr,
    rl: !!channels.rl,
    rr: !!channels.rr,
  };
  const filteredOut: Record<WheelKey, number> = { fl: 0, fr: 0, rl: 0, rr: 0 };
  const perLap: RideHeightLap[] = [];
  for (const lap of laps) {
    if (!lap.isValidLap) continue;
    const row: RideHeightLap = { lap: lap.lap };
    let any = false;
    for (const w of WHEELS) {
      const c = channels[w];
      if (!c) continue;
      const { mean: m, filtered } = rideHeightLapMean(c, lap.tStart, lap.tEnd);
      filteredOut[w] += filtered;
      if (m !== undefined) {
        row[w] = m;
        any = true;
      }
    }
    if (any) perLap.push(row);
  }
  return { available, perLap, filteredOut };
}

export function buildSuspension(file: LdFile, laps: LapRow[]): SuspensionResult {
  const channels = file.channels;
  const tChans: Record<WheelKey, Channel | undefined> = {
    fl: resolveChannel(channels, "suspTravel.fl"),
    fr: resolveChannel(channels, "suspTravel.fr"),
    rl: resolveChannel(channels, "suspTravel.rl"),
    rr: resolveChannel(channels, "suspTravel.rr"),
  };
  const rhChans: Record<WheelKey, Channel | undefined> = {
    fl: resolveChannel(channels, "rideHeight.fl"),
    fr: resolveChannel(channels, "rideHeight.fr"),
    rl: resolveChannel(channels, "rideHeight.rl"),
    rr: resolveChannel(channels, "rideHeight.rr"),
  };

  const travel: Record<WheelKey, WheelSuspSeries> = {
    fl: buildTravelSeries(tChans.fl, laps),
    fr: buildTravelSeries(tChans.fr, laps),
    rl: buildTravelSeries(tChans.rl, laps),
    rr: buildTravelSeries(tChans.rr, laps),
  };

  const travelAvailable: WheelAvailability = {
    fl: travel.fl.available,
    fr: travel.fr.available,
    rl: travel.rl.available,
    rr: travel.rr.available,
  };
  const hasTravel = WHEELS.some((w) => travel[w].available);

  const balance = buildBalance(travel);
  const dynamicRake = buildDynamicRake(travel, laps);
  const rideHeight = buildRideHeight(rhChans, laps);
  const rideHeightAvailable = rideHeight.available;
  const hasRideHeight = WHEELS.some((w) => rideHeightAvailable[w]);

  return {
    hasTravel,
    hasRideHeight,
    travelAvailable,
    rideHeightAvailable,
    travel,
    balance,
    dynamicRake,
    rideHeight,
  };
}
