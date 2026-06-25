// Engine Usage — characterises engine use throughout a stint from the RPM
// channel, with REAL gear-shift telemetry when the engaged-gear channel is
// present.
//
// Assumptions / sources:
// - rpm values produced by the parser are already in the correct unit
//   (rev/min); no firmware-specific scaling is applied here.
// - When the `gear` logical channel is available (e.g. MoTeC "ecu gear",
//   20 Hz, values 0..N with -1 as sentinel) gear shifts are REAL telemetry:
//   every transition between two consecutive valid samples is one shift,
//   labelled up/down by the sign of the delta. RPM at the transition is
//   recorded alongside.
// - When `gear` is NOT present we fall back to the legacy estimate from
//   RPM-drop events, kept ONLY as a fallback and labelled as such (it can
//   include spurious events such as throttle lifts and downshifts).
// - All RPM thresholds are derived from the stint data itself (peak /
//   quantile of the observed distribution); we never invent an absolute
//   engine red-line.
// - Channels resolved via resolveChannel; missing rpm => the section is
//   empty. Missing throttle => traction-only metrics are omitted, the rest
//   stays. paddleUp / paddleDown are read only as informative metadata.

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

/** Legacy fallback: shift estimated from an RPM drop. Only populated when
 *  the gear channel is absent. */
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

/** Real gear-shift event derived from the engaged-gear channel. */
export interface GearShiftEvent {
  lap: number;
  fromGear: number;
  toGear: number;
  kind: "up" | "down";
  /** Absolute time of the transition (s). */
  t: number;
  /** RPM at the transition sample (when RPM is sampleable there). */
  rpm?: number;
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
  /** Real upshifts in this lap (gear source) or estimated shifts (fallback). */
  shiftsUp: number;
  /** Real downshifts in this lap. 0 in the RPM-drop fallback. */
  shiftsDown: number;
  /** Mean RPM at upshift moments in this lap (gear source only). */
  shiftUpRpmAvg?: number;
  /** Legacy field used only by the RPM-drop fallback: mean RPM drop magnitude. */
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
  /** Minimum drop (fraction of stint-max RPM) used to detect a shift (fallback only). */
  shiftDropFrac: number;
  /** Numerical value of the shift drop threshold (rpm) (fallback only). */
  shiftDropAbs: number;
}

export type ShiftSource = "gear" | "rpm-estimate";

/** Per-gear time / sample distribution across the stint. */
export interface GearDistributionEntry {
  gear: number;
  /** Number of gear-channel samples in this gear across the stint. */
  samples: number;
  /** Equivalent time in seconds (samples / gear-channel freq). */
  seconds: number;
  /** Fraction of the total in-gear time (0..1). */
  fraction: number;
}

/** Per-lap gear distribution (used by the panel as a bar group per lap). */
export interface LapGearDistribution {
  lap: number;
  perGear: GearDistributionEntry[];
}

export interface EngineUsageSummary {
  lapsAnalysed: number;
  stintMaxRpm: number;
  stintMaxLap: number;
  meanRpmTractionAvg?: number;
  fracAboveHighAvg?: number;
  totalOverRevs: number;
  /** Total upshifts (real when shiftSource=="gear", estimated otherwise). */
  totalShiftsUp: number;
  /** Total downshifts. 0 in the RPM-drop fallback. */
  totalShiftsDown: number;
  /** Mean RPM at upshift moments across the stint (gear source only). */
  shiftUpRpmAvg?: number;
  /** Where shift data came from. */
  shiftSource: ShiftSource;
  /** True when traction gating could be applied to at least one lap. */
  hasThrottle: boolean;
  /** True when paddleUp / paddleDown channels were detected and used as
   *  metadata (purely informative). */
  hasPaddles: boolean;
}

export type EngineUsage =
  | { kind: "no-rpm"; message: string }
  | {
      kind: "ok";
      perLap: LapUsageRow[];
      overRevs: OverRevEvent[];
      /** Real gear shifts (empty when shiftSource=="rpm-estimate"). */
      gearShifts: GearShiftEvent[];
      /** RPM-drop estimates (empty when shiftSource=="gear"). */
      shifts: ShiftEvent[];
      /** Stint-wide gear distribution (empty when shiftSource=="rpm-estimate"). */
      gearDistribution: GearDistributionEntry[];
      /** Per-lap gear distribution (empty when shiftSource=="rpm-estimate"). */
      lapGearDistribution: LapGearDistribution[];
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

/** Sample a channel at absolute time t (s). Returns undefined when invalid. */
function sampleAtTime(c: Channel, t: number): number | undefined {
  const j = Math.floor(t * (c.freq || 1));
  if (j < 0 || j >= c.values.length) return undefined;
  const v = c.values[j];
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
  const gear = resolveChannel(file.channels, "gear");
  const paddleUp = resolveChannel(file.channels, "paddleUp");
  const paddleDown = resolveChannel(file.channels, "paddleDown");
  const validLaps = lapRows.filter((l) => l.isValidLap);
  if (validLaps.length === 0) {
    return { kind: "no-rpm", message: "Nessun giro valido per analizzare l'uso motore." };
  }

  const shiftSource: ShiftSource = gear ? "gear" : "rpm-estimate";

  // -------- Pass 1: collect stint-wide RPM samples & per-lap peak RPM ------
  const allRpm: number[] = [];
  const lapMaxRpm: Array<number | undefined> = [];
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
  const gearShifts: GearShiftEvent[] = [];
  const lapGearDistribution: LapGearDistribution[] = [];
  // Stint-wide accumulator: samples-per-gear.
  const stintGearSamples = new Map<number, number>();

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

    // Event-tracking state (over-rev)
    let inOver = false;
    let overPeak = -Infinity;
    let overStartT = 0;
    let overPeakT = 0;

    // RPM-drop fallback shift detection state
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

      // Over-rev tracking
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

      // RPM-drop fallback shift estimation (used only when gear absent).
      if (!gear && lastRpm !== -Infinity) {
        if (v > localPeak) {
          localPeak = v;
          localPeakI = i;
          droppingFrom = -Infinity;
          droppingFromI = -1;
        }
        if (droppingFrom === -Infinity && v < lastRpm && localPeak !== -Infinity) {
          droppingFrom = localPeak;
          droppingFromI = localPeakI;
        }
        if (droppingFrom !== -Infinity && v > lastRpm) {
          const drop = droppingFrom - lastRpm;
          const durationS = (i - droppingFromI) / freq;
          if (drop >= shiftDropAbs && durationS > 0 && durationS <= 1.0) {
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
          localPeak = v;
          localPeakI = i;
          droppingFrom = -Infinity;
          droppingFromI = -1;
        }
      }
      lastRpm = v;
    }

    if (inOver) {
      overRevs.push({
        lap: lap.lap,
        peakRpm: overPeak,
        excessRpm: overPeak - overRevThreshold,
        durationS: Math.max(dt, (to / freq) - overStartT),
        tPeak: overPeakT,
      });
    }

    // -------- Real gear-shift detection (gear channel iteration) ---------
    let lapShiftsUp = 0;
    let lapShiftsDown = 0;
    let lapUpRpmSum = 0;
    let lapUpRpmN = 0;
    const lapGearSamples = new Map<number, number>();

    if (gear) {
      const gFreq = gear.freq || 1;
      const gFrom = Math.max(0, Math.floor(lap.tStart * gFreq));
      const gTo = Math.min(gear.values.length - 1, Math.ceil(lap.tEnd * gFreq));
      let prev: number | undefined;
      for (let i = gFrom; i <= gTo; i++) {
        const raw = gear.values[i];
        if (!isValid(raw)) {
          prev = undefined;
          continue;
        }
        const g = Math.round(raw);
        lapGearSamples.set(g, (lapGearSamples.get(g) ?? 0) + 1);
        stintGearSamples.set(g, (stintGearSamples.get(g) ?? 0) + 1);
        if (prev !== undefined && g !== prev) {
          const t = i / gFreq;
          const rpmAtShift = sampleAtTime(rpm, t);
          const evt: GearShiftEvent = {
            lap: lap.lap,
            fromGear: prev,
            toGear: g,
            kind: g > prev ? "up" : "down",
            t,
            rpm: rpmAtShift,
          };
          gearShifts.push(evt);
          if (evt.kind === "up") {
            lapShiftsUp++;
            if (rpmAtShift !== undefined) {
              lapUpRpmSum += rpmAtShift;
              lapUpRpmN++;
            }
          } else {
            lapShiftsDown++;
          }
        }
        prev = g;
      }

      const totalLapSamples = Array.from(lapGearSamples.values()).reduce((a, b) => a + b, 0);
      const perGear: GearDistributionEntry[] = Array.from(lapGearSamples.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([g, n]) => ({
          gear: g,
          samples: n,
          seconds: n / gFreq,
          fraction: totalLapSamples > 0 ? n / totalLapSamples : 0,
        }));
      lapGearDistribution.push({ lap: lap.lap, perGear });
    }

    // Per-lap aggregates: prefer real gear-derived counts; fall back to estimate.
    const overInLap = overRevs.filter((e) => e.lap === lap.lap).length;
    let shiftsUp: number;
    let shiftsDown: number;
    let shiftUpRpmAvg: number | undefined;
    let shiftDropAvg: number | undefined;
    if (gear) {
      shiftsUp = lapShiftsUp;
      shiftsDown = lapShiftsDown;
      shiftUpRpmAvg = lapUpRpmN > 0 ? lapUpRpmSum / lapUpRpmN : undefined;
    } else {
      const shiftsInLap = shifts.filter((e) => e.lap === lap.lap);
      shiftsUp = shiftsInLap.length;
      shiftsDown = 0;
      shiftDropAvg =
        shiftsInLap.length === 0
          ? undefined
          : shiftsInLap.reduce((a, b) => a + b.dropRpm, 0) / shiftsInLap.length;
    }

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
      shiftsUp,
      shiftsDown,
      shiftUpRpmAvg,
      shiftDropAvg,
    });
  }

  // -------- Stint-wide gear distribution --------------------------------
  let gearDistribution: GearDistributionEntry[] = [];
  if (gear) {
    const gFreq = gear.freq || 1;
    const totalSamples = Array.from(stintGearSamples.values()).reduce((a, b) => a + b, 0);
    gearDistribution = Array.from(stintGearSamples.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([g, n]) => ({
        gear: g,
        samples: n,
        seconds: n / gFreq,
        fraction: totalSamples > 0 ? n / totalSamples : 0,
      }));
  }

  // -------- Summary ------------------------------------------------------
  const meanTracVals = perLap
    .map((r) => r.meanRpmTraction)
    .filter((v): v is number => v !== undefined && Number.isFinite(v));
  const fracHighVals = perLap
    .map((r) => r.fracAboveHigh)
    .filter((v): v is number => v !== undefined && Number.isFinite(v));

  let totalShiftsUp: number;
  let totalShiftsDown: number;
  let shiftUpRpmAvg: number | undefined;
  if (gear) {
    const ups = gearShifts.filter((s) => s.kind === "up");
    totalShiftsUp = ups.length;
    totalShiftsDown = gearShifts.length - ups.length;
    const rpms = ups.map((s) => s.rpm).filter((v): v is number => v !== undefined);
    shiftUpRpmAvg = rpms.length > 0 ? rpms.reduce((a, b) => a + b, 0) / rpms.length : undefined;
  } else {
    totalShiftsUp = shifts.length;
    totalShiftsDown = 0;
    shiftUpRpmAvg = undefined;
  }

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
    totalShiftsUp,
    totalShiftsDown,
    shiftUpRpmAvg,
    shiftSource,
    hasThrottle: !!throttle,
    hasPaddles: !!(paddleUp || paddleDown),
  };

  return {
    kind: "ok",
    perLap,
    overRevs,
    gearShifts,
    shifts,
    gearDistribution,
    lapGearDistribution,
    thresholds,
    summary,
  };
}
