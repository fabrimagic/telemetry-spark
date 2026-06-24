// Braking & Traction Signature engine — characterises, per corner of the
// stint, how the driver brakes, releases the brake, and reopens the throttle,
// plus ABS activity in each corner. Aggregates across all valid laps.
//
// Assumptions / invariants:
//  - All channels are resolved via the logical-channel resolver. No hard-coded
//    MoTeC names; missing channels degrade gracefully.
//  - Corner zones are defined ONCE on the fastest valid lap (the reference)
//    by reusing `detectBrakingZones` from lapComparison.ts, then projected by
//    distance onto every other valid lap that is resampled on the same grid.
//  - The braking-start fractional threshold (BRAKE_PEAK_FRACTION = 0.18 of
//    each lap's OWN peak) is the SAME used in Lap Comparison — no new invented
//    thresholds.
//  - ABS hits are taken from buildStintAnalysis (AbsHit.lapDistanceNorm,
//    inValidLap). Only hits with inValidLap === true are counted.
//  - Time-based metrics are NOT produced here (ms-precision timing is not in
//    the file); only physical, spatial quantities and counts.

import type { LdFile } from "@/lib/ld/types";
import type { LapRow, AbsHit } from "@/lib/ld/stintAnalysis";
import {
  detectBrakingZones,
  buildReferenceGrid,
  resampleLapOnGrid,
  resolveComparisonChannels,
  BRAKE_PEAK_FRACTION,
  type BrakingZone,
  type ResampledLap,
} from "@/lib/ld/lapComparison";

/* ============================ Public types ============================ */

export interface ZoneStat {
  /** Mean across valid laps. NaN if no sample. */
  mean: number;
  /** Sample standard deviation across valid laps. NaN if < 2 samples. */
  std: number;
  /** Number of valid laps that contributed a value. */
  n: number;
}

export interface ZoneAbs {
  available: boolean;
  totalHits: number;
  /** Number of valid laps where at least one ABS hit landed in the zone. */
  lapsWithAbs: number;
  /** Mean ABS-hit duration (s) across the counted hits. NaN if none. */
  meanDurationS: number;
}

export interface SignatureRow {
  zone: BrakingZone;
  /** Conventional label (T1, T2, …). */
  label: string;
  /** Number of valid laps that yielded usable samples in the zone. */
  lapsAnalysed: number;
  vMin: ZoneStat;
  brakePeak: ZoneStat;
  brakePointDist: ZoneStat;
  /** Length (m) of the brake-release phase: from peak-pressure distance to
   *  the distance where the combined pressure returns below
   *  BRAKE_PEAK_FRACTION * lap-peak. Positive ⇒ long, modulated release. */
  releaseLength: ZoneStat;
  /** Distance (m) where throttle first crosses 50% of the lap's own throttle peak
   *  AFTER the apex. NaN-aggregated when throttle is missing. */
  throttleReopenDist: ZoneStat;
  /** Mean slope of throttle (%/m) over the reopen-to-end window. */
  throttleReopenGradient: ZoneStat;
  abs: ZoneAbs;
}

export interface BrakingSignatureResult {
  kind: "ok" | "no-lap-distance" | "no-brakes" | "no-reference" | "no-zones" | "no-valid-laps";
  message?: string;
  /** Reference lap used to define the zones. */
  refLap?: LapRow;
  /** Reference lap length (m). */
  refLapLength?: number;
  /** Number of valid laps actually resampled. */
  lapsConsidered?: number;
  /** Per-zone aggregated rows. */
  rows?: SignatureRow[];
  /** Whether throttle channel was available (controls UI columns). */
  hasThrottle: boolean;
  /** Whether ABS data was available (controls UI columns). */
  hasAbs: boolean;
}

/* ============================ Helpers ============================ */

function mean(xs: number[]): number {
  if (xs.length === 0) return NaN;
  let s = 0;
  for (const v of xs) s += v;
  return s / xs.length;
}

function std(xs: number[]): number {
  if (xs.length < 2) return NaN;
  const m = mean(xs);
  let s = 0;
  for (const v of xs) s += (v - m) * (v - m);
  return Math.sqrt(s / (xs.length - 1));
}

function stat(xs: number[]): ZoneStat {
  const clean = xs.filter((v) => Number.isFinite(v));
  return { mean: mean(clean), std: std(clean), n: clean.length };
}

function indexAtDistance(grid: Float32Array, d: number): number {
  if (grid.length < 2) return 0;
  const step = grid[1] - grid[0];
  if (step <= 0) return 0;
  const i = Math.round((d - grid[0]) / step);
  return Math.max(0, Math.min(grid.length - 1, i));
}

function combinedBrake(
  lap: ResampledLap,
  i: number,
): number {
  const pf = lap.series.brakePressFront;
  const pr = lap.series.brakePressRear;
  const a = pf && Number.isFinite(pf[i]) ? pf[i] : -Infinity;
  const b = pr && Number.isFinite(pr[i]) ? pr[i] : -Infinity;
  const v = Math.max(a, b);
  return Number.isFinite(v) ? v : NaN;
}

function lapBrakePeak(lap: ResampledLap): number {
  let peak = 0;
  for (let i = 0; i < lap.grid.length; i++) {
    const v = combinedBrake(lap, i);
    if (Number.isFinite(v) && v > peak) peak = v;
  }
  return peak;
}

function lapThrottlePeak(lap: ResampledLap): number {
  const t = lap.series.throttle;
  if (!t) return 0;
  let peak = 0;
  for (let i = 0; i < t.length; i++) {
    const v = t[i];
    if (Number.isFinite(v) && v > peak) peak = v;
  }
  return peak;
}

/** Compute the per-zone metrics for one resampled lap. Returns undefined when
 *  the lap doesn't cover the zone window (NaN values everywhere). */
function metricsForLap(
  lap: ResampledLap,
  zone: BrakingZone,
  hasThrottle: boolean,
): {
  vMin: number;
  brakePeak: number;
  brakePointDist: number;
  releaseLength: number;
  throttleReopenDist: number;
  throttleReopenGradient: number;
} | undefined {
  const i0 = indexAtDistance(lap.grid, zone.startDist);
  const i1 = indexAtDistance(lap.grid, zone.endDist);
  if (i1 <= i0) return undefined;

  const speed = lap.series.speed;
  const throttle = lap.series.throttle;

  // vMin in window
  let vMin = Infinity;
  let apexI = i0;
  if (speed) {
    for (let k = i0; k <= i1; k++) {
      const v = speed[k];
      if (Number.isFinite(v) && v < vMin) {
        vMin = v;
        apexI = k;
      }
    }
  }
  if (!Number.isFinite(vMin)) vMin = NaN;

  // Brake metrics
  let brakePeak = -Infinity;
  let brakePeakI = i0;
  for (let k = i0; k <= i1; k++) {
    const v = combinedBrake(lap, k);
    if (Number.isFinite(v) && v > brakePeak) {
      brakePeak = v;
      brakePeakI = k;
    }
  }
  if (!Number.isFinite(brakePeak)) brakePeak = NaN;

  const lapPeak = lapBrakePeak(lap);
  const thr = lapPeak * BRAKE_PEAK_FRACTION;

  // Brake-point distance: first sample in window where combined brake > thr
  let brakePointDist = NaN;
  if (lapPeak > 0) {
    for (let k = i0; k <= i1; k++) {
      const v = combinedBrake(lap, k);
      if (Number.isFinite(v) && v > thr) {
        brakePointDist = lap.grid[k];
        break;
      }
    }
  }

  // Release length: from brake-peak distance until pressure falls back below thr.
  let releaseLength = NaN;
  if (lapPeak > 0 && Number.isFinite(brakePeak)) {
    let releaseEnd = brakePeakI;
    for (let k = brakePeakI; k <= i1; k++) {
      releaseEnd = k;
      const v = combinedBrake(lap, k);
      if (Number.isFinite(v) && v <= thr) break;
    }
    releaseLength = lap.grid[releaseEnd] - lap.grid[brakePeakI];
    if (!(releaseLength >= 0)) releaseLength = NaN;
  }

  // Throttle reopen
  let throttleReopenDist = NaN;
  let throttleReopenGradient = NaN;
  if (hasThrottle && throttle) {
    const thrPeak = lapThrottlePeak(lap);
    if (thrPeak > 0) {
      const tThr = thrPeak * 0.5;
      let reopenI: number | undefined;
      for (let k = apexI; k <= i1; k++) {
        const v = throttle[k];
        if (Number.isFinite(v) && v > tThr) {
          reopenI = k;
          break;
        }
      }
      if (reopenI !== undefined) {
        throttleReopenDist = lap.grid[reopenI];
        // Mean slope over [reopenI, i1] computed by least-squares on (d, throttle).
        let n = 0;
        let sx = 0;
        let sy = 0;
        let sxx = 0;
        let sxy = 0;
        for (let k = reopenI; k <= i1; k++) {
          const v = throttle[k];
          if (!Number.isFinite(v)) continue;
          const x = lap.grid[k];
          n++;
          sx += x;
          sy += v;
          sxx += x * x;
          sxy += x * v;
        }
        if (n >= 2) {
          const denom = n * sxx - sx * sx;
          if (denom > 0) throttleReopenGradient = (n * sxy - sx * sy) / denom;
        }
      }
    }
  }

  return {
    vMin,
    brakePeak,
    brakePointDist,
    releaseLength,
    throttleReopenDist,
    throttleReopenGradient,
  };
}

function aggregateAbs(
  zone: BrakingZone,
  absHits: AbsHit[],
  hasAbs: boolean,
): ZoneAbs {
  if (!hasAbs) {
    return { available: false, totalHits: 0, lapsWithAbs: 0, meanDurationS: NaN };
  }
  const inZone = absHits.filter(
    (h) =>
      h.inValidLap === true &&
      h.lapDistanceNorm !== undefined &&
      Number.isFinite(h.lapDistanceNorm) &&
      h.lapDistanceNorm >= zone.startDist &&
      h.lapDistanceNorm <= zone.endDist,
  );
  const lapsWithAbs = new Set(inZone.map((h) => h.lap)).size;
  const durations = inZone
    .map((h) => h.durationS)
    .filter((d) => Number.isFinite(d));
  return {
    available: true,
    totalHits: inZone.length,
    lapsWithAbs,
    meanDurationS: durations.length > 0
      ? durations.reduce((a, b) => a + b, 0) / durations.length
      : NaN,
  };
}

/* ============================ Main builder ============================ */

export function buildBrakingSignature(
  file: LdFile,
  laps: LapRow[],
  absHits: AbsHit[],
  hasAbsChannel: boolean,
): BrakingSignatureResult {
  const channels = resolveComparisonChannels(file);
  const hasThrottle = !!channels.throttle;
  const hasAnyBrake = !!(channels.brakePressFront || channels.brakePressRear);

  if (!channels.speed) {
    // Without speed we cannot define vMin nor reliably project zones; still
    // require lapDistance / brakes as primary gate per spec.
  }

  // Gate 1: Lap Distance + at least one brake channel.
  const lapCh = resolveComparisonChannels; // (just to keep imports referenced)
  void lapCh;
  const refGrid0 = buildReferenceGrid(file, laps.find((l) => l.isFastest && l.isValidLap) ?? laps[0]);
  if (!refGrid0) {
    return {
      kind: "no-lap-distance",
      message: "Firma frenata non disponibile: servono Lap Distance e almeno un canale pressione freni.",
      hasThrottle,
      hasAbs: hasAbsChannel,
    };
  }
  if (!hasAnyBrake) {
    return {
      kind: "no-brakes",
      message: "Firma frenata non disponibile: servono Lap Distance e almeno un canale pressione freni.",
      hasThrottle,
      hasAbs: hasAbsChannel,
    };
  }

  // Pick reference lap = fastest valid; fallback to any valid lap.
  const refLap =
    laps.find((l) => l.isFastest && l.isValidLap) ??
    laps.find((l) => l.isValidLap) ??
    null;
  if (!refLap) {
    return {
      kind: "no-reference",
      message: "Nessun giro valido disponibile come riferimento per le zone.",
      hasThrottle,
      hasAbs: hasAbsChannel,
    };
  }

  const refGrid = buildReferenceGrid(file, refLap);
  if (!refGrid) {
    return {
      kind: "no-reference",
      message: "Lap Distance non monotòna sul giro di riferimento.",
      hasThrottle,
      hasAbs: hasAbsChannel,
    };
  }

  const reference = resampleLapOnGrid(file, refLap, refGrid.grid, channels);
  if (!reference) {
    return {
      kind: "no-reference",
      message: "Impossibile ricampionare il giro di riferimento.",
      hasThrottle,
      hasAbs: hasAbsChannel,
    };
  }

  const zones = detectBrakingZones(reference);
  if (zones.length === 0) {
    return {
      kind: "no-zones",
      message: "Nessuna zona-curva rilevata sul giro di riferimento.",
      hasThrottle,
      hasAbs: hasAbsChannel,
      refLap,
      refLapLength: refGrid.lapLength,
    };
  }

  // Resample every valid lap onto the reference grid.
  const validLaps = laps.filter((l) => l.isValidLap);
  if (validLaps.length === 0) {
    return {
      kind: "no-valid-laps",
      message: "Nessun giro valido nello stint.",
      hasThrottle,
      hasAbs: hasAbsChannel,
      refLap,
      refLapLength: refGrid.lapLength,
    };
  }
  const resampled = validLaps
    .map((l) => resampleLapOnGrid(file, l, refGrid.grid, channels))
    .filter((r): r is ResampledLap => r !== null);

  // For each zone, collect per-lap metrics and aggregate.
  const rows: SignatureRow[] = zones.map((zone, idx) => {
    const perLap = resampled
      .map((lap) => metricsForLap(lap, zone, hasThrottle))
      .filter((m): m is NonNullable<ReturnType<typeof metricsForLap>> => m !== undefined);

    const vMin = stat(perLap.map((m) => m.vMin));
    const brakePeak = stat(perLap.map((m) => m.brakePeak));
    const brakePointDist = stat(perLap.map((m) => m.brakePointDist));
    const releaseLength = stat(perLap.map((m) => m.releaseLength));
    const throttleReopenDist = hasThrottle
      ? stat(perLap.map((m) => m.throttleReopenDist))
      : { mean: NaN, std: NaN, n: 0 };
    const throttleReopenGradient = hasThrottle
      ? stat(perLap.map((m) => m.throttleReopenGradient))
      : { mean: NaN, std: NaN, n: 0 };
    const abs = aggregateAbs(zone, absHits, hasAbsChannel);
    return {
      zone,
      label: `T${idx + 1}`,
      lapsAnalysed: perLap.length,
      vMin,
      brakePeak,
      brakePointDist,
      releaseLength,
      throttleReopenDist,
      throttleReopenGradient,
      abs,
    };
  });

  return {
    kind: "ok",
    refLap,
    refLapLength: refGrid.lapLength,
    lapsConsidered: resampled.length,
    rows,
    hasThrottle,
    hasAbs: hasAbsChannel,
  };
}

/* ============================ Outlier helper ============================ */

/** Returns the set of zone indices (0-based) whose dispersion on `selector`
 *  is high relative to the other zones (z-score > 1 over rows). */
export function highDispersionZones(
  rows: SignatureRow[],
  selector: (r: SignatureRow) => number,
): Set<number> {
  const xs = rows.map(selector).map((v) => (Number.isFinite(v) ? v : NaN));
  const clean = xs.filter((v) => Number.isFinite(v));
  if (clean.length < 3) return new Set();
  const m = mean(clean);
  const s = std(clean);
  if (!Number.isFinite(s) || s === 0) return new Set();
  const out = new Set<number>();
  xs.forEach((v, i) => {
    if (!Number.isFinite(v)) return;
    if ((v - m) / s > 1) out.add(i);
  });
  return out;
}
