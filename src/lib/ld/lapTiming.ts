import type { Channel, Lap, LdFile } from "@/lib/ld/types";
import { norm } from "@/lib/ld/sessionDebrief";

/**
 * Lap timing recovered from the 100 Hz "lap time prev" channel, cross-checked
 * against the .ldx summary (Fastest Time, Total Laps) which we treat as the
 * ground-truth oracle.
 *
 * If the verification fails, callers MUST fall back to the rough lap.duration
 * estimates — the precise times are only safe to display when timingVerified
 * is true.
 */

export interface LapTimeSample {
  /** Time in seconds when the channel updated to the new value. */
  tSec: number;
  /** Lap time in seconds reported by the channel for the lap that just ended. */
  value: number;
}

export interface LapTimingResult {
  /** Raw (tSec, value) updates collected from "lap time prev". */
  samples: LapTimeSample[];
  /** Per-lap precise time (key = lap.index). Populated even if not verified. */
  perLap: Map<number, number>;
  /** Fastest lap time we recovered (s). */
  fastestFound?: number;
  /** Number of plausible per-lap times recovered. */
  countFound: number;
  /** Oracle values (from .ldx). */
  oracleFastestSec?: number;
  oracleTotalLaps?: number;
  /** Index of the lap whose precise time matches fastestFound. */
  fastestLapIndex?: number;
  /** True iff both fastest and count agree with the oracle within tolerance. */
  timingVerified: boolean;
  /** Why verification failed (or "ok"). */
  status:
    | "ok"
    | "no-channel"
    | "no-oracle"
    | "fastest-mismatch"
    | "count-mismatch"
    | "fastest-and-count-mismatch";
}

const FASTEST_TOLERANCE_S = 0.1;
const COUNT_TOLERANCE = 2;
const MIN_PLAUSIBLE_S = 30; // a circuit lap shorter than this is implausible here
const MAX_PLAUSIBLE_S = 600;
const STABLE_SAMPLES = 5; // value must persist this many samples to be accepted

function findChannel(channels: Channel[], normName: string): Channel | undefined {
  return channels.find((c) => norm(c.name) === normName && !c.empty && c.nSamples > 0);
}

function isPlausible(v: number): boolean {
  return Number.isFinite(v) && v > MIN_PLAUSIBLE_S && v < MAX_PLAUSIBLE_S;
}

/** Parse "M:SS.mmm" (or "MM:SS.mmm") to seconds. */
function parseFastestTimeStr(s: string | undefined): number | undefined {
  if (!s) return undefined;
  const m = s.trim().match(/^(\d+):(\d+(?:\.\d+)?)$/);
  if (!m) return undefined;
  const min = Number(m[1]);
  const sec = Number(m[2]);
  if (!Number.isFinite(min) || !Number.isFinite(sec)) return undefined;
  return min * 60 + sec;
}

/** Detect stable updates on "lap time prev". */
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
    if (!isPlausible(val)) return;
    // Ignore repeats of the same lap time we already emitted.
    if (Number.isFinite(lastEmitted) && Math.abs(val - lastEmitted) < 0.001) return;
    out.push({ tSec: runStart / freq, value: val });
    lastEmitted = val;
  };

  for (let i = 0; i < v.length; i++) {
    const x = v[i];
    if (!Number.isFinite(x) || x === -1) {
      // sentinel breaks the current run
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

/** Map each update to the lap that just ended (lap whose tEnd ≤ tSec, closest). */
function assignToLaps(samples: LapTimeSample[], laps: Lap[]): Map<number, number> {
  const perLap = new Map<number, number>();
  for (const s of samples) {
    let best: Lap | undefined;
    let bestDelta = Infinity;
    for (const lap of laps) {
      // Update normally lands a fraction after lap end.
      const delta = s.tSec - lap.tEnd;
      // Accept a small slack on either side to handle rounding.
      if (delta >= -1 && delta < bestDelta) {
        // Pick the smallest non-negative delta (most recently ended lap).
        if (delta >= 0 && (best === undefined || delta < bestDelta)) {
          best = lap;
          bestDelta = delta;
        }
      }
    }
    if (best && bestDelta < 5) {
      // Don't overwrite if a closer update already mapped to this lap.
      perLap.set(best.index, s.value);
    }
  }
  return perLap;
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
  const perLap = assignToLaps(samples, file.laps);

  let fastestFound: number | undefined;
  let fastestLapIndex: number | undefined;
  perLap.forEach((val, lapIdx) => {
    if (fastestFound === undefined || val < fastestFound) {
      fastestFound = val;
      fastestLapIndex = lapIdx;
    }
  });
  const countFound = perLap.size;

  if (oracleFastestSec === undefined || oracleTotalLaps === undefined) {
    return {
      samples,
      perLap,
      fastestFound,
      countFound,
      fastestLapIndex,
      oracleFastestSec,
      oracleTotalLaps,
      timingVerified: false,
      status: "no-oracle",
    };
  }

  const fastestOk =
    fastestFound !== undefined &&
    Math.abs(fastestFound - oracleFastestSec) <= FASTEST_TOLERANCE_S;
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
