// Engine Usage — characterises engine use throughout a stint from the RPM
// channel.
//
// Assumptions:
// - rpm values produced by the parser are already in the correct unit
//   (rev/min); no firmware-specific scaling is applied here.
// - There is NO reliable gear channel in this dataset, therefore gear shifts
//   are only ESTIMATED from RPM-drop events and labelled as such (spurious
//   events such as throttle lifts and downshifts can be included).
// - All thresholds are derived from the stint data itself (peak / quantile
//   of the observed distribution); we never invent an absolute engine red-line.
// - Channels resolved via resolveChannel; missing rpm => the section is empty.
//   Missing throttle => traction-only metrics are omitted, the rest stays.

import type { Channel, LdFile } from "@/lib/ld/types";
import type { LapRow } from "@/lib/ld/stintAnalysis";
import { resolveChannel } from "@/lib/ld/channelResolver";

export interface OverRevEvent {
  lap: number;
  /** Peak RPM reached during the event. */
  peakRpm: number;
  /** Peak − threshold. */
  excessRpm: number;
  /** Event duration in seconds. */
  durationS: number;
  /** Time of peak (seconds, absolute). */
  tPeak: number;
}

export interface ShiftEvent {
  lap: number;
  /** RPM right before the drop. */
  fromRpm: number;
  /** RPM at the bottom of the drop. */
  toRpm: number;
  dropRpm: number;
  /** Drop duration in seconds. */
  durationS: number;
}

export interface LapUsageRow {
  lap: number;
  isFastest?: boolean;
  /** Per-lap peak RPM (undefined if no valid samples). */
  maxRpm?: number;
  /** Mean RPM under traction (throttle ≥ thresholdFrac · lap-peak throttle),
   *  or whole-lap mean when throttle is unavailable. */
  meanRpmTraction?: number;
  /** Whether meanRpmTraction was computed on traction samples (true) or
   *  full lap (false: no throttle channel). */
  tractionGated: boolean;
  /** Fraction of lap time spent above the stint-wide high-RPM threshold. */
  fracAboveHigh?: number;
  /** Over-rev events detected in this lap. */
  overRevs: number;
  /** Estimated shifts detected in this lap. */
  shiftsEstimated: number;
  /** Mean drop magnitude across the estimated shifts (RPM). */
  shiftDropAvg?: number;
}

export interface EngineUsageThresholds {
  /** Fraction of throttle lap-peak used to gate traction samples. */
  throttleHighFrac: number;
  /** Fraction of stint-max RPM used as the "high RPM" zone. */
  highRpmFrac: number;
  /** Stint-max RPM (used together with highRpmFrac). */
  stintMaxRpm: number;
  /** Numerical value of the high-RPM threshold (rpm). */
  highRpmThreshold: number;
  /** Quantile used to derive the over-rev reference. */
  overRevQuantile: number;
  /** Numerical value of the over-rev threshold (rpm). */
  overRevThreshold: number;
  /** Minimum drop (fraction of stint-max RPM) used to detect a shift. */
  shiftDropFrac: number;
  /** Numerical value of the shift drop threshold (rpm). */
  shiftDropAbs: number;
}

export interface EngineUsageSummary {
  lapsAnalysed: number;
  stintMaxRpm: number;
  stintMaxLap: number;
  meanRpmTractionAvg?: number;
  fracAboveHighAvg?: number;
  totalOverRevs: number;
  totalShiftsEstimated: number;
  /** True when traction gating could be applied to at least one lap. */
  hasThrottle: boolean;
}

export type EngineUsage =
  | { kind: "no-rpm"; message: string }
  | {
      kind: "ok";
      perLap: LapUsageRow[];
      overRevs: OverRevEvent[];
      shifts: ShiftEvent[];
      thresholds: EngineUsageThresholds;
      summary: EngineUsageSummary;
    };

function isValid(v: number): boolean {
  return Number.isFinite(v) && v !== -1;
}

function sliceIndices(c: Channel, tStart: number, tEnd: number): { from: number; to: number; freq: number } {
  const freq = c.freq || 1;
  const from = Math.max(0, Math.floor(tStart * freq));
  const to = Math.min(c.values.length - 1, Math.ceil(tEnd * freq));
  return { from, to, freq };
}

/** Linear-interpolate a value from `other` (with its own freq) at the same
 *  TIME as sample index `i` of `ref`. Returns undefined when the value can't
 *  be sampled or is invalid. */
function sampleAtRefIndex(other: Channel, refFreq: number, i: number): number | undefined {
  const t = i / refFreq;
  const j = Math.floor(t * (other.freq || 1));
  if (j < 0 || j >= other.values.length) return undefined;
  const v = other.values[j];
  return isValid(v) ? v : undefined;
}

function quantile(sorted: number[], q: number): number | undefined {
  if (sorted.length === 0) return undefined;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  const frac = pos - lo;
  return sorted[lo] * (1 - frac) + sorted[hi] * frac;
}

export function buildEngineUsage(file: LdFile, lapRows: LapRow[]): EngineUsage {
  const rpm = resolveChannel(file.channels, "rpm");
  if (!rpm) {
    return { kind: "no-rpm", message: "Uso motore non disponibile: canale RPM assente." };
  }
  const throttle = resolveChannel(file.channels, "throttle");
  const validLaps = lapRows.filter((l) => l.isValidLap);
  if (validLaps.length === 0) {
    return { kind: "no-rpm", message: "Nessun giro valido per analizzare l'uso motore." };
  }

  // -------- Pass 1: collect stint-wide RPM samples & per-lap peak RPM ------
  const allRpm: number[] = [];
  const lapMaxRpm: Array<number | undefined> = [];
  const lapMaxLapNum: number[] = [];
  let stintMaxRpm = -Infinity;
  let stintMaxLap = validLaps[0].lap;

  for (const lap of validLaps) {
    const { from, to } = sliceIndices(rpm, lap.tStart, lap.tEnd);
    let m = -Infinity;
    for (let i = from; i <= to; i++) {
      const v = rpm.values[i];
      if (!isValid(v)) continue;
      allRpm.push(v);
      if (v > m) m = v;
    }
    if (m === -Infinity) {
      lapMaxRpm.push(undefined);
    } else {
      lapMaxRpm.push(m);
      if (m > stintMaxRpm) {
        stintMaxRpm = m;
        stintMaxLap = lap.lap;
      }
    }
    lapMaxLapNum.push(lap.lap);
  }

  if (!Number.isFinite(stintMaxRpm) || stintMaxRpm <= 0 || allRpm.length === 0) {
    return { kind: "no-rpm", message: "Canale RPM presente ma senza campioni validi nei giri considerati." };
  }

  // -------- Derive thresholds (data-driven) -------------------------------
  const throttleHighFrac = 0.8;
  const highRpmFrac = 0.95;
  const overRevQuantile = 0.995;
  const shiftDropFrac = 0.1; // 10% of stint-max as a robust drop reference

  const highRpmThreshold = stintMaxRpm * highRpmFrac;
  const sortedRpm = [...allRpm].sort((a, b) => a - b);
  const overRevThreshold = quantile(sortedRpm, overRevQuantile) ?? stintMaxRpm;
  const shiftDropAbs = stintMaxRpm * shiftDropFrac;

  const thresholds: EngineUsageThresholds = {
    throttleHighFrac,
    highRpmFrac,
    stintMaxRpm,
    highRpmThreshold,
    overRevQuantile,
    overRevThreshold,
    shiftDropFrac,
    shiftDropAbs,
  };

  // -------- Pass 2: per-lap metrics & event detection ----------------------
  const perLap: LapUsageRow[] = [];
  const overRevs: OverRevEvent[] = [];
  const shifts: ShiftEvent[] = [];

  for (let li = 0; li < validLaps.length; li++) {
    const lap = validLaps[li];
    const { from, to, freq } = sliceIndices(rpm, lap.tStart, lap.tEnd);
    const dt = 1 / freq;

    // Traction-gated mean RPM
    let tracSum = 0;
    let tracN = 0;
    let fullSum = 0;
    let fullN = 0;
    let highTime = 0;
    let totalTime = 0;

    // Lap-peak throttle (for traction gating threshold)
    let lapThrottlePeak = -Infinity;
    if (throttle) {
      for (let i = from; i <= to; i++) {
        const tv = sampleAtRefIndex(throttle, freq, i);
        if (tv !== undefined && tv > lapThrottlePeak) lapThrottlePeak = tv;
      }
      if (lapThrottlePeak === -Infinity) lapThrottlePeak = 0;
    }
    const throttleGate = throttle && lapThrottlePeak > 0
      ? lapThrottlePeak * throttleHighFrac
      : null;

    // Event-tracking state
    let inOver = false;
    let overPeak = -Infinity;
    let overStartT = 0;
    let overPeakT = 0;

    // Shift detection: track local peak then look for a fast drop ≥ shiftDropAbs
    // bounded in time (≤1 s) followed by a rise. State machine.
    let localPeak = -Infinity;
    let localPeakI = -1;
    let droppingFrom = -Infinity;
    let droppingFromI = -1;
    let lastRpm = -Infinity;

    for (let i = from; i <= to; i++) {
      const v = rpm.values[i];
      if (!isValid(v)) continue;

      totalTime += dt;
      fullSum += v;
      fullN++;

      if (throttleGate !== null) {
        const tv = sampleAtRefIndex(throttle!, freq, i);
        if (tv !== undefined && tv >= throttleGate) {
          tracSum += v;
          tracN++;
        }
      }

      if (v >= highRpmThreshold) highTime += dt;

      // Over-rev tracking (samples above overRevThreshold)
      if (v > overRevThreshold) {
        if (!inOver) {
          inOver = true;
          overPeak = v;
          overStartT = i / freq;
          overPeakT = overStartT;
        } else if (v > overPeak) {
          overPeak = v;
          overPeakT = i / freq;
        }
      } else if (inOver) {
        const endT = i / freq;
        overRevs.push({
          lap: lap.lap,
          peakRpm: overPeak,
          excessRpm: overPeak - overRevThreshold,
          durationS: Math.max(dt, endT - overStartT),
          tPeak: overPeakT,
        });
        inOver = false;
        overPeak = -Infinity;
      }

      // Shift estimation: detect drop from a recent peak. Require high
      // throttle around the peak when throttle is available (upshift hint).
      if (lastRpm !== -Infinity) {
        if (v > localPeak) {
          localPeak = v;
          localPeakI = i;
          droppingFrom = -Infinity;
          droppingFromI = -1;
        }
        // Detect start of a drop
        if (droppingFrom === -Infinity && v < lastRpm && localPeak !== -Infinity) {
          droppingFrom = localPeak;
          droppingFromI = localPeakI;
        }
        // Detect end of drop = local minimum (rising again)
        if (droppingFrom !== -Infinity && v > lastRpm) {
          const drop = droppingFrom - lastRpm;
          const durationS = (i - droppingFromI) / freq;
          if (drop >= shiftDropAbs && durationS > 0 && durationS <= 1.0) {
            // Optional throttle gate around the peak: throttle high at peak
            let throttleOk = true;
            if (throttleGate !== null && droppingFromI >= 0) {
              const tv = sampleAtRefIndex(throttle!, freq, droppingFromI);
              throttleOk = tv !== undefined && tv >= throttleGate;
            }
            if (throttleOk) {
              shifts.push({
                lap: lap.lap,
                fromRpm: droppingFrom,
                toRpm: lastRpm,
                dropRpm: drop,
                durationS,
              });
            }
          }
          // Reset to track next peak/drop cycle
          localPeak = v;
          localPeakI = i;
          droppingFrom = -Infinity;
          droppingFromI = -1;
        }
      }
      lastRpm = v;
    }

    // Close any over-rev still open at lap end
    if (inOver) {
      overRevs.push({
        lap: lap.lap,
        peakRpm: overPeak,
        excessRpm: overPeak - overRevThreshold,
        durationS: Math.max(dt, (to / freq) - overStartT),
        tPeak: overPeakT,
      });
    }

    const overInLap = overRevs.filter((e) => e.lap === lap.lap).length;
    const shiftsInLap = shifts.filter((e) => e.lap === lap.lap);
    const shiftDropAvg =
      shiftsInLap.length === 0
        ? undefined
        : shiftsInLap.reduce((a, b) => a + b.dropRpm, 0) / shiftsInLap.length;

    const tractionGated = throttleGate !== null && tracN > 0;
    perLap.push({
      lap: lap.lap,
      isFastest: lap.isFastest,
      maxRpm: lapMaxRpm[li],
      meanRpmTraction: tractionGated
        ? tracSum / tracN
        : (fullN > 0 ? fullSum / fullN : undefined),
      tractionGated,
      fracAboveHigh: totalTime > 0 ? highTime / totalTime : undefined,
      overRevs: overInLap,
      shiftsEstimated: shiftsInLap.length,
      shiftDropAvg,
    });
  }

  // -------- Summary --------------------------------------------------------
  const meanTracVals = perLap
    .map((r) => r.meanRpmTraction)
    .filter((v): v is number => v !== undefined && Number.isFinite(v));
  const fracHighVals = perLap
    .map((r) => r.fracAboveHigh)
    .filter((v): v is number => v !== undefined && Number.isFinite(v));

  const summary: EngineUsageSummary = {
    lapsAnalysed: validLaps.length,
    stintMaxRpm,
    stintMaxLap,
    meanRpmTractionAvg:
      meanTracVals.length > 0
        ? meanTracVals.reduce((a, b) => a + b, 0) / meanTracVals.length
        : undefined,
    fracAboveHighAvg:
      fracHighVals.length > 0
        ? fracHighVals.reduce((a, b) => a + b, 0) / fracHighVals.length
        : undefined,
    totalOverRevs: overRevs.length,
    totalShiftsEstimated: shifts.length,
    hasThrottle: !!throttle,
  };

  return { kind: "ok", perLap, overRevs, shifts, thresholds, summary };
}
