// G-G Diagram engine — friction footprint from the measured IMU/chassis
// accelerations (longitudinal vs lateral).
//
// Anti-hallucination discipline (mandatory):
//   • The diagram shows ONLY measured samples. No invented "theoretical max
//     grip" reference, no synthetic ellipse, no automatic diagnosis.
//   • The envelope reported is the observed envelope of the data; empty
//     regions of the plot mean "this G combination was not reached" — the
//     interpretation (margin? driving style?) is left to the engineer.
//
// Sign conventions verified on the project's reference .ld files:
//   • sclu acc x (50 Hz, G): longitudinal — NEGATIVE = braking, POSITIVE =
//     acceleration. Observed range ~ −1.6 … +0.9 G (physically correct
//     asymmetry: braking peaks larger in magnitude than acceleration).
//   • sclu acc y (50 Hz, G): lateral — symmetric (~±1.5 G).
//   • A parallel IMU set (accx/accy at 100 Hz) is the fallback. NEVER use
//     acc z (vertical, gravity) for the G-G diagram.

import { resolveChannel } from "@/lib/ld/channelResolver";
import type { Channel, LdFile } from "@/lib/ld/types";
import type { LapRow } from "@/lib/ld/stintAnalysis";

export interface GGPoint {
  /** Lateral acceleration (G), positive = right, negative = left. */
  lat: number;
  /** Longitudinal acceleration (G), positive = accel, negative = brake. */
  long: number;
}

export interface GGDensityCell {
  /** Cell-center lateral G. */
  x: number;
  /** Cell-center longitudinal G. */
  y: number;
  count: number;
}

export interface GGDensity {
  cellSize: number;
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  maxCount: number;
  cells: GGDensityCell[];
}

export interface GGEnvelope {
  /** Strongest braking observed (|min accLong|, reported as positive G). */
  maxBrake: number;
  /** Strongest acceleration observed (max accLong, G). */
  maxAccel: number;
  /** Strongest left-cornering G observed (|min accLat|, reported as positive). */
  maxLatLeft: number;
  /** Strongest right-cornering G observed (max accLat, G). */
  maxLatRight: number;
  /** Maximum combined G observed: max √(lat² + long²). */
  maxCombined: number;
  /** Fraction of samples whose combined G exceeds `combinedThreshold` (0..1). */
  fractionAboveThreshold: number;
  /** Threshold used (derived from data, NOT a theoretical reference): 0.8 × maxCombined. */
  combinedThreshold: number;
}

export type GGUnavailableReason =
  | "missing-acclong"
  | "missing-acclat"
  | "missing-both"
  | "no-laps"
  | "no-samples";

export interface GGResult {
  available: boolean;
  reason?: GGUnavailableReason;
  /** Logical source description (e.g. "sclu acc x/y @ 50 Hz"). */
  source?: string;
  /** Total samples actually used after sentinel/non-finite filtering. */
  pointCount: number;
  /** Decimated scatter (for "single lap" mode or the aggregate fallback). */
  pointsDecimated: GGPoint[];
  /** Density grid built from ALL points (no decimation), for the aggregate heatmap. */
  density: GGDensity;
  envelope: GGEnvelope;
  /** Common sampling rate (Hz) used to align the two acc channels. */
  sampleRateHz: number;
}

export interface BuildGGOptions {
  /** Target maximum scatter points after uniform decimation. Default 3000. */
  maxScatter?: number;
  /** Density grid cell size in G. Default 0.1. */
  cellSize?: number;
}

const EMPTY_DENSITY: GGDensity = {
  cellSize: 0.1,
  xMin: 0,
  xMax: 0,
  yMin: 0,
  yMax: 0,
  maxCount: 0,
  cells: [],
};

const EMPTY_ENVELOPE: GGEnvelope = {
  maxBrake: 0,
  maxAccel: 0,
  maxLatLeft: 0,
  maxLatRight: 0,
  maxCombined: 0,
  fractionAboveThreshold: 0,
  combinedThreshold: 0,
};

function isFiniteSample(v: number): boolean {
  return Number.isFinite(v) && v !== -1;
}

function describeSource(latCh: Channel, lonCh: Channel, freq: number): string {
  const latName = latCh.name.trim();
  const lonName = lonCh.name.trim();
  if (latName === lonName) return `${latName} @ ${freq} Hz`;
  return `${lonName} / ${latName} @ ${freq} Hz`;
}

/**
 * Build a G-G diagram for the supplied set of laps.
 *
 * Pass all valid laps for the aggregate panel, or `[singleLap]` for the
 * per-lap drill-down. If either channel is missing, the result is marked
 * unavailable with a neutral reason — the caller is expected to render a
 * neutral "data non disponibile" message.
 */
export function buildGGDiagram(
  file: LdFile,
  laps: LapRow[],
  opts: BuildGGOptions = {},
): GGResult {
  const maxScatter = Math.max(100, opts.maxScatter ?? 3000);
  const cellSize = opts.cellSize && opts.cellSize > 0 ? opts.cellSize : 0.1;

  const longCh = resolveChannel(file.channels, "accLong");
  const latCh = resolveChannel(file.channels, "accLat");

  if (!longCh && !latCh) {
    return {
      available: false,
      reason: "missing-both",
      pointCount: 0,
      pointsDecimated: [],
      density: { ...EMPTY_DENSITY, cellSize },
      envelope: EMPTY_ENVELOPE,
      sampleRateHz: 0,
    };
  }
  if (!longCh) {
    return {
      available: false,
      reason: "missing-acclong",
      pointCount: 0,
      pointsDecimated: [],
      density: { ...EMPTY_DENSITY, cellSize },
      envelope: EMPTY_ENVELOPE,
      sampleRateHz: 0,
    };
  }
  if (!latCh) {
    return {
      available: false,
      reason: "missing-acclat",
      pointCount: 0,
      pointsDecimated: [],
      density: { ...EMPTY_DENSITY, cellSize },
      envelope: EMPTY_ENVELOPE,
      sampleRateHz: 0,
    };
  }
  if (laps.length === 0) {
    return {
      available: false,
      reason: "no-laps",
      pointCount: 0,
      pointsDecimated: [],
      density: { ...EMPTY_DENSITY, cellSize },
      envelope: EMPTY_ENVELOPE,
      sampleRateHz: 0,
      source: describeSource(latCh, longCh, Math.min(latCh.freq, longCh.freq) || 0),
    };
  }

  const fLong = longCh.freq || 1;
  const fLat = latCh.freq || 1;
  // Align on the slower of the two channels to avoid oversampling.
  const baseFreq = Math.min(fLong, fLat);
  if (baseFreq <= 0) {
    return {
      available: false,
      reason: "no-samples",
      pointCount: 0,
      pointsDecimated: [],
      density: { ...EMPTY_DENSITY, cellSize },
      envelope: EMPTY_ENVELOPE,
      sampleRateHz: 0,
      source: describeSource(latCh, longCh, 0),
    };
  }

  // Single O(n) sweep through every lap window: collect (lat, long) into a
  // typed buffer; running min/max for envelope; density bins counted in a
  // Map keyed by (ix, iy). Memory bounded by sample count, no quadratic work.
  const latVals: number[] = [];
  const longVals: number[] = [];
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLong = Infinity;
  let maxLong = -Infinity;
  let maxCombined = 0;

  for (const lap of laps) {
    const tStart = lap.tStart;
    const tEnd = lap.tEnd;
    if (!(tEnd > tStart)) continue;
    const i0 = Math.max(0, Math.floor(tStart * baseFreq));
    const i1 = Math.min(
      Math.ceil(tEnd * baseFreq),
      Math.floor(Math.min(longCh.values.length / fLong, latCh.values.length / fLat) * baseFreq),
    );
    for (let i = i0; i < i1; i++) {
      const t = i / baseFreq;
      const iLong = Math.floor(t * fLong);
      const iLat = Math.floor(t * fLat);
      if (iLong < 0 || iLong >= longCh.values.length) continue;
      if (iLat < 0 || iLat >= latCh.values.length) continue;
      const yL = longCh.values[iLong];
      const xL = latCh.values[iLat];
      if (!isFiniteSample(yL) || !isFiniteSample(xL)) continue;
      latVals.push(xL);
      longVals.push(yL);
      if (xL < minLat) minLat = xL;
      if (xL > maxLat) maxLat = xL;
      if (yL < minLong) minLong = yL;
      if (yL > maxLong) maxLong = yL;
      const comb = Math.hypot(xL, yL);
      if (comb > maxCombined) maxCombined = comb;
    }
  }

  const n = latVals.length;
  if (n === 0) {
    return {
      available: false,
      reason: "no-samples",
      pointCount: 0,
      pointsDecimated: [],
      density: { ...EMPTY_DENSITY, cellSize },
      envelope: EMPTY_ENVELOPE,
      sampleRateHz: baseFreq,
      source: describeSource(latCh, longCh, baseFreq),
    };
  }

  // Density grid: snap min/max to cellSize multiples, then count.
  const xMin = Math.floor(minLat / cellSize) * cellSize;
  const xMax = Math.ceil(maxLat / cellSize) * cellSize;
  const yMin = Math.floor(minLong / cellSize) * cellSize;
  const yMax = Math.ceil(maxLong / cellSize) * cellSize;
  const nx = Math.max(1, Math.round((xMax - xMin) / cellSize));
  const ny = Math.max(1, Math.round((yMax - yMin) / cellSize));
  const grid = new Int32Array(nx * ny);
  for (let i = 0; i < n; i++) {
    let ix = Math.floor((latVals[i] - xMin) / cellSize);
    let iy = Math.floor((longVals[i] - yMin) / cellSize);
    if (ix < 0) ix = 0;
    else if (ix >= nx) ix = nx - 1;
    if (iy < 0) iy = 0;
    else if (iy >= ny) iy = ny - 1;
    grid[iy * nx + ix]++;
  }
  let maxCount = 0;
  const cells: GGDensityCell[] = [];
  for (let iy = 0; iy < ny; iy++) {
    for (let ix = 0; ix < nx; ix++) {
      const c = grid[iy * nx + ix];
      if (c === 0) continue;
      if (c > maxCount) maxCount = c;
      cells.push({
        x: xMin + (ix + 0.5) * cellSize,
        y: yMin + (iy + 0.5) * cellSize,
        count: c,
      });
    }
  }

  // Uniform stride decimation for the scatter view.
  const stride = Math.max(1, Math.ceil(n / maxScatter));
  const pointsDecimated: GGPoint[] = [];
  for (let i = 0; i < n; i += stride) {
    pointsDecimated.push({ lat: latVals[i], long: longVals[i] });
  }

  const combinedThreshold = 0.8 * maxCombined;
  let above = 0;
  if (combinedThreshold > 0) {
    for (let i = 0; i < n; i++) {
      if (Math.hypot(latVals[i], longVals[i]) >= combinedThreshold) above++;
    }
  }

  return {
    available: true,
    source: describeSource(latCh, longCh, baseFreq),
    pointCount: n,
    pointsDecimated,
    density: { cellSize, xMin, xMax, yMin, yMax, maxCount, cells },
    envelope: {
      maxBrake: Math.max(0, -minLong),
      maxAccel: Math.max(0, maxLong),
      maxLatLeft: Math.max(0, -minLat),
      maxLatRight: Math.max(0, maxLat),
      maxCombined,
      combinedThreshold,
      fractionAboveThreshold: n > 0 ? above / n : 0,
    },
    sampleRateHz: baseFreq,
  };
}
