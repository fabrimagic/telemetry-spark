import type { Channel, Lap, LdFile } from "@/lib/ld/types";
import { norm } from "@/lib/ld/sessionDebrief";

/**
 * Lap timing recovered from the 100 Hz "lap time prev" channel, cross-checked
 * against the .ldx summary (Fastest Time, Total Laps).
 *
 * The raw channel value is not guaranteed to be the lap time in seconds: in
 * some MoTeC configurations it carries only the "seconds within the minute"
 * component, or has a fixed offset. We therefore test a small set of decoding
 * hypotheses against the .ldx oracle (Fastest Time) and pick the one whose
 * recovered fastest matches within a strict tolerance. If none matches,
 * timingVerified stays false and the caller falls back to the rough estimate.
 */

export interface LapTimeSample {
  /** Time in seconds when the channel updated to the new value. */
  tSec: number;
  /** Raw channel value at the update. */
  value: number;
}

export interface LapTimingResult {
  samples: LapTimeSample[];
  /** Per-lap precise time keyed by lap.index (for display). */
  perLap: Map<number, number>;
  fastestFound?: number;
  /** Number of plausible per-lap times recovered (after decoding). */
  countFound: number;
  oracleFastestSec?: number;
  oracleTotalLaps?: number;
  fastestLapIndex?: number;
  timingVerified: boolean;
  /** Human label of the decoding hypothesis that won (if any). */
  decoding?: string;
  status:
    | "ok"
    | "no-channel"
    | "no-oracle"
    | "fastest-mismatch"
    | "count-mismatch"
    | "fastest-and-count-mismatch"
    | "no-decoding";
}

const FASTEST_TOLERANCE_S = 0.15;
const COUNT_TOLERANCE = 3;
const MIN_PLAUSIBLE_S = 20;
const MAX_PLAUSIBLE_S = 900;
const STABLE_SAMPLES = 5;

function findChannel(channels: Channel[], normName: string): Channel | undefined {
  return channels.find((c) => norm(c.name) === normName && !c.empty && c.nSamples > 0);
}

function isPlausible(v: number): boolean {
  return Number.isFinite(v) && v > MIN_PLAUSIBLE_S && v < MAX_PLAUSIBLE_S;
}

function parseFastestTimeStr(s: string | undefined): number | undefined {
  if (!s) return undefined;
  const m = s.trim().match(/^(\d+):(\d+(?:\.\d+)?)$/);
  if (!m) return undefined;
  const min = Number(m[1]);
  const sec = Number(m[2]);
  if (!Number.isFinite(min) || !Number.isFinite(sec)) return undefined;
  return min * 60 + sec;
}

/** Detect stable updates on the channel. Each stable run = one lap-completion event. */
function collectUpdates(c: Channel): LapTimeSample[] {
  const freq = c.freq || 1;
  const v = c.values;
  const out: LapTimeSample[] = [];

  let runVal = NaN;
  let runStart = 0;
  let runLen = 0;
  let lastEmitted = NaN;

  const closeRun = () => {
    if (runLen < STABLE_SAMPLES) return;
    const val = Math.round(runVal * 1000) / 1000;
    if (!Number.isFinite(val) || val <= 0) return;
    // Dedupe consecutive identical emissions.
    if (Number.isFinite(lastEmitted) && Math.abs(val - lastEmitted) < 0.001) return;
    out.push({ tSec: runStart / freq, value: val });
    lastEmitted = val;
  };

  for (let i = 0; i < v.length; i++) {
    const x = v[i];
    if (!Number.isFinite(x) || x === -1) {
      closeRun();
      runLen = 0;
      runVal = NaN;
      continue;
    }
    const rounded = Math.round(x * 1000) / 1000;
    if (runLen === 0 || Math.abs(rounded - runVal) > 0.0005) {
      closeRun();
      runStart = i;
      runVal = rounded;
      runLen = 1;
    } else {
      runLen++;
    }
  }
  closeRun();
  return out;
}

/** For each sample find the lap whose tEnd is the closest one ≤ tSec (with slack). */
function nominalForSample(sample: LapTimeSample, laps: Lap[]): number | undefined {
  let best: Lap | undefined;
  let bestDelta = Infinity;
  for (const lap of laps) {
    const delta = sample.tSec - lap.tEnd;
    if (delta >= -2 && delta < 10 && Math.abs(delta) < bestDelta) {
      best = lap;
      bestDelta = Math.abs(delta);
    }
  }
  return best?.duration;
}

type Decoder = {
  label: string;
  /** Decode one raw value into seconds (may use a nominal hint when available). */
  fn: (raw: number, nominal: number | undefined) => number;
};

const DECODERS: Decoder[] = [
  { label: "raw seconds", fn: (v) => v },
  { label: "raw + 60 s", fn: (v) => v + 60 },
  { label: "raw + 120 s", fn: (v) => v + 120 },
  { label: "raw × 60 (minutes→s)", fn: (v) => v * 60 },
  { label: "raw / 1000 (ms→s)", fn: (v) => v / 1000 },
  {
    // "Seconds-within-minute" encoding: recover minute bucket from rough nominal.
    label: "seconds-within-minute + nominal minutes",
    fn: (v, nominal) => {
      if (nominal === undefined || !Number.isFinite(nominal) || nominal <= 0) return v;
      const k = Math.max(0, Math.round((nominal - v) / 60));
      return v + 60 * k;
    },
  },
];

interface Decoded {
  decoder: Decoder;
  values: number[]; // plausible decoded times in sample order
  sampleIdx: number[]; // index into samples for each value above
  fastest: number;
  count: number;
}

function applyDecoder(
  decoder: Decoder,
  samples: LapTimeSample[],
  nominals: (number | undefined)[],
): Decoded {
  const values: number[] = [];
  const sampleIdx: number[] = [];
  let fastest = Infinity;
  for (let i = 0; i < samples.length; i++) {
    const decoded = decoder.fn(samples[i].value, nominals[i]);
    if (!isPlausible(decoded)) continue;
    values.push(decoded);
    sampleIdx.push(i);
    if (decoded < fastest) fastest = decoded;
  }
  return {
    decoder,
    values,
    sampleIdx,
    fastest: Number.isFinite(fastest) ? fastest : NaN,
    count: values.length,
  };
}

function buildPerLap(
  samples: LapTimeSample[],
  decoded: Decoded,
  laps: Lap[],
): { perLap: Map<number, number>; fastestLapIndex?: number } {
  const perLap = new Map<number, number>();
  // Assign each plausible sample to the lap whose tEnd is closest ≤ tSec.
  for (let i = 0; i < decoded.values.length; i++) {
    const s = samples[decoded.sampleIdx[i]];
    let best: Lap | undefined;
    let bestDelta = Infinity;
    for (const lap of laps) {
      const delta = s.tSec - lap.tEnd;
      if (delta >= -2 && delta < 15 && Math.abs(delta) < bestDelta) {
        best = lap;
        bestDelta = Math.abs(delta);
      }
    }
    if (best) perLap.set(best.index, decoded.values[i]);
  }
  let fastestLapIndex: number | undefined;
  let fastestVal = Infinity;
  perLap.forEach((val, idx) => {
    if (val < fastestVal) {
      fastestVal = val;
      fastestLapIndex = idx;
    }
  });
  return { perLap, fastestLapIndex };
}

export function buildLapTiming(file: LdFile): LapTimingResult {
  const ch = findChannel(file.channels, "lap time prev");
  const oracleFastestSec = parseFastestTimeStr(file.meta.fastestTime);
  const oracleTotalLaps = file.meta.totalLaps;

  if (!ch) {
    return {
      samples: [],
      perLap: new Map(),
      countFound: 0,
      oracleFastestSec,
      oracleTotalLaps,
      timingVerified: false,
      status: "no-channel",
    };
  }

  const samples = collectUpdates(ch);
  const nominals = samples.map((s) => nominalForSample(s, file.laps));

  if (oracleFastestSec === undefined || oracleTotalLaps === undefined) {
    // No oracle: best-effort raw, unverified.
    const decoded = applyDecoder(DECODERS[0], samples, nominals);
    const { perLap, fastestLapIndex } = buildPerLap(samples, decoded, file.laps);
    return {
      samples,
      perLap,
      fastestFound: Number.isFinite(decoded.fastest) ? decoded.fastest : undefined,
      countFound: decoded.count,
      fastestLapIndex,
      oracleFastestSec,
      oracleTotalLaps,
      timingVerified: false,
      status: "no-oracle",
    };
  }

  // Test all decoders, pick the one whose fastest matches the oracle.
  let winner: Decoded | undefined;
  let bestErr = Infinity;
  for (const dec of DECODERS) {
    const d = applyDecoder(dec, samples, nominals);
    if (!Number.isFinite(d.fastest)) continue;
    const err = Math.abs(d.fastest - oracleFastestSec);
    if (err <= FASTEST_TOLERANCE_S && err < bestErr) {
      winner = d;
      bestErr = err;
    }
  }

  if (!winner) {
    // No decoder matched: report best-effort raw and mark unverified.
    const fallback = applyDecoder(DECODERS[0], samples, nominals);
    const { perLap, fastestLapIndex } = buildPerLap(samples, fallback, file.laps);
    return {
      samples,
      perLap,
      fastestFound: Number.isFinite(fallback.fastest) ? fallback.fastest : undefined,
      countFound: fallback.count,
      fastestLapIndex,
      oracleFastestSec,
      oracleTotalLaps,
      timingVerified: false,
      status: "no-decoding",
    };
  }

  const { perLap, fastestLapIndex } = buildPerLap(samples, winner, file.laps);
  const fastestFound = winner.fastest;
  const countFound = winner.count;

  const fastestOk = Math.abs(fastestFound - oracleFastestSec) <= FASTEST_TOLERANCE_S;
  const countOk = Math.abs(countFound - oracleTotalLaps) <= COUNT_TOLERANCE;

  let status: LapTimingResult["status"];
  if (fastestOk && countOk) status = "ok";
  else if (!fastestOk && !countOk) status = "fastest-and-count-mismatch";
  else if (!fastestOk) status = "fastest-mismatch";
  else status = "count-mismatch";

  return {
    samples,
    perLap,
    fastestFound,
    countFound,
    fastestLapIndex,
    oracleFastestSec,
    oracleTotalLaps,
    timingVerified: fastestOk && countOk,
    decoding: winner.decoder.label,
    status,
  };
}

/** Format seconds as M:SS.mmm (use only when timingVerified). */
export function fmtLapTimePrecise(s: number | undefined): string {
  if (s === undefined || !Number.isFinite(s) || s <= 0) return "—";
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return `${m}:${r.toFixed(3).padStart(6, "0")}`;
}

/** Format seconds as M:SS (rough estimate — no millis). */
export function fmtLapTimeRough(s: number | undefined): string {
  if (s === undefined || !Number.isFinite(s) || s <= 0) return "—";
  const m = Math.floor(s / 60);
  const r = Math.round(s - m * 60);
  const mm = r === 60 ? m + 1 : m;
  const ss = r === 60 ? 0 : r;
  return `${mm}:${String(ss).padStart(2, "0")}`;
}
