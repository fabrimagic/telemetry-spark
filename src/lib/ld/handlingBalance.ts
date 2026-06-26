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
//       rawIndex        = |yawMeasured| / |expectedYaw|   (same units)
//
// CRITICAL — TIME ALIGNMENT (not index alignment).
//   The three channels typically run at DIFFERENT frequencies. We pick the
//   common base = min(freq) and sample each channel at the REAL time
//   t = i / commonFreq via `Math.floor(t · channel.freq)`. This avoids
//   mixing unrelated instants when the channels have different rates.
//
// YAW UNIT INFERENCE (data-driven when ambiguous).
//   - If the channel `unit` string explicitly declares "rad" → rad/s.
//   - If it explicitly declares "deg" / "°" → deg/s.
//   - If empty/ambiguous (common on this project's MoTeC exports where
//     `sclu yaw rate` ships with an EMPTY unit string), we do NOT blindly
//     assume deg/s. Instead we compute the 95th-percentile of |yaw| on
//     in-corner samples (v ≥ V_MIN_KMH, |steer| ≥ STEER_MIN_DEG). A real
//     GT3 yaw rate in corner is ~0.3–0.8 rad/s (≈ 17–45 °/s). Heuristic:
//       p95(|yaw|) < UNIT_INFERENCE_RAD_THRESHOLD   → rad/s
//       otherwise                                    → deg/s
//     The chosen unit and the method are surfaced in the result so the
//     UI can declare the calibration honestly.
//
// ABSOLUTE-CALIBRATION HONESTY — RELATIVE INDEX.
//   Even with the correct unit, the raw index typically does NOT settle on
//   1.0: the kinematic model ignores slip angles, load transfer, chassis
//   compliance; the steering ratio is an ESTIMATE. These introduce an
//   unknown but largely constant SCALE factor. We refuse to "force" the
//   index to 1 with arbitrary corrections. Instead:
//     stintReferenceIndex = median(rawIndex) over all valid stint samples
//     relativeIndex       = rawIndex / stintReferenceIndex
//   Classification (understeer / neutral / oversteer) operates on the
//   relative index around 1, with a NEUTRAL_BAND of ±NEUTRAL_BAND. This
//   means: each lap / each corner is classified relative to the CAR'S
//   TYPICAL BALANCE IN THIS STINT, not against an absolute physical target.
//   That is what is robust under unknown scale: WHERE and WHEN the car
//   departs from its own average behaviour, not the absolute number.
//
// Anti-hallucination discipline (REINFORCED).
//   - The output is a RELATIVE TENDENCY INDICATOR, never an absolute
//     under/oversteer figure in degrees.
//   - Yaw unit is declared (and, if inferred, the inference method is too).
//   - The absolute scale of the raw index is declared UNRELIABLE.
//   - Required guards: V_MIN_KMH, STEER_MIN_DEG, EXPECTED_YAW_MIN_RAD_S.
//   - Sign handling: both yaw and steer are taken in absolute value.
//   - No categorical setup verdict is produced.

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
/**
 * Neutral band on the RELATIVE index (idx / stintReference). A sample/lap/zone
 * is flagged understeer/oversteer only when it deviates more than ±15 % from
 * the stint's own median balance.
 */
export const NEUTRAL_BAND = 0.15;
/**
 * Data-driven yaw-unit inference threshold. If p95(|yaw|) on in-corner
 * samples is below this value, the channel is assumed to be in rad/s
 * (GT3 in-corner yaw is ~0.3–0.8 rad/s ≈ 17–45 °/s, so a p95 below ~10
 * is impossible in deg/s but normal in rad/s).
 */
export const UNIT_INFERENCE_RAD_THRESHOLD = 10;

export type Tendency = "understeer" | "neutral" | "oversteer";

export type YawUnit = "deg/s" | "rad/s" | "unknown";
export type YawUnitMethod = "declared" | "data-driven" | "fallback";

export interface BalanceStats {
  count: number;
  /** Median of the RAW dimensionless index (model output, scale-dependent). */
  medianIndex: number;
  /** Median of the RELATIVE index = rawIndex / stintReference (≈1 means typical). */
  medianRelative: number;
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
  availability: { speed: boolean; steer: boolean; yaw: boolean };
  /** Detected/assumed unit of the yaw-rate channel. */
  yawUnit: YawUnit;
  /** How yawUnit was determined. */
  yawUnitMethod: YawUnitMethod;
  /** Raw declared unit string from the channel (for transparency). */
  yawUnitRaw: string;
  /** 95th percentile of |yaw| in-corner used by the data-driven inference. */
  yawP95?: number;
  /** Stint median of the RAW index; used as relative reference. */
  stintReferenceIndex: number;
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
  medianRelative: NaN,
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

function percentile(values: number[], p: number): number {
  if (values.length === 0) return NaN;
  const s = [...values].sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.max(0, Math.floor((p / 100) * (s.length - 1))));
  return s[i];
}

/**
 * Detect yaw-rate unit. Honours an explicit unit string; otherwise returns
 * `unknown` so the caller can run the data-driven inference on actual samples.
 */
function detectDeclaredYawUnit(ch: Channel): {
  kind: YawUnit;
  toRad: number;
  raw: string;
} {
  const raw = (ch.unit ?? "").trim();
  const u = raw.toLowerCase();
  if (u.includes("rad")) return { kind: "rad/s", toRad: 1, raw };
  if (u.includes("deg") || u.includes("°")) {
    return { kind: "deg/s", toRad: Math.PI / 180, raw };
  }
  // Empty or ambiguous: defer to data-driven inference.
  return { kind: "unknown", toRad: NaN, raw };
}

function classifyRelative(rel: number): Tendency {
  if (!Number.isFinite(rel)) return "neutral";
  if (rel < 1 - NEUTRAL_BAND) return "understeer";
  if (rel > 1 + NEUTRAL_BAND) return "oversteer";
  return "neutral";
}

function statsOf(values: number[], reference: number): BalanceStats {
  if (values.length === 0 || !(reference > 0)) return EMPTY_STATS;
  let under = 0, over = 0, neutral = 0;
  const relatives: number[] = new Array(values.length);
  for (let i = 0; i < values.length; i++) {
    const rel = values[i] / reference;
    relatives[i] = rel;
    const c = classifyRelative(rel);
    if (c === "understeer") under++;
    else if (c === "oversteer") over++;
    else neutral++;
  }
  const sortedAbs = [...values].sort((a, b) => a - b);
  const sortedRel = [...relatives].sort((a, b) => a - b);
  const medAbs = median(sortedAbs);
  const medRel = median(sortedRel);
  return {
    count: values.length,
    medianIndex: medAbs,
    medianRelative: medRel,
    fracUnder: under / values.length,
    fracNeutral: neutral / values.length,
    fracOver: over / values.length,
    tendency: classifyRelative(medRel),
  };
}

/* ============================ Main builder ============================ */

interface RawSample {
  lapIndex: number; // index into validLaps
  vKmh: number;
  stDeg: number;
  yawRaw: number; // in the channel's native unit
  t: number;
}

export function buildHandlingBalance(
  file: LdFile,
  laps: LapRow[],
): HandlingBalanceResult {
  const speed = resolveChannel(file.channels, "speed");
  const steer = resolveChannel(file.channels, "steeringAngle");
  const yaw = resolveChannel(file.channels, "yawRate");
  const lapCh = resolveChannel(file.channels, "lapDistance");

  const availability = { speed: !!speed, steer: !!steer, yaw: !!yaw };

  const baseParams = {
    wheelbaseM: WHEELBASE_M,
    steeringRatio: STEERING_RATIO,
    vMinKmh: V_MIN_KMH,
    steerMinDeg: STEER_MIN_DEG,
    neutralBand: NEUTRAL_BAND,
  };

  if (!speed || !steer || !yaw) {
    const missing: string[] = [];
    if (!speed) missing.push("speed");
    if (!steer) missing.push("steering angle (log asteer)");
    if (!yaw) missing.push("yaw rate (sclu yaw rate / imu gyroz)");
    return {
      availability,
      yawUnit: "unknown",
      yawUnitMethod: "fallback",
      yawUnitRaw: "",
      stintReferenceIndex: NaN,
      params: baseParams,
      available: false,
      reason: "missing-channels",
      message: `Handling Balance non calcolabile: canali mancanti — ${missing.join(", ")}.`,
      perLap: [],
      stint: EMPTY_STATS,
      hasZones: false,
      lapsAnalysed: 0,
    };
  }

  const declared = detectDeclaredYawUnit(yaw);
  const commonFreq = Math.min(speed.freq, steer.freq, yaw.freq);
  if (!(commonFreq > 0)) {
    return {
      availability,
      yawUnit: declared.kind,
      yawUnitMethod: declared.kind === "unknown" ? "fallback" : "declared",
      yawUnitRaw: declared.raw,
      stintReferenceIndex: NaN,
      params: baseParams,
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
      availability,
      yawUnit: declared.kind,
      yawUnitMethod: declared.kind === "unknown" ? "fallback" : "declared",
      yawUnitRaw: declared.raw,
      stintReferenceIndex: NaN,
      params: baseParams,
      available: false,
      reason: "no-valid-laps",
      message: "Nessun giro valido nello stint.",
      perLap: [],
      stint: EMPTY_STATS,
      hasZones: false,
      lapsAnalysed: 0,
    };
  }

  // --- PASS 1: collect raw in-corner samples (yaw in NATIVE unit). ---
  const rawSamples: RawSample[] = [];
  for (let li = 0; li < validLaps.length; li++) {
    const lap = validLaps[li];
    const iStart = Math.max(0, Math.floor(lap.tStart * commonFreq));
    const iEnd = Math.floor(lap.tEnd * commonFreq);
    for (let i = iStart; i < iEnd; i++) {
      const t = i / commonFreq;
      const vKmh = sampleAt(speed, t);
      const stDeg = sampleAt(steer, t);
      const yMeas = sampleAt(yaw, t);
      if (!Number.isFinite(vKmh) || !Number.isFinite(stDeg) || !Number.isFinite(yMeas)) continue;
      if (vKmh < V_MIN_KMH) continue;
      if (Math.abs(stDeg) < STEER_MIN_DEG) continue;
      rawSamples.push({ lapIndex: li, vKmh, stDeg, yawRaw: yMeas, t });
    }
  }

  // --- Yaw unit resolution (declared > data-driven inference). ---
  let yawUnit: YawUnit = declared.kind;
  let yawUnitMethod: YawUnitMethod = declared.kind === "unknown" ? "fallback" : "declared";
  let toRad = declared.toRad;
  let yawP95: number | undefined;

  if (rawSamples.length > 0) {
    const absYaws = rawSamples.map((s) => Math.abs(s.yawRaw));
    yawP95 = percentile(absYaws, 95);
    if (declared.kind === "unknown" && Number.isFinite(yawP95)) {
      if (yawP95 < UNIT_INFERENCE_RAD_THRESHOLD) {
        yawUnit = "rad/s";
        toRad = 1;
      } else {
        yawUnit = "deg/s";
        toRad = Math.PI / 180;
      }
      yawUnitMethod = "data-driven";
    }
  }
  if (!Number.isFinite(toRad)) {
    // Final fallback if no in-corner samples at all to infer from.
    toRad = Math.PI / 180;
    yawUnit = "deg/s";
    yawUnitMethod = "fallback";
  }

  // --- PASS 2: compute raw index per sample, grouped by lap. ---
  const perLapRaw: number[][] = validLaps.map(() => []);
  const allIdx: number[] = [];
  for (const s of rawSamples) {
    const vMs = s.vKmh / 3.6;
    const wheelRad = (s.stDeg / STEERING_RATIO) * (Math.PI / 180);
    const expRad = (vMs * wheelRad) / WHEELBASE_M;
    if (Math.abs(expRad) < EXPECTED_YAW_MIN_RAD_S) continue;
    const measRad = s.yawRaw * toRad;
    const idx = Math.abs(measRad) / Math.abs(expRad);
    if (!Number.isFinite(idx) || idx <= 0) continue;
    perLapRaw[s.lapIndex].push(idx);
    allIdx.push(idx);
  }

  if (allIdx.length === 0) {
    return {
      availability,
      yawUnit,
      yawUnitMethod,
      yawUnitRaw: declared.raw,
      yawP95,
      stintReferenceIndex: NaN,
      params: baseParams,
      available: false,
      reason: "no-samples",
      message:
        "Nessun campione utile: condizioni minime (velocità > "
        + `${V_MIN_KMH} km/h e sterzo > ${STEER_MIN_DEG}°) mai soddisfatte.`,
      perLap: validLaps.map((l) => ({ lap: l.lap, stats: EMPTY_STATS })),
      stint: EMPTY_STATS,
      hasZones: false,
      lapsAnalysed: 0,
    };
  }

  // --- Stint reference: median of raw index across all stint samples. ---
  const stintReference = median([...allIdx].sort((a, b) => a - b));

  const perLap: PerLapBalance[] = validLaps.map((l, i) => ({
    lap: l.lap,
    stats: statsOf(perLapRaw[i], stintReference),
  }));

  // --- Per-zone aggregation on the fastest valid lap (geo-reference). ---
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
              const measRad = yMeas * toRad;
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
              stats: statsOf(buckets[i], stintReference),
            }));
          }
        }
      }
    }
  }

  return {
    availability,
    yawUnit,
    yawUnitMethod,
    yawUnitRaw: declared.raw,
    yawP95,
    stintReferenceIndex: stintReference,
    params: baseParams,
    available: true,
    perLap,
    stint: statsOf(allIdx, stintReference),
    zones,
    hasZones: !!zones && zones.length > 0,
    lapsAnalysed: perLap.length,
  };
}
