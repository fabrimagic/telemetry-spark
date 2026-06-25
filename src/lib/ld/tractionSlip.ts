// Traction Slip engine — CALCULATED slip from the four wheel-speed channels.
//
// Why calculated, not measured: the file's native "abs Slip *" channels are
// null ~99.7 % of the time and are deliberately ignored project-wide. The
// four `abs speed *` channels, on the other hand, are genuine and clean
// (100 Hz, km/h). On this RWD car the front wheels are non-driven so they
// read true vehicle speed; the rears are driven and can spin up under
// traction. We derive slip from those.
//
// Anti-hallucination discipline:
//  - "Slip" here is a COMPUTED quantity, never a TC-intervention flag (the
//    intervention channel is not logged in these files).
//  - In-corner samples are LESS reliable because the geometric track-width
//    difference between rear and front contaminates the rear/front ratio.
//    We tag them and report straight-line vs in-corner stats separately;
//    we do NOT attempt a perfect geometric correction.
//  - Thresholds are either derived from the data (corner indicator → 75th
//    percentile of |vFL−vFR| / vFront over the stint) or declared as a
//    minimum-speed guard (V_MIN_KMH) / a significance threshold
//    (SLIP_SIGNIFICANT_PCT). Nothing is inferred from a vehicle catalogue.

import type { Channel, LdFile } from "@/lib/ld/types";
import type { LapRow } from "@/lib/ld/stintAnalysis";
import { resolveChannel } from "@/lib/ld/channelResolver";
import {
  buildReferenceGrid,
  resampleLapOnGrid,
  detectBrakingZones,
  type BrakingZone,
} from "@/lib/ld/lapComparison";

/** Below this speed the slip ratio becomes numerically unstable. Declared. */
export const V_MIN_KMH = 30;
/** Slip percentage flagged as "significant" for the time-over-threshold metric. Declared. */
export const SLIP_SIGNIFICANT_PCT = 2;

export interface TractionSlipStats {
  count: number;
  /** Median slip (%). */
  median: number;
  p95: number;
  p99: number;
  max: number;
  /** Fraction of samples with slip > SLIP_SIGNIFICANT_PCT (0..1). */
  fracOverThreshold: number;
}

export interface PerLapSlip {
  lap: number;
  overall: TractionSlipStats;
  straight: TractionSlipStats;
  corner: TractionSlipStats;
}

export interface ZoneSlipExit {
  zone: BrakingZone;
  /** Conventional label (T1, T2, …). */
  label: string;
  /** Mean slip (%) in [apexDist, endDist]. */
  meanSlip: number;
  /** Max slip (%) in [apexDist, endDist]. */
  maxSlip: number;
  /** Fraction of in-zone samples with slip > SLIP_SIGNIFICANT_PCT. */
  fracOverThreshold: number;
  count: number;
}

export type TractionSlipReason =
  | "missing-wheels"
  | "no-valid-laps"
  | "no-samples";

export interface TractionSlipResult {
  available: boolean;
  reason?: TractionSlipReason;
  message?: string;
  thresholds: {
    vMinKmh: number;
    slipSignificantPct: number;
    /** Derived from data — 75th percentile of |vFL−vFR|/vFront over the stint. */
    cornerIndicatorThreshold: number;
  };
  perLap: PerLapSlip[];
  stint: {
    overall: TractionSlipStats;
    straight: TractionSlipStats;
    corner: TractionSlipStats;
  };
  zones?: ZoneSlipExit[];
  hasZones: boolean;
  lapsAnalysed: number;
}

/* ============================ Helpers ============================ */

const EMPTY_STATS: TractionSlipStats = {
  count: 0,
  median: NaN,
  p95: NaN,
  p99: NaN,
  max: NaN,
  fracOverThreshold: NaN,
};

function isFinitePositive(v: number): boolean {
  return Number.isFinite(v) && v !== -1;
}

function sampleAt(ch: Channel, t: number): number {
  const i = Math.floor(t * ch.freq);
  if (i < 0 || i >= ch.values.length) return NaN;
  const v = ch.values[i];
  return isFinitePositive(v) ? v : NaN;
}

function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return NaN;
  const idx = Math.min(
    sortedAsc.length - 1,
    Math.max(0, Math.floor((p / 100) * (sortedAsc.length - 1))),
  );
  return sortedAsc[idx];
}

function statsOf(values: number[], threshold: number): TractionSlipStats {
  if (values.length === 0) return EMPTY_STATS;
  const sorted = [...values].sort((a, b) => a - b);
  let over = 0;
  for (const v of values) if (v > threshold) over++;
  return {
    count: values.length,
    median: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    max: sorted[sorted.length - 1],
    fracOverThreshold: over / values.length,
  };
}

/* ============================ Main builder ============================ */

export function buildTractionSlip(
  file: LdFile,
  laps: LapRow[],
): TractionSlipResult {
  const vFL = resolveChannel(file.channels, "wheelSpeedFL");
  const vFR = resolveChannel(file.channels, "wheelSpeedFR");
  const vRL = resolveChannel(file.channels, "wheelSpeedRL");
  const vRR = resolveChannel(file.channels, "wheelSpeedRR");
  const lapCh = resolveChannel(file.channels, "lapDistance");

  if (!vFL || !vFR || !vRL || !vRR) {
    return {
      available: false,
      reason: "missing-wheels",
      message:
        "Slip in trazione non calcolabile: servono le quattro velocità ruota (abs speed fl/fr/rl/rr).",
      thresholds: {
        vMinKmh: V_MIN_KMH,
        slipSignificantPct: SLIP_SIGNIFICANT_PCT,
        cornerIndicatorThreshold: 0,
      },
      perLap: [],
      stint: { overall: EMPTY_STATS, straight: EMPTY_STATS, corner: EMPTY_STATS },
      hasZones: false,
      lapsAnalysed: 0,
    };
  }

  // Common sampling frequency = min of the four (typically all 100 Hz).
  const freq = Math.min(vFL.freq, vFR.freq, vRL.freq, vRR.freq);
  if (!(freq > 0)) {
    return {
      available: false,
      reason: "no-samples",
      message: "Frequenza dei canali velocità ruota non valida.",
      thresholds: {
        vMinKmh: V_MIN_KMH,
        slipSignificantPct: SLIP_SIGNIFICANT_PCT,
        cornerIndicatorThreshold: 0,
      },
      perLap: [],
      stint: { overall: EMPTY_STATS, straight: EMPTY_STATS, corner: EMPTY_STATS },
      hasZones: false,
      lapsAnalysed: 0,
    };
  }

  const validLaps = laps.filter((l) => l.isValidLap);
  if (validLaps.length === 0) {
    return {
      available: false,
      reason: "no-valid-laps",
      message: "Nessun giro valido nello stint.",
      thresholds: {
        vMinKmh: V_MIN_KMH,
        slipSignificantPct: SLIP_SIGNIFICANT_PCT,
        cornerIndicatorThreshold: 0,
      },
      perLap: [],
      stint: { overall: EMPTY_STATS, straight: EMPTY_STATS, corner: EMPTY_STATS },
      hasZones: false,
      lapsAnalysed: 0,
    };
  }

  // First pass: collect corner indicators to derive the in-corner threshold.
  const cornerIndicators: number[] = [];
  for (const lap of validLaps) {
    const iStart = Math.max(0, Math.floor(lap.tStart * freq));
    const iEnd = Math.floor(lap.tEnd * freq);
    for (let i = iStart; i < iEnd; i++) {
      const t = i / freq;
      const a = sampleAt(vFL, t);
      const b = sampleAt(vFR, t);
      if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
      const vFront = (a + b) / 2;
      if (vFront < V_MIN_KMH) continue;
      cornerIndicators.push(Math.abs(a - b) / vFront);
    }
  }
  const cornerSorted = [...cornerIndicators].sort((x, y) => x - y);
  const cornerThresholdRaw = percentile(cornerSorted, 75);
  const cornerIndicatorThreshold =
    Number.isFinite(cornerThresholdRaw) && cornerThresholdRaw > 0
      ? cornerThresholdRaw
      : 0.02;

  // Second pass: per-lap slip stats, partitioned by corner indicator.
  const allSlip: number[] = [];
  const allStraight: number[] = [];
  const allCorner: number[] = [];
  const perLap: PerLapSlip[] = [];

  for (const lap of validLaps) {
    const iStart = Math.max(0, Math.floor(lap.tStart * freq));
    const iEnd = Math.floor(lap.tEnd * freq);
    const lapAll: number[] = [];
    const lapStraight: number[] = [];
    const lapCorner: number[] = [];
    for (let i = iStart; i < iEnd; i++) {
      const t = i / freq;
      const a = sampleAt(vFL, t);
      const b = sampleAt(vFR, t);
      const r1 = sampleAt(vRL, t);
      const r2 = sampleAt(vRR, t);
      if (
        !Number.isFinite(a) ||
        !Number.isFinite(b) ||
        !Number.isFinite(r1) ||
        !Number.isFinite(r2)
      )
        continue;
      const vFront = (a + b) / 2;
      if (vFront < V_MIN_KMH) continue;
      const vRear = (r1 + r2) / 2;
      const slip = ((vRear - vFront) / vFront) * 100;
      if (!Number.isFinite(slip)) continue;
      const cornerInd = Math.abs(a - b) / vFront;
      lapAll.push(slip);
      allSlip.push(slip);
      if (cornerInd >= cornerIndicatorThreshold) {
        lapCorner.push(slip);
        allCorner.push(slip);
      } else {
        lapStraight.push(slip);
        allStraight.push(slip);
      }
    }
    perLap.push({
      lap: lap.lap,
      overall: statsOf(lapAll, SLIP_SIGNIFICANT_PCT),
      straight: statsOf(lapStraight, SLIP_SIGNIFICANT_PCT),
      corner: statsOf(lapCorner, SLIP_SIGNIFICANT_PCT),
    });
  }

  if (allSlip.length === 0) {
    return {
      available: false,
      reason: "no-samples",
      message:
        "Nessun campione di slip utile: la soglia di velocità minima non è mai stata superata.",
      thresholds: {
        vMinKmh: V_MIN_KMH,
        slipSignificantPct: SLIP_SIGNIFICANT_PCT,
        cornerIndicatorThreshold,
      },
      perLap,
      stint: { overall: EMPTY_STATS, straight: EMPTY_STATS, corner: EMPTY_STATS },
      hasZones: false,
      lapsAnalysed: 0,
    };
  }

  // Zone exit slip on the fastest valid lap (reference). Reuses the existing
  // detectBrakingZones / resampleLapOnGrid infrastructure for the geometry.
  let zones: ZoneSlipExit[] | undefined;
  const refLap =
    laps.find((l) => l.isFastest && l.isValidLap) ?? validLaps[0];
  if (refLap && lapCh) {
    const refGrid = buildReferenceGrid(file, refLap);
    if (refGrid) {
      const ref = resampleLapOnGrid(file, refLap, refGrid.grid);
      if (ref) {
        const detectedZones = detectBrakingZones(ref);
        if (detectedZones.length > 0) {
          // Walk the reference lap in the time domain and bucket slip samples
          // by zone exit window [apexDist, endDist].
          const iStart = Math.max(0, Math.floor(refLap.tStart * freq));
          const iEnd = Math.floor(refLap.tEnd * freq);
          let dOrigin: number | undefined;
          for (let i = iStart; i < iEnd; i++) {
            const t = i / freq;
            const dv = sampleAt(lapCh, t);
            if (Number.isFinite(dv) && dv >= 0) {
              dOrigin = dv;
              break;
            }
          }
          if (dOrigin !== undefined) {
            const buckets: number[][] = detectedZones.map(() => []);
            for (let i = iStart; i < iEnd; i++) {
              const t = i / freq;
              const dv = sampleAt(lapCh, t);
              if (!Number.isFinite(dv)) continue;
              const d = dv - dOrigin;
              const a = sampleAt(vFL, t);
              const b = sampleAt(vFR, t);
              const r1 = sampleAt(vRL, t);
              const r2 = sampleAt(vRR, t);
              if (
                !Number.isFinite(a) ||
                !Number.isFinite(b) ||
                !Number.isFinite(r1) ||
                !Number.isFinite(r2)
              )
                continue;
              const vFront = (a + b) / 2;
              if (vFront < V_MIN_KMH) continue;
              const vRear = (r1 + r2) / 2;
              const slip = ((vRear - vFront) / vFront) * 100;
              if (!Number.isFinite(slip)) continue;
              for (let zi = 0; zi < detectedZones.length; zi++) {
                const z = detectedZones[zi];
                if (d >= z.apexDist && d <= z.endDist) buckets[zi].push(slip);
              }
            }
            zones = detectedZones.map((z, i) => {
              const sl = buckets[i];
              if (sl.length === 0) {
                return {
                  zone: z,
                  label: `T${i + 1}`,
                  meanSlip: NaN,
                  maxSlip: NaN,
                  fracOverThreshold: NaN,
                  count: 0,
                };
              }
              const sorted = [...sl].sort((x, y) => x - y);
              const mean = sl.reduce((acc, v) => acc + v, 0) / sl.length;
              let over = 0;
              for (const v of sl) if (v > SLIP_SIGNIFICANT_PCT) over++;
              return {
                zone: z,
                label: `T${i + 1}`,
                meanSlip: mean,
                maxSlip: sorted[sorted.length - 1],
                fracOverThreshold: over / sl.length,
                count: sl.length,
              };
            });
          }
        }
      }
    }
  }

  return {
    available: true,
    thresholds: {
      vMinKmh: V_MIN_KMH,
      slipSignificantPct: SLIP_SIGNIFICANT_PCT,
      cornerIndicatorThreshold,
    },
    perLap,
    stint: {
      overall: statsOf(allSlip, SLIP_SIGNIFICANT_PCT),
      straight: statsOf(allStraight, SLIP_SIGNIFICANT_PCT),
      corner: statsOf(allCorner, SLIP_SIGNIFICANT_PCT),
    },
    zones,
    hasZones: !!zones && zones.length > 0,
    lapsAnalysed: perLap.length,
  };
}
