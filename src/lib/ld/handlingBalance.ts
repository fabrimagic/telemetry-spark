// Handling Balance engine — RELATIVE understeer/oversteer tendency indicator.
//
// Model: simplified BICYCLE (kinematic) model.
//   - Inputs: vehicle speed, steering wheel angle, yaw rate.
//   - Vehicle params (declared, NOT inferred from data):
//       WHEELBASE_M     = 2.507 m   (Porsche 992 GT3 R, official spec).
//       STEERING_RATIO  ≈ 13:1      (ESTIMATE for a GT3-class car: affects
//                                    the absolute SCALE of the index but
//                                    NOT the sign of the tendency).
//   - For each valid sample:
//       wheelAngleRad   = (steerDeg / STEERING_RATIO) · π/180
//       expectedYawRad  = vMs · wheelAngleRad / WHEELBASE_M
//       index           = |yawMeasured| / |expectedYaw|   (same units)
//     index < 1  → car yaws LESS than the kinematic model → understeer tendency
//     index > 1  → car yaws MORE than the kinematic model → oversteer tendency
//
// CRITICAL — TIME ALIGNMENT (not index alignment).
//   The three channels typically run at DIFFERENT frequencies (yaw 50 Hz,
//   steer 100 Hz, speed varies). Aligning by raw sample index would mix
//   unrelated instants and produce a credible-looking but meaningless
//   correlation (~0). We instead pick the common base = min(freq) and
//   sample every channel at the REAL time t = i / commonFreq via
//   `Math.floor(t · channel.freq)`. With this alignment steer↔yaw
//   correlation lands around 0.86 (healthy) on the project reference file.
//
// Anti-hallucination discipline (REINFORCED).
//   - The output is a RELATIVE TENDENCY INDICATOR, never an absolute
//     under/oversteer figure in degrees.
//   - Required guards (declared as constants below):
//       V_MIN_KMH         — below this the model breaks down (noise-bound).
//       STEER_MIN_DEG     — below this we're in a straight: yaw≈0, ratio
//                            explodes; samples are skipped.
//       EXPECTED_YAW_MIN_RAD_S — additional safety floor on |expectedYaw|.
//   - Sign handling: both yaw and steer are taken in absolute value before
//     dividing. Curves are not partitioned by direction in the index itself.
//   - Yaw rate unit is auto-detected from the channel `unit` string
//     (degree-based units are converted to rad/s). When ambiguous we
//     assume deg/s (most common MoTeC convention).
//   - No categorical setup verdict is produced. Aggregations are qualitative
//     buckets around a neutral band: under / neutral / over.

import type { Channel, LdFile } from "@/lib/ld/types";
import type { LapRow } from "@/lib/ld/stintAnalysis";
import { resolveChannel } from "@/lib/ld/channelResolver";
import {
  buildReferenceGrid,
  resampleLapOnGrid,
  detectBrakingZones,
  type BrakingZone,
} from "@/lib/ld/lapComparison";

/* ============================ Declared constants ============================ */

/** Porsche 992 GT3 R wheelbase, official spec (m). */
export const WHEELBASE_M = 2.507;
/** Steering ratio (steering-wheel deg → road-wheel deg). ESTIMATE for GT3. */
export const STEERING_RATIO = 13;
/** Below this speed the kinematic model is noise-bound. */
export const V_MIN_KMH = 50;
/** Below this steering-wheel angle we are essentially straight. */
export const STEER_MIN_DEG = 5;
/** Safety floor on |expectedYaw| (rad/s) to keep the ratio stable. */
export const EXPECTED_YAW_MIN_RAD_S = 0.05;
/** Neutral band: |index − 1| ≤ NEUTRAL_BAND counts as neutral. */
export const NEUTRAL_BAND = 0.15;

export type Tendency = "understeer" | "neutral" | "oversteer";

export interface BalanceStats {
  count: number;
  /** Median of the dimensionless index (1 = neutral). */
  medianIndex: number;
  fracUnder: number;
  fracNeutral: number;
  fracOver: number;
  tendency: Tendency;
}

export interface PerLapBalance {
  lap: number;
  stats: BalanceStats;
}

export interface ZoneBalance {
  zone: BrakingZone;
  label: string;
  stats: BalanceStats;
}

export type HandlingBalanceReason =
  | "missing-channels"
  | "no-valid-laps"
  | "no-samples";

export interface HandlingBalanceResult {
  available: boolean;
  reason?: HandlingBalanceReason;
  message?: string;
  /** Which logical inputs were resolved. */
  availability: { speed: boolean; steer: boolean; yaw: boolean };
  /** Detected unit conversion factor applied to yaw measured (1 = rad/s, π/180 = deg/s). */
  yawUnit: "deg/s" | "rad/s" | "unknown";
  params: {
    wheelbaseM: number;
    steeringRatio: number;
    vMinKmh: number;
    steerMinDeg: number;
    neutralBand: number;
  };
  perLap: PerLapBalance[];
  stint: BalanceStats;
  zones?: ZoneBalance[];
  hasZones: boolean;
  lapsAnalysed: number;
}

/* ============================ Helpers ============================ */

const EMPTY_STATS: BalanceStats = {
  count: 0,
  medianIndex: NaN,
  fracUnder: NaN,
  fracNeutral: NaN,
  fracOver: NaN,
  tendency: "neutral",
};

function sampleAt(ch: Channel, t: number): number {
  const i = Math.floor(t * ch.freq);
  if (i < 0 || i >= ch.values.length) return NaN;
  const v = ch.values[i];
  return Number.isFinite(v) && v !== -1 ? v : NaN;
}

function median(sortedAsc: number[]): number {
  const n = sortedAsc.length;
  if (n === 0) return NaN;
  const mid = n >> 1;
  return n % 2 ? sortedAsc[mid] : (sortedAsc[mid - 1] + sortedAsc[mid]) / 2;
}

/** Detect yaw-rate unit from the channel's unit string. Defaults to deg/s
 *  when ambiguous (most common MoTeC convention on this project's files). */
function detectYawUnit(ch: Channel): { kind: "deg/s" | "rad/s" | "unknown"; toRad: number } {
  const u = (ch.unit ?? "").trim().toLowerCase();
  if (u.includes("rad")) return { kind: "rad/s", toRad: 1 };
  if (u.includes("deg") || u.includes("°") || u === "/s" || u === "") {
    // empty unit: many MoTeC firmwares omit the unit but log deg/s.
    return { kind: u ? "deg/s" : "unknown", toRad: Math.PI / 180 };
  }
  return { kind: "unknown", toRad: Math.PI / 180 };
}

function classify(index: number): Tendency {
  if (!Number.isFinite(index)) return "neutral";
  if (index < 1 - NEUTRAL_BAND) return "understeer";
  if (index > 1 + NEUTRAL_BAND) return "oversteer";
  return "neutral";
}

function statsOf(values: number[]): BalanceStats {
  if (values.length === 0) return EMPTY_STATS;
  let under = 0, over = 0, neutral = 0;
  for (const v of values) {
    const c = classify(v);
    if (c === "understeer") under++;
    else if (c === "oversteer") over++;
    else neutral++;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const med = median(sorted);
  return {
    count: values.length,
    medianIndex: med,
    fracUnder: under / values.length,
    fracNeutral: neutral / values.length,
    fracOver: over / values.length,
    tendency: classify(med),
  };
}

/* ============================ Main builder ============================ */

export function buildHandlingBalance(
  file: LdFile,
  laps: LapRow[],
): HandlingBalanceResult {
  const speed = resolveChannel(file.channels, "speed");
  const steer = resolveChannel(file.channels, "steeringAngle");
  const yaw = resolveChannel(file.channels, "yawRate");
  const lapCh = resolveChannel(file.channels, "lapDistance");

  const availability = { speed: !!speed, steer: !!steer, yaw: !!yaw };

  const baseResult: Omit<HandlingBalanceResult, "available" | "stint" | "perLap" | "hasZones" | "lapsAnalysed"> = {
    availability,
    yawUnit: "unknown",
    params: {
      wheelbaseM: WHEELBASE_M,
      steeringRatio: STEERING_RATIO,
      vMinKmh: V_MIN_KMH,
      steerMinDeg: STEER_MIN_DEG,
      neutralBand: NEUTRAL_BAND,
    },
  };

  if (!speed || !steer || !yaw) {
    const missing: string[] = [];
    if (!speed) missing.push("speed");
    if (!steer) missing.push("steering angle (log asteer)");
    if (!yaw) missing.push("yaw rate (sclu yaw rate / imu gyroz)");
    return {
      ...baseResult,
      available: false,
      reason: "missing-channels",
      message: `Handling Balance non calcolabile: canali mancanti — ${missing.join(", ")}.`,
      perLap: [],
      stint: EMPTY_STATS,
      hasZones: false,
      lapsAnalysed: 0,
    };
  }

  const yawConv = detectYawUnit(yaw);
  const commonFreq = Math.min(speed.freq, steer.freq, yaw.freq);
  if (!(commonFreq > 0)) {
    return {
      ...baseResult,
      yawUnit: yawConv.kind,
      available: false,
      reason: "missing-channels",
      message: "Frequenza di campionamento non valida sui canali richiesti.",
      perLap: [],
      stint: EMPTY_STATS,
      hasZones: false,
      lapsAnalysed: 0,
    };
  }

  const validLaps = laps.filter((l) => l.isValidLap);
  if (validLaps.length === 0) {
    return {
      ...baseResult,
      yawUnit: yawConv.kind,
      available: false,
      reason: "no-valid-laps",
      message: "Nessun giro valido nello stint.",
      perLap: [],
      stint: EMPTY_STATS,
      hasZones: false,
      lapsAnalysed: 0,
    };
  }

  const allIdx: number[] = [];
  const perLap: PerLapBalance[] = [];

  for (const lap of validLaps) {
    const iStart = Math.max(0, Math.floor(lap.tStart * commonFreq));
    const iEnd = Math.floor(lap.tEnd * commonFreq);
    const lapVals: number[] = [];
    for (let i = iStart; i < iEnd; i++) {
      const t = i / commonFreq;
      const vKmh = sampleAt(speed, t);
      const stDeg = sampleAt(steer, t);
      const yMeas = sampleAt(yaw, t);
      if (!Number.isFinite(vKmh) || !Number.isFinite(stDeg) || !Number.isFinite(yMeas)) continue;
      if (vKmh < V_MIN_KMH) continue;
      if (Math.abs(stDeg) < STEER_MIN_DEG) continue;
      const vMs = vKmh / 3.6;
      const wheelRad = (stDeg / STEERING_RATIO) * (Math.PI / 180);
      const expRad = (vMs * wheelRad) / WHEELBASE_M;
      if (Math.abs(expRad) < EXPECTED_YAW_MIN_RAD_S) continue;
      const measRad = yMeas * yawConv.toRad;
      const idx = Math.abs(measRad) / Math.abs(expRad);
      if (!Number.isFinite(idx) || idx <= 0) continue;
      lapVals.push(idx);
      allIdx.push(idx);
    }
    perLap.push({ lap: lap.lap, stats: statsOf(lapVals) });
  }

  if (allIdx.length === 0) {
    return {
      ...baseResult,
      yawUnit: yawConv.kind,
      available: false,
      reason: "no-samples",
      message:
        "Nessun campione utile: condizioni minime (velocità > "
        + `${V_MIN_KMH} km/h e sterzo > ${STEER_MIN_DEG}°) mai soddisfatte.`,
      perLap,
      stint: EMPTY_STATS,
      hasZones: false,
      lapsAnalysed: 0,
    };
  }

  // Per-zone aggregation on the fastest valid lap (geo-reference).
  let zones: ZoneBalance[] | undefined;
  const refLap = laps.find((l) => l.isFastest && l.isValidLap) ?? validLaps[0];
  if (refLap && lapCh) {
    const grid = buildReferenceGrid(file, refLap);
    if (grid) {
      const ref = resampleLapOnGrid(file, refLap, grid.grid);
      if (ref) {
        const det = detectBrakingZones(ref);
        if (det.length > 0) {
          const iStart = Math.max(0, Math.floor(refLap.tStart * commonFreq));
          const iEnd = Math.floor(refLap.tEnd * commonFreq);
          let dOrigin: number | undefined;
          for (let i = iStart; i < iEnd; i++) {
            const t = i / commonFreq;
            const dv = sampleAt(lapCh, t);
            if (Number.isFinite(dv) && dv >= 0) { dOrigin = dv; break; }
          }
          if (dOrigin !== undefined) {
            const buckets: number[][] = det.map(() => []);
            for (let i = iStart; i < iEnd; i++) {
              const t = i / commonFreq;
              const dv = sampleAt(lapCh, t);
              if (!Number.isFinite(dv)) continue;
              const d = dv - dOrigin;
              const vKmh = sampleAt(speed, t);
              const stDeg = sampleAt(steer, t);
              const yMeas = sampleAt(yaw, t);
              if (!Number.isFinite(vKmh) || !Number.isFinite(stDeg) || !Number.isFinite(yMeas)) continue;
              if (vKmh < V_MIN_KMH || Math.abs(stDeg) < STEER_MIN_DEG) continue;
              const vMs = vKmh / 3.6;
              const wheelRad = (stDeg / STEERING_RATIO) * (Math.PI / 180);
              const expRad = (vMs * wheelRad) / WHEELBASE_M;
              if (Math.abs(expRad) < EXPECTED_YAW_MIN_RAD_S) continue;
              const measRad = yMeas * yawConv.toRad;
              const idx = Math.abs(measRad) / Math.abs(expRad);
              if (!Number.isFinite(idx) || idx <= 0) continue;
              for (let zi = 0; zi < det.length; zi++) {
                const z = det[zi];
                if (d >= z.startDist && d <= z.endDist) buckets[zi].push(idx);
              }
            }
            zones = det.map((z, i) => ({
              zone: z,
              label: `T${i + 1}`,
              stats: statsOf(buckets[i]),
            }));
          }
        }
      }
    }
  }

  return {
    ...baseResult,
    yawUnit: yawConv.kind,
    available: true,
    perLap,
    stint: statsOf(allIdx),
    zones,
    hasZones: !!zones && zones.length > 0,
    lapsAnalysed: perLap.length,
  };
}
