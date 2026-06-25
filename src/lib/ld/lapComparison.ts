// Lap Comparison engine — spatially aligned comparison between a selected
// lap and the fastest valid lap of the stint.
//
// Assumptions / invariants:
//  - All channels are looked up via the logical-channel resolver. No
//    hard-coded MoTeC names; missing channels degrade gracefully.
//  - Per-channel sample indexing uses `Math.floor(t * channel.freq)`,
//    consistent with the rest of the codebase.
//  - The X axis is the lap distance (m), normalised so each lap starts at 0.
//  - Non-monotonic stretches of Lap Distance (resets, out-laps glitches)
//    are dropped before resampling.
//  - Time-per-zone is a STIMA derived from velocity integration; the file
//    does not contain ms-precision lap timing, so this is explicitly an
//    approximation and never presented as a real chrono.
//  - No invented thresholds: braking zones are anchored to a fraction of
//    the lap's OWN observed peak brake pressure (or, as fallback, to local
//    speed minima of the reference lap).

import type { Channel, LdFile } from "@/lib/ld/types";
import type { LapRow } from "@/lib/ld/stintAnalysis";
import { resolveChannel, type LogicalKey } from "@/lib/ld/channelResolver";
import { computeSlipOnGrid } from "@/lib/ld/slipFormula";


/* ============================ Public types ============================ */

export type ComparisonChannelKey =
  | "speed"
  | "throttle"
  | "brakePressFront"
  | "brakePressRear"
  | "steeringAngle"
  | "suspTravelFL"
  | "suspTravelFR"
  | "suspTravelRL"
  | "suspTravelRR"
  | "wheelSpeedFL"
  | "wheelSpeedFR"
  | "wheelSpeedRL"
  | "wheelSpeedRR"
  | "tyreTempFL"
  | "tyreTempFR"
  | "tyreTempRL"
  | "tyreTempRR"
  | "slip";



export interface ResampledLap {
  /** Common uniform distance grid (m). */
  grid: Float32Array;
  /** Per logical-channel resampled values aligned with `grid` (NaN where out of coverage).
   *  `slip` is CALCULATED, not resolved from a physical channel. */
  series: Partial<Record<ComparisonChannelKey, Float32Array>>;
  /** Observed lap distance length (m) — last monotonic distance value. */
  lapLength: number;
  /** Coverage fraction over the reference lap length (1 = full). */
  coverage: number;
  /** Per-grid-point flag (1=in corner, 0=straight) for the calculated slip.
   *  Present only when wheel speeds are available and a threshold was passed. */
  slipInCorner?: Uint8Array;
}


export interface BrakingZone {
  /** Progressive index, 1-based. */
  index: number;
  /** Distance (m) where braking starts. */
  startDist: number;
  /** Distance (m) of the practical apex (minimum speed in the zone). */
  apexDist: number;
  /** Distance (m) where the throttle reopens (zone end). */
  endDist: number;
  /** Minimum speed within the zone (km/h). NaN if speed not available. */
  vMin: number;
  /** True when the detection used the speed-minima fallback (no brake channel). */
  fromSpeed: boolean;
}

export interface ZoneDelta {
  zone: BrakingZone;
  /** Selected lap minimum speed inside [startDist, endDist] (km/h). NaN if missing. */
  selVMin: number;
  /** ΔvMin = selected - reference (km/h). */
  vMinDelta: number;
  /** Reference braking-start distance (m). */
  refBrakeDist: number;
  /** Selected braking-start distance (m); NaN if not detectable. */
  selBrakeDist: number;
  /** Δ braking point = selected - reference (m). Positive = selected brakes later. */
  brakeDistDelta: number;
  /** Estimated Δt (s) over the zone; positive = selected loses time. NaN if not computable. */
  dtEstimate: number;
}

export interface LapComparisonResult {
  kind: "ok" | "no-lap-distance" | "no-reference" | "self-comparison" | "no-coverage";
  /** Human-readable message when kind !== "ok". */
  message?: string;
  reference?: ResampledLap;
  selected?: ResampledLap;
  zones?: BrakingZone[];
  zoneDeltas?: ZoneDelta[];
  /** Sum of per-zone dtEstimate (s). */
  totalDtEstimate?: number;
  /** Which channels were actually resolved on the file. */
  availability: Partial<Record<ComparisonChannelKey, boolean>>;
  /** True when the selected lap covers < 70% of the reference distance. */
  partial?: boolean;
  /** Reference lap meta. */
  refLap?: LapRow;
  /** Selected lap meta. */
  selLap?: LapRow;
}

/* ============================ Constants ============================ */

const GRID_POINTS = 500;
export const BRAKE_PEAK_FRACTION = 0.18; // braking threshold = 18% of the lap's own peak
const THROTTLE_REOPEN_FRACTION = 0.5;
const MIN_ZONE_LENGTH_M = 25;
const PARTIAL_COVERAGE_THRESHOLD = 0.7;

const CHANNEL_KEYS: ComparisonChannelKey[] = [
  "speed",
  "throttle",
  "brakePressFront",
  "brakePressRear",
  "steeringAngle",
  "suspTravelFL",
  "suspTravelFR",
  "suspTravelRL",
  "suspTravelRR",
  "wheelSpeedFL",
  "wheelSpeedFR",
  "wheelSpeedRL",
  "wheelSpeedRR",
  "tyreTempFL",
  "tyreTempFR",
  "tyreTempRL",
  "tyreTempRR",
  // "slip" is intentionally NOT in CHANNEL_KEYS: it is a CALCULATED series
  // (not a physical channel), derived after resampling from the four wheel
  // speeds via tractionSlip.computeSlipOnGrid — single source of truth.
];

/** Map a ComparisonChannelKey to the resolver's LogicalKey.
 *  Most keys share the same identifier; suspension travel and tyre temp use a dotted form. */
function toLogicalKey(key: ComparisonChannelKey): LogicalKey {
  switch (key) {
    case "suspTravelFL": return "suspTravel.fl";
    case "suspTravelFR": return "suspTravel.fr";
    case "suspTravelRL": return "suspTravel.rl";
    case "suspTravelRR": return "suspTravel.rr";
    case "tyreTempFL": return "tyreTemp.fl";
    case "tyreTempFR": return "tyreTemp.fr";
    case "tyreTempRL": return "tyreTemp.rl";
    case "tyreTempRR": return "tyreTemp.rr";

    case "slip":
      // Should never be requested via the resolver path. Return any logical
      // key as a no-op; the slip series is computed, not resolved.
      return "speed";
    default: return key as LogicalKey;
  }
}


/* ============================ Helpers ============================ */

function isFinitePositive(v: number): boolean {
  return Number.isFinite(v) && v !== -1;
}

/** Sample a channel at absolute time `t` (seconds), `Math.floor` indexing. */
function sampleAt(ch: Channel, t: number): number {
  const i = Math.floor(t * ch.freq);
  if (i < 0 || i >= ch.values.length) return NaN;
  const v = ch.values[i];
  return isFinitePositive(v) ? v : NaN;
}

/** Build the monotonic (distance, value) pairs for a channel over [tStart, tEnd]
 *  using the lap-distance channel. Distance is normalised to start at 0.
 *  Non-monotonic stretches are dropped (only strictly-increasing distances kept). */
function buildDistanceSeries(
  ch: Channel,
  lapCh: Channel,
  tStart: number,
  tEnd: number,
): { d: number[]; y: number[] } {
  // Iterate on `ch`'s own sample grid; that's the only place values change.
  const i0 = Math.max(0, Math.floor(tStart * ch.freq));
  const i1 = Math.min(ch.values.length, Math.ceil(tEnd * ch.freq));
  if (i1 <= i0) return { d: [], y: [] };

  // First valid lap-distance value in the window: used as origin.
  let origin: number | undefined;
  for (let i = i0; i < i1; i++) {
    const t = i / ch.freq;
    const v = sampleAt(lapCh, t);
    if (Number.isFinite(v) && v >= 0) {
      origin = v;
      break;
    }
  }
  if (origin === undefined) return { d: [], y: [] };

  const d: number[] = [];
  const y: number[] = [];
  let lastD = -Infinity;
  for (let i = i0; i < i1; i++) {
    const yv = ch.values[i];
    if (!isFinitePositive(yv)) continue;
    const t = i / ch.freq;
    const dv = sampleAt(lapCh, t);
    if (!Number.isFinite(dv) || dv < 0) continue;
    const dn = dv - origin;
    if (dn <= lastD) continue; // drop non-monotonic stretches
    lastD = dn;
    d.push(dn);
    y.push(yv);
  }
  return { d, y };
}

/** Linear interpolation of (d,y) pairs (d strictly increasing) onto a uniform grid.
 *  Returns NaN for grid points outside coverage [d[0], d[last]]. */
function interpolateToGrid(
  d: number[],
  y: number[],
  grid: Float32Array,
): Float32Array {
  const out = new Float32Array(grid.length);
  if (d.length === 0) {
    out.fill(NaN);
    return out;
  }
  const dMin = d[0];
  const dMax = d[d.length - 1];
  let j = 0;
  for (let i = 0; i < grid.length; i++) {
    const x = grid[i];
    if (x < dMin || x > dMax) {
      out[i] = NaN;
      continue;
    }
    while (j < d.length - 2 && d[j + 1] < x) j++;
    const d0 = d[j];
    const d1 = d[j + 1];
    if (d1 === d0) {
      out[i] = y[j];
    } else {
      const t = (x - d0) / (d1 - d0);
      out[i] = y[j] + (y[j + 1] - y[j]) * t;
    }
  }
  return out;
}

/** Estimate the maximum monotonic distance reached during the lap (lap length, m). */
function estimateLapLength(lapCh: Channel, tStart: number, tEnd: number): number {
  const i0 = Math.max(0, Math.floor(tStart * lapCh.freq));
  const i1 = Math.min(lapCh.values.length, Math.ceil(tEnd * lapCh.freq));
  let origin: number | undefined;
  let last = 0;
  for (let i = i0; i < i1; i++) {
    const v = lapCh.values[i];
    if (!Number.isFinite(v) || v < 0) continue;
    if (origin === undefined) origin = v;
    const dn = v - origin;
    if (dn > last) last = dn;
  }
  return last;
}

/* ============================ Resampling ============================ */

/** Resample one lap onto a given uniform distance grid. The grid is expected
 *  to span [0, gridLength]; we report how much of it the lap actually covers. */
function resampleLap(
  file: LdFile,
  lap: LapRow,
  grid: Float32Array,
  lapCh: Channel,
  channels: Partial<Record<ComparisonChannelKey, Channel>>,
  cornerIndicatorThreshold?: number,
): ResampledLap {
  const lapLength = estimateLapLength(lapCh, lap.tStart, lap.tEnd);
  const series: Partial<Record<ComparisonChannelKey, Float32Array>> = {};
  for (const key of CHANNEL_KEYS) {
    const ch = channels[key];
    if (!ch) continue;
    const { d, y } = buildDistanceSeries(ch, lapCh, lap.tStart, lap.tEnd);
    series[key] = interpolateToGrid(d, y, grid);
  }
  // CALCULATED slip (not a physical channel): derived from the four resampled
  // wheel speeds via the shared formula in slipFormula.ts. Reuses the exact
  // same threshold (passed in from the stint-wide derivation) and the exact
  // same V_MIN_KMH guard as the aggregate Traction Slip panel.
  let slipInCorner: Uint8Array | undefined;
  if (cornerIndicatorThreshold !== undefined) {
    const slipRes = computeSlipOnGrid(
      series.wheelSpeedFL,
      series.wheelSpeedFR,
      series.wheelSpeedRL,
      series.wheelSpeedRR,
      cornerIndicatorThreshold,
    );
    if (slipRes) {
      series.slip = slipRes.slip;
      slipInCorner = slipRes.inCorner;
    }
  }
  const gridLength = grid[grid.length - 1] || 0;
  const coverage = gridLength > 0 ? Math.min(1, lapLength / gridLength) : 0;
  return { grid, series, lapLength, coverage, slipInCorner };
}


/* ============================ Braking zones ============================ */

/** Detect braking-anchored zones on a resampled reference lap.
 *  A zone starts when the combined brake pressure exceeds a fraction of the
 *  lap's own peak (no hard-coded absolute), and ends when the throttle
 *  reopens past half its lap peak. If no brake channel is available, falls
 *  back to local speed-minima detection. */
export function detectBrakingZones(ref: ResampledLap): BrakingZone[] {
  const grid = ref.grid;
  const n = grid.length;
  if (n < 4) return [];

  const speed = ref.series.speed;
  const throttle = ref.series.throttle;
  const pf = ref.series.brakePressFront;
  const pr = ref.series.brakePressRear;
  const hasBrake = !!(pf || pr);

  if (hasBrake) {
    // Combined brake pressure (max of available fronts/rears at each grid point).
    const brake = new Float32Array(n);
    let peak = 0;
    for (let i = 0; i < n; i++) {
      const a = pf ? pf[i] : NaN;
      const b = pr ? pr[i] : NaN;
      const v = Math.max(Number.isFinite(a) ? a : -Infinity, Number.isFinite(b) ? b : -Infinity);
      brake[i] = Number.isFinite(v) ? v : NaN;
      if (Number.isFinite(v) && v > peak) peak = v;
    }
    if (peak <= 0) return detectFromSpeed(ref);

    const thrPeak = peakOf(throttle);
    const brakeThr = peak * BRAKE_PEAK_FRACTION;
    const throttleReopen = thrPeak * THROTTLE_REOPEN_FRACTION;

    const zones: BrakingZone[] = [];
    let i = 0;
    while (i < n) {
      // Find zone start.
      if (!(brake[i] > brakeThr)) {
        i++;
        continue;
      }
      const startI = i;
      // Walk forward until throttle reopens past threshold AND brake released.
      let endI = startI;
      let releasedBrake = false;
      for (let k = startI; k < n; k++) {
        if (!(brake[k] > brakeThr)) releasedBrake = true;
        if (releasedBrake && throttle && Number.isFinite(throttle[k]) && throttle[k] > throttleReopen) {
          endI = k;
          break;
        }
        endI = k;
      }
      // Find apex (min speed) inside the zone.
      let apexI = startI;
      let vMin = Infinity;
      if (speed) {
        for (let k = startI; k <= endI; k++) {
          const v = speed[k];
          if (Number.isFinite(v) && v < vMin) {
            vMin = v;
            apexI = k;
          }
        }
      }
      const startD = grid[startI];
      const endD = grid[endI];
      if (endD - startD >= MIN_ZONE_LENGTH_M) {
        zones.push({
          index: zones.length + 1,
          startDist: startD,
          apexDist: grid[apexI],
          endDist: endD,
          vMin: Number.isFinite(vMin) ? vMin : NaN,
          fromSpeed: false,
        });
      }
      i = endI + 1;
    }
    if (zones.length > 0) return zones;
  }

  return detectFromSpeed(ref);
}

function peakOf(arr: Float32Array | undefined): number {
  if (!arr) return 0;
  let m = 0;
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i];
    if (Number.isFinite(v) && v > m) m = v;
  }
  return m;
}

/** Fallback: zones from speed local minima (significant drops). */
function detectFromSpeed(ref: ResampledLap): BrakingZone[] {
  const grid = ref.grid;
  const n = grid.length;
  const speed = ref.series.speed;
  if (!speed || n < 4) return [];
  const peak = peakOf(speed);
  if (peak <= 0) return [];

  // Smoothed delta to detect deceleration plateaus.
  const window = Math.max(3, Math.floor(n / 80));
  const minDropFraction = 0.18; // require local min to be at least 18% below local max
  const zones: BrakingZone[] = [];

  let i = 0;
  while (i < n) {
    // Look for a decelerating window: speed[i] starts dropping.
    let j = i + 1;
    while (j < n && (!Number.isFinite(speed[j]) || !Number.isFinite(speed[j - 1]) || speed[j] <= speed[j - 1])) {
      j++;
    }
    if (j - i < window) {
      i = j + 1;
      continue;
    }
    const localMax = Math.max(speed[i], speed[Math.max(0, i - window)]);
    let apexI = i;
    let vMin = Infinity;
    for (let k = i; k < j; k++) {
      if (Number.isFinite(speed[k]) && speed[k] < vMin) {
        vMin = speed[k];
        apexI = k;
      }
    }
    if (localMax - vMin >= localMax * minDropFraction && vMin > 0) {
      const startI = i;
      const endI = Math.min(n - 1, j);
      if (grid[endI] - grid[startI] >= MIN_ZONE_LENGTH_M) {
        zones.push({
          index: zones.length + 1,
          startDist: grid[startI],
          apexDist: grid[apexI],
          endDist: grid[endI],
          vMin,
          fromSpeed: true,
        });
      }
    }
    i = j;
  }
  return zones;
}

/* ============================ Zone deltas ============================ */

function indexAtDistance(grid: Float32Array, d: number): number {
  // grid uniform → direct math; clamped.
  if (grid.length < 2) return 0;
  const step = grid[1] - grid[0];
  if (step <= 0) return 0;
  const i = Math.round((d - grid[0]) / step);
  return Math.max(0, Math.min(grid.length - 1, i));
}

function computeZoneDelta(
  zone: BrakingZone,
  ref: ResampledLap,
  sel: ResampledLap,
  brakeThrFraction: number,
): ZoneDelta {
  const i0 = indexAtDistance(ref.grid, zone.startDist);
  const i1 = indexAtDistance(ref.grid, zone.endDist);
  const selSpeed = sel.series.speed;
  const refSpeed = ref.series.speed;

  // Min speed of selected over [startDist, endDist]
  let selVMin = Infinity;
  if (selSpeed) {
    for (let k = i0; k <= i1; k++) {
      const v = selSpeed[k];
      if (Number.isFinite(v) && v < selVMin) selVMin = v;
    }
  }
  if (!Number.isFinite(selVMin)) selVMin = NaN;
  const vMinDelta = Number.isFinite(zone.vMin) && Number.isFinite(selVMin) ? selVMin - zone.vMin : NaN;

  // Selected braking start: first point in window where brake exceeds the SAME
  // fractional threshold derived from the SELECTED lap's own peak.
  let selBrakeDist = NaN;
  const selPf = sel.series.brakePressFront;
  const selPr = sel.series.brakePressRear;
  if (selPf || selPr) {
    let selPeak = 0;
    for (let k = 0; k < sel.grid.length; k++) {
      const a = selPf ? selPf[k] : NaN;
      const b = selPr ? selPr[k] : NaN;
      const v = Math.max(Number.isFinite(a) ? a : -Infinity, Number.isFinite(b) ? b : -Infinity);
      if (Number.isFinite(v) && v > selPeak) selPeak = v;
    }
    const thr = selPeak * brakeThrFraction;
    for (let k = i0; k <= i1; k++) {
      const a = selPf ? selPf[k] : NaN;
      const b = selPr ? selPr[k] : NaN;
      const v = Math.max(Number.isFinite(a) ? a : -Infinity, Number.isFinite(b) ? b : -Infinity);
      if (Number.isFinite(v) && v > thr) {
        selBrakeDist = sel.grid[k];
        break;
      }
    }
  }
  const brakeDistDelta = Number.isFinite(selBrakeDist) ? selBrakeDist - zone.startDist : NaN;

  // Δt estimate: Σ (1/v_sel - 1/v_ref) · Δs, with v in m/s.
  let dt = 0;
  let ok = false;
  if (refSpeed && selSpeed && sel.grid.length >= 2) {
    const ds = sel.grid[1] - sel.grid[0];
    for (let k = i0; k < i1; k++) {
      const vr = refSpeed[k];
      const vs = selSpeed[k];
      if (!Number.isFinite(vr) || !Number.isFinite(vs) || vr <= 1 || vs <= 1) continue;
      const vrMs = vr / 3.6;
      const vsMs = vs / 3.6;
      dt += (1 / vsMs - 1 / vrMs) * ds;
      ok = true;
    }
  }

  return {
    zone,
    selVMin,
    vMinDelta,
    refBrakeDist: zone.startDist,
    selBrakeDist,
    brakeDistDelta,
    dtEstimate: ok ? dt : NaN,
  };
}

/* ============================ Top-level builder ============================ */

export function buildLapComparison(
  file: LdFile,
  refLap: LapRow | null,
  selLap: LapRow | null,
  opts?: { cornerIndicatorThreshold?: number },
): LapComparisonResult {

  const channels: Partial<Record<ComparisonChannelKey, Channel>> = {};
  const availability: Partial<Record<ComparisonChannelKey, boolean>> = {};
  for (const key of CHANNEL_KEYS) {
    const ch = resolveChannel(file.channels, toLogicalKey(key));
    if (ch) {
      channels[key] = ch;
      availability[key] = true;
    } else {
      availability[key] = false;
    }
  }

  const lapCh = resolveChannel(file.channels, "lapDistance");
  if (!lapCh) {
    return {
      kind: "no-lap-distance",
      message: "Confronto spaziale non disponibile: canale Lap Distance assente.",
      availability,
    };
  }

  if (!refLap) {
    return {
      kind: "no-reference",
      message: "Nessun giro più veloce valido disponibile come riferimento.",
      availability,
    };
  }
  if (!selLap) {
    return {
      kind: "no-reference",
      message: "Seleziona un giro per il confronto.",
      availability,
    };
  }
  if (refLap.lap === selLap.lap) {
    return {
      kind: "self-comparison",
      message: "Il giro selezionato È il giro di riferimento (fastest dello stint).",
      availability,
      refLap,
      selLap,
    };
  }

  // Build the reference grid from the reference lap's measured length.
  const refLength = estimateLapLength(lapCh, refLap.tStart, refLap.tEnd);
  if (!(refLength > 0)) {
    return {
      kind: "no-coverage",
      message: "Lap Distance non monotòna sul giro di riferimento: confronto non disponibile.",
      availability,
      refLap,
      selLap,
    };
  }
  const grid = new Float32Array(GRID_POINTS);
  const step = refLength / (GRID_POINTS - 1);
  for (let i = 0; i < GRID_POINTS; i++) grid[i] = i * step;

  const cornerThr = opts?.cornerIndicatorThreshold;
  const reference = resampleLap(file, refLap, grid, lapCh, channels, cornerThr);
  const selected = resampleLap(file, selLap, grid, lapCh, channels, cornerThr);


  const partial = selected.coverage < PARTIAL_COVERAGE_THRESHOLD;

  const zones = detectBrakingZones(reference);
  const zoneDeltas = zones.map((z) =>
    computeZoneDelta(z, reference, selected, BRAKE_PEAK_FRACTION),
  );
  const totalDtEstimate = zoneDeltas.reduce(
    (acc, d) => (Number.isFinite(d.dtEstimate) ? acc + d.dtEstimate : acc),
    0,
  );

  return {
    kind: "ok",
    reference,
    selected,
    zones,
    zoneDeltas,
    totalDtEstimate,
    availability,
    partial,
    refLap,
    selLap,
  };
}

/* ============================ Plot helpers ============================ */

export interface OverlayPoint {
  x: number;
  ref?: number;
  sel?: number;
}

/** Build overlay points for a given channel key with peak-preserving
 *  decimation down to ~target points (default 700). */
export function buildOverlay(
  result: LapComparisonResult,
  key: ComparisonChannelKey,
  target = 700,
): OverlayPoint[] {
  if (result.kind !== "ok" || !result.reference || !result.selected) return [];
  const ref = result.reference.series[key];
  const sel = result.selected.series[key];
  if (!ref && !sel) return [];
  const grid = result.reference.grid;
  const n = grid.length;
  if (n === 0) return [];

  const buckets = Math.min(target, n);
  const bucketSize = n / buckets;
  const out: OverlayPoint[] = [];
  for (let b = 0; b < buckets; b++) {
    const s = Math.floor(b * bucketSize);
    const e = Math.min(n, Math.floor((b + 1) * bucketSize));
    if (e <= s) continue;
    // Pick the index whose ref value most deviates from the bucket mean (peak-preserving).
    let bestI = s;
    if (ref) {
      let sum = 0;
      let cnt = 0;
      for (let i = s; i < e; i++) {
        if (Number.isFinite(ref[i])) {
          sum += ref[i];
          cnt++;
        }
      }
      const mean = cnt > 0 ? sum / cnt : 0;
      let bestAbs = -Infinity;
      for (let i = s; i < e; i++) {
        if (!Number.isFinite(ref[i])) continue;
        const dev = Math.abs(ref[i] - mean);
        if (dev > bestAbs) {
          bestAbs = dev;
          bestI = i;
        }
      }
    } else {
      bestI = Math.floor((s + e) / 2);
    }
    const p: OverlayPoint = { x: grid[bestI] };
    if (ref && Number.isFinite(ref[bestI])) p.ref = ref[bestI];
    if (sel && Number.isFinite(sel[bestI])) p.sel = sel[bestI];
    out.push(p);
  }
  return out;
}

/* ============================ Reusable resampling API ============================ */

/** Resolve the comparison channels on a file (logical keys only). */
export function resolveComparisonChannels(
  file: LdFile,
): Partial<Record<ComparisonChannelKey, Channel>> {
  const out: Partial<Record<ComparisonChannelKey, Channel>> = {};
  for (const key of CHANNEL_KEYS) {
    const ch = resolveChannel(file.channels, toLogicalKey(key));
    if (ch) out[key] = ch;
  }
  return out;
}

/** Build a uniform distance grid [0..lapLength] sampled at GRID_POINTS points
 *  from the reference lap's measured monotonic distance. */
export function buildReferenceGrid(
  file: LdFile,
  refLap: LapRow,
): { grid: Float32Array; lapLength: number; lapCh: Channel } | null {
  const lapCh = resolveChannel(file.channels, "lapDistance");
  if (!lapCh) return null;
  const lapLength = estimateLapLength(lapCh, refLap.tStart, refLap.tEnd);
  if (!(lapLength > 0)) return null;
  const grid = new Float32Array(GRID_POINTS);
  const step = lapLength / (GRID_POINTS - 1);
  for (let i = 0; i < GRID_POINTS; i++) grid[i] = i * step;
  return { grid, lapLength, lapCh };
}

/** Resample any lap onto a pre-built reference grid. Returns null if the
 *  Lap Distance channel is missing. Reuses the same internal sampler as
 *  buildLapComparison. */
export function resampleLapOnGrid(
  file: LdFile,
  lap: LapRow,
  grid: Float32Array,
  channels?: Partial<Record<ComparisonChannelKey, Channel>>,
): ResampledLap | null {
  const lapCh = resolveChannel(file.channels, "lapDistance");
  if (!lapCh) return null;
  const ch = channels ?? resolveComparisonChannels(file);
  return resampleLap(file, lap, grid, lapCh, ch);
}




