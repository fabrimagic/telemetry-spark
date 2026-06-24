// Driving Consistency engine — measures how repeatable the driver is across a
// stint and whether the signature drifts between the first and second half of
// the stint.
//
// Assumptions / invariants:
//  - The per-zone aggregated signature comes from `buildBrakingSignature`
//    (NO duplicated detection logic, NO duplicated per-lap metrics). Zones
//    are anchored to the fastest valid lap and projected by distance.
//  - The "spatial dispersion" view simply surfaces the std fields already
//    aggregated in the SignatureRow plus a coefficient of variation
//    (CV = std / |mean|) for vMin and brakePoint. CV is declared as a
//    dimensionless statistic, NOT an arbitrary score.
//  - The "temporal drift" view splits the chronological list of VALID laps
//    in two contiguous blocks: first half and second half. When the count
//    is odd the middle lap goes into the FIRST half (explicit convention).
//    Per-half mean/std are computed for vMin, brakePointDist and (when
//    available) throttleReopenDist / throttleReopenGradient by re-running
//    `metricsForLap` (re-exported from brakingSignature.ts) on each lap.
//  - When the result kind from buildBrakingSignature is not "ok", we
//    propagate the same message. When valid laps < 4 we only return the
//    spatial part and flag that the temporal drift is not computable.
//  - No invented thresholds: only sample statistics and per-zone deltas.
//    The engineer reads the numbers; the engine does not diagnose.

import type { LdFile } from "@/lib/ld/types";
import type { LapRow, AbsHit } from "@/lib/ld/stintAnalysis";
import {
  buildBrakingSignature,
  metricsForLap,
  type BrakingSignatureResult,
  type PerLapZoneEntry,
  type SignatureRow,
} from "@/lib/ld/brakingSignature";
import {
  buildReferenceGrid,
  resampleLapOnGrid,
  resolveComparisonChannels,
  type BrakingZone,
  type ResampledLap,
} from "@/lib/ld/lapComparison";

/* ============================ Public types ============================ */

export interface HalfStat {
  mean: number;
  std: number;
  n: number;
}

export interface MetricDrift {
  available: boolean;
  first: HalfStat;
  second: HalfStat;
  /** second.mean - first.mean */
  deltaMean: number;
  /** second.std - first.std */
  deltaStd: number;
}

export interface ZoneDrift {
  zoneIndex: number;
  label: string;
  vMin: MetricDrift;
  brakePointDist: MetricDrift;
  throttleReopenDist: MetricDrift;
  throttleReopenGradient: MetricDrift;
}

export interface SpatialDispersionRow {
  zoneIndex: number;
  label: string;
  zone: BrakingZone;
  lapsAnalysed: number;
  vMinStd: number;
  brakePointStd: number;
  releaseLengthStd: number;
  throttleReopenStd: number;
  /** CV = std / |mean| (dimensionless). NaN when not computable. */
  vMinCV: number;
  brakePointCV: number;
  /** Raw per-lap measured values forwarded from the SignatureRow, used by
   *  the box-plot panel to compute REAL quartiles. Same chronological order
   *  as BrakingSignatureResult.validLapNumbers; values are undefined when the
   *  lap did not yield a usable sample (never interpolated). */
  perLapValues: PerLapZoneEntry[];
}

export interface ConsistencySummary {
  lapsAnalysed: number;
  firstHalfLaps: number[];
  secondHalfLaps: number[];
  /** Zone index with highest combined CV (vMin + brakePoint), or null. */
  leastConsistentZone: { zoneIndex: number; label: string } | null;
  /** Zone with the largest magnitude vMin drift between halves, or null. */
  biggestDriftZone: { zoneIndex: number; label: string; deltaVmin: number } | null;
}

export interface DrivingConsistencyResult {
  kind: BrakingSignatureResult["kind"];
  message?: string;
  refLap?: LapRow;
  refLapLength?: number;
  hasThrottle: boolean;
  hasAbs: boolean;
  /** Always present when kind === "ok". */
  spatial?: SpatialDispersionRow[];
  /** Present only when valid laps >= 4. */
  drift?: ZoneDrift[];
  /** True when valid laps were too few (<4) to split. */
  driftSkipped?: boolean;
  driftSkippedReason?: string;
  summary?: ConsistencySummary;
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
function halfStat(xs: number[]): HalfStat {
  const clean = xs.filter((v) => Number.isFinite(v));
  return { mean: mean(clean), std: std(clean), n: clean.length };
}
function cv(m: number, s: number): number {
  if (!Number.isFinite(m) || !Number.isFinite(s) || Math.abs(m) < 1e-9) return NaN;
  return s / Math.abs(m);
}
function emptyDrift(): MetricDrift {
  const empty: HalfStat = { mean: NaN, std: NaN, n: 0 };
  return { available: false, first: empty, second: empty, deltaMean: NaN, deltaStd: NaN };
}
function makeDrift(first: number[], second: number[]): MetricDrift {
  const f = halfStat(first);
  const s = halfStat(second);
  const available = f.n >= 1 && s.n >= 1;
  return {
    available,
    first: f,
    second: s,
    deltaMean: available ? s.mean - f.mean : NaN,
    deltaStd: Number.isFinite(f.std) && Number.isFinite(s.std) ? s.std - f.std : NaN,
  };
}

/* ============================ Main builder ============================ */

export function buildDrivingConsistency(
  file: LdFile,
  laps: LapRow[],
  absHits: AbsHit[],
  hasAbsChannel: boolean,
): DrivingConsistencyResult {
  const sig = buildBrakingSignature(file, laps, absHits, hasAbsChannel);

  if (sig.kind !== "ok" || !sig.rows || sig.rows.length === 0 || !sig.refLap) {
    return {
      kind: sig.kind,
      message: sig.message,
      hasThrottle: sig.hasThrottle,
      hasAbs: sig.hasAbs,
      refLap: sig.refLap,
      refLapLength: sig.refLapLength,
    };
  }

  // Part 1 — spatial dispersion view from the already-aggregated SignatureRows.
  const spatial: SpatialDispersionRow[] = sig.rows.map((r: SignatureRow) => ({
    zoneIndex: r.zone.index,
    label: r.label,
    zone: r.zone,
    lapsAnalysed: r.lapsAnalysed,
    vMinStd: r.vMin.std,
    brakePointStd: r.brakePointDist.std,
    releaseLengthStd: r.releaseLength.std,
    throttleReopenStd: r.throttleReopenDist.std,
    vMinCV: cv(r.vMin.mean, r.vMin.std),
    brakePointCV: cv(r.brakePointDist.mean, r.brakePointDist.std),
  }));

  // Part 2 — temporal drift first half vs second half.
  const validLaps = laps.filter((l) => l.isValidLap);
  const MIN_LAPS_FOR_DRIFT = 4;

  if (validLaps.length < MIN_LAPS_FOR_DRIFT) {
    const summary: ConsistencySummary = buildSummary(spatial, []);
    return {
      kind: "ok",
      hasThrottle: sig.hasThrottle,
      hasAbs: sig.hasAbs,
      refLap: sig.refLap,
      refLapLength: sig.refLapLength,
      spatial,
      driftSkipped: true,
      driftSkippedReason: `Deriva temporale non calcolabile: servono almeno ${MIN_LAPS_FOR_DRIFT} giri validi (presenti: ${validLaps.length}).`,
      summary,
    };
  }

  // Re-derive the resampling pipeline (matches buildBrakingSignature exactly).
  const channels = resolveComparisonChannels(file);
  const refGrid = buildReferenceGrid(file, sig.refLap);
  if (!refGrid) {
    return {
      kind: "ok",
      hasThrottle: sig.hasThrottle,
      hasAbs: sig.hasAbs,
      refLap: sig.refLap,
      refLapLength: sig.refLapLength,
      spatial,
      driftSkipped: true,
      driftSkippedReason: "Deriva temporale non calcolabile: griglia di riferimento non disponibile.",
      summary: buildSummary(spatial, []),
    };
  }

  // Convention: odd middle lap goes to the FIRST half.
  const splitIndex = Math.ceil(validLaps.length / 2);
  const firstLaps = validLaps.slice(0, splitIndex);
  const secondLaps = validLaps.slice(splitIndex);

  const resampleAll = (subset: LapRow[]): ResampledLap[] =>
    subset
      .map((l) => resampleLapOnGrid(file, l, refGrid.grid, channels))
      .filter((r): r is ResampledLap => r !== null);

  const firstRes = resampleAll(firstLaps);
  const secondRes = resampleAll(secondLaps);

  const zones = sig.rows.map((r) => r.zone);
  const drift: ZoneDrift[] = zones.map((zone, idx) => {
    const fMetrics = firstRes
      .map((lap) => metricsForLap(lap, zone, sig.hasThrottle))
      .filter((m): m is NonNullable<ReturnType<typeof metricsForLap>> => m !== undefined);
    const sMetrics = secondRes
      .map((lap) => metricsForLap(lap, zone, sig.hasThrottle))
      .filter((m): m is NonNullable<ReturnType<typeof metricsForLap>> => m !== undefined);

    const vMin = makeDrift(fMetrics.map((m) => m.vMin), sMetrics.map((m) => m.vMin));
    const brakePointDist = makeDrift(
      fMetrics.map((m) => m.brakePointDist),
      sMetrics.map((m) => m.brakePointDist),
    );
    const throttleReopenDist = sig.hasThrottle
      ? makeDrift(
          fMetrics.map((m) => m.throttleReopenDist),
          sMetrics.map((m) => m.throttleReopenDist),
        )
      : emptyDrift();
    const throttleReopenGradient = sig.hasThrottle
      ? makeDrift(
          fMetrics.map((m) => m.throttleReopenGradient),
          sMetrics.map((m) => m.throttleReopenGradient),
        )
      : emptyDrift();

    return {
      zoneIndex: zone.index,
      label: sig.rows![idx].label,
      vMin,
      brakePointDist,
      throttleReopenDist,
      throttleReopenGradient,
    };
  });

  const summary = buildSummary(spatial, drift, validLaps, firstLaps, secondLaps);

  return {
    kind: "ok",
    hasThrottle: sig.hasThrottle,
    hasAbs: sig.hasAbs,
    refLap: sig.refLap,
    refLapLength: sig.refLapLength,
    spatial,
    drift,
    summary,
  };
}

function buildSummary(
  spatial: SpatialDispersionRow[],
  drift: ZoneDrift[],
  validLaps?: LapRow[],
  firstLaps?: LapRow[],
  secondLaps?: LapRow[],
): ConsistencySummary {
  let leastConsistent: { zoneIndex: number; label: string } | null = null;
  let worstScore = -Infinity;
  for (const r of spatial) {
    const a = Number.isFinite(r.vMinCV) ? r.vMinCV : 0;
    const b = Number.isFinite(r.brakePointCV) ? r.brakePointCV : 0;
    const score = a + b;
    if (Number.isFinite(score) && score > worstScore) {
      worstScore = score;
      leastConsistent = { zoneIndex: r.zoneIndex, label: r.label };
    }
  }

  let biggestDrift: { zoneIndex: number; label: string; deltaVmin: number } | null = null;
  let maxMag = -Infinity;
  for (const d of drift) {
    if (!d.vMin.available) continue;
    const mag = Math.abs(d.vMin.deltaMean);
    if (Number.isFinite(mag) && mag > maxMag) {
      maxMag = mag;
      biggestDrift = { zoneIndex: d.zoneIndex, label: d.label, deltaVmin: d.vMin.deltaMean };
    }
  }

  return {
    lapsAnalysed: validLaps?.length ?? 0,
    firstHalfLaps: (firstLaps ?? []).map((l) => l.lap),
    secondHalfLaps: (secondLaps ?? []).map((l) => l.lap),
    leastConsistentZone: leastConsistent,
    biggestDriftZone: biggestDrift,
  };
}
