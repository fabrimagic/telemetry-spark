import type { Channel, Lap, LdFile } from "@/lib/ld/types";
import type { ToolsetDisplayMeta } from "@/lib/toolset/types";
import { norm } from "@/lib/ld/sessionDebrief";

/* ===================== Types ===================== */

export interface SessionConditions {
  wetPct?: number; // 0..100, % of samples where log B wet is active
  airTempAvg?: number;
  humidityAvg?: number;
  airPressureAvg?: number;
}

export interface AbsHit {
  lap: number;
  tSec: number;
  lapDistance?: number;
  durationS: number;
}

export interface LapTempStats {
  max: number;
  avg: number;
}

export interface LapTempCorner {
  fl?: LapTempStats;
  fr?: LapTempStats;
  rl?: LapTempStats;
  rr?: LapTempStats;
  /** Front avg - Rear avg (axle asymmetry). */
  axleDelta?: number;
  /** Left avg - Right avg (side asymmetry). */
  sideDelta?: number;
  /** Absolute max across the four corners (raw info). */
  maxAll?: number;
}

export interface LapRow {
  lap: number;
  tStart: number;
  tEnd: number;
  durationS: number;
  maxSpeed?: number;
  maxRpm?: number;
  absCount: number;
  hasAbs: boolean;
  hasAlarm: boolean;
  isOutLap: boolean;
  isFastest: boolean;
  brakes: LapTempCorner;
  tyres: LapTempCorner;
}

export type SetupChannelKey = "brkbias" | "mappos" | "tc";

export interface SetupChange {
  id: string;
  channel: SetupChannelKey;
  channelLabel: string;
  lap: number;
  tSec: number;
  prev: number;
  next: number;
}

export interface StintAnalysis {
  conditions: SessionConditions;
  laps: LapRow[];
  absHits: AbsHit[];
  setupChanges: SetupChange[];
  /** Whether each per-channel group has data; lets UI omit empty sections. */
  has: {
    speed: boolean;
    rpm: boolean;
    abs: boolean;
    lapDistance: boolean;
    brakes: boolean;
    tyres: boolean;
    brkbias: boolean;
    mappos: boolean;
    tc: boolean;
  };
}

/* ===================== Helpers ===================== */

function findChannel(channels: Channel[], normName: string): Channel | undefined {
  return channels.find((c) => norm(c.name) === normName && !c.empty && c.nSamples > 0);
}

/** Inclusive sample range that covers the lap window [tStart, tEnd] for a given channel. */
function lapRange(c: Channel, lap: Lap): { from: number; to: number } {
  const freq = c.freq || 1;
  const from = Math.max(0, Math.floor(lap.tStart * freq));
  const to = Math.min(c.values.length - 1, Math.ceil(lap.tEnd * freq));
  return { from, to };
}

function isValid(v: number): boolean {
  return Number.isFinite(v) && v !== -1;
}

function statsOver(c: Channel, lap: Lap): { min: number; max: number; avg: number; n: number } {
  const { from, to } = lapRange(c, lap);
  let mn = Infinity;
  let mx = -Infinity;
  let sum = 0;
  let n = 0;
  for (let i = from; i <= to; i++) {
    const v = c.values[i];
    if (!isValid(v)) continue;
    if (v < mn) mn = v;
    if (v > mx) mx = v;
    sum += v;
    n++;
  }
  return n === 0
    ? { min: NaN, max: NaN, avg: NaN, n: 0 }
    : { min: mn, max: mx, avg: sum / n, n };
}

function tempCornerStats(
  channels: Channel[],
  baseNorm: string,
  lap: Lap,
): LapTempCorner {
  const corners: Array<["fl" | "fr" | "rl" | "rr", string]> = [
    ["fl", `${baseNorm} fl`],
    ["fr", `${baseNorm} fr`],
    ["rl", `${baseNorm} rl`],
    ["rr", `${baseNorm} rr`],
  ];
  const out: LapTempCorner = {};
  const avgs: Record<string, number> = {};
  let maxAll = -Infinity;
  for (const [k, nm] of corners) {
    const ch = findChannel(channels, nm);
    if (!ch) continue;
    const s = statsOver(ch, lap);
    if (s.n === 0) continue;
    out[k] = { max: s.max, avg: s.avg };
    avgs[k] = s.avg;
    if (s.max > maxAll) maxAll = s.max;
  }
  const hasFront = avgs.fl !== undefined || avgs.fr !== undefined;
  const hasRear = avgs.rl !== undefined || avgs.rr !== undefined;
  if (hasFront && hasRear) {
    const front = avg([avgs.fl, avgs.fr]);
    const rear = avg([avgs.rl, avgs.rr]);
    if (front !== undefined && rear !== undefined) out.axleDelta = front - rear;
  }
  const hasLeft = avgs.fl !== undefined || avgs.rl !== undefined;
  const hasRight = avgs.fr !== undefined || avgs.rr !== undefined;
  if (hasLeft && hasRight) {
    const left = avg([avgs.fl, avgs.rl]);
    const right = avg([avgs.fr, avgs.rr]);
    if (left !== undefined && right !== undefined) out.sideDelta = left - right;
  }
  if (Number.isFinite(maxAll)) out.maxAll = maxAll;
  return out;
}

function avg(xs: Array<number | undefined>): number | undefined {
  const ys = xs.filter((x): x is number => x !== undefined && Number.isFinite(x));
  if (ys.length === 0) return undefined;
  return ys.reduce((a, b) => a + b, 0) / ys.length;
}

function sampleAt(c: Channel, tSec: number): number | undefined {
  const freq = c.freq || 1;
  const idx = Math.max(0, Math.min(c.values.length - 1, Math.round(tSec * freq)));
  const v = c.values[idx];
  return isValid(v) ? v : undefined;
}

/* ===================== Main builder ===================== */

const MIN_STABLE_SAMPLES = 8; // setup change: new level must persist this many samples
const ABS_MIN_SAMPLES = 2;

export function buildStintAnalysis(
  file: LdFile,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- accepted for future threshold use
  toolsetMeta: ToolsetDisplayMeta[] = [],
): StintAnalysis {
  const ch = file.channels;
  const laps = file.laps;

  /* ----- 1. Session conditions ----- */
  const conditions: SessionConditions = {};
  const wet = findChannel(ch, "log b wet");
  if (wet) {
    let on = 0;
    let tot = 0;
    for (let i = 0; i < wet.values.length; i++) {
      const v = wet.values[i];
      if (!isValid(v)) continue;
      tot++;
      if (Math.round(v) === 1) on++;
    }
    if (tot > 0) conditions.wetPct = (on / tot) * 100;
  }
  const airT = findChannel(ch, "pth t air");
  if (airT) conditions.airTempAvg = meanValid(airT.values);
  const hum = findChannel(ch, "pth r humidity");
  if (hum) conditions.humidityAvg = meanValid(hum.values);
  const airP = findChannel(ch, "pth p air");
  if (airP) conditions.airPressureAvg = meanValid(airP.values);

  /* ----- 2. Per-lap channels ----- */
  const speed = findChannel(ch, "ground speed");
  const rpm = findChannel(ch, "rpm");
  const absCh = findChannel(ch, "abs active");
  const lapDist = findChannel(ch, "lap distance");

  // Native alarm channels (same convention as sessionDebrief — strict matching)
  const COUNTER_TOKENS = ["milisecond", "second", "minute", "hour", "counter", "timer", "distance"];
  const alarmChannels = ch.filter((c) => {
    if (c.empty || c.nSamples === 0) return false;
    if (c.category === "GPS") return false;
    const nm = norm(c.name);
    if (COUNTER_TOKENS.some((t) => nm.includes(t))) return false;
    return (
      nm.startsWith("alarm ") ||
      nm.startsWith("warn ") ||
      nm.endsWith(" lamp") ||
      nm.endsWith(" mil") ||
      nm === "abs lamp" ||
      nm === "abs mil"
    );
  });

  // Pre-compute ABS activation events (whole stint) and bucket by lap.
  // NOTE: We deliberately do NOT compute a "TC interventions" count. The .ld file
  // contains "stw rt01 tc lat" (TC map dial position) and "pcu state tc wet"
  // (TC mode state) — neither is an event/activation channel, so counting them
  // as interventions would be fabricated data.
  const absHits: AbsHit[] = [];
  if (absCh) {
    const v = absCh.values;
    const freq = absCh.freq || 1;
    let i = 0;
    while (i < v.length) {
      const active = isValid(v[i]) && Math.round(v[i]) >= 1;
      if (active) {
        const start = i;
        while (i < v.length && isValid(v[i]) && Math.round(v[i]) >= 1) i++;
        const len = i - start;
        if (len >= ABS_MIN_SAMPLES) {
          const tSec = start / freq;
          const lapIdx = lapIndexAt(tSec, laps);
          const ld = lapDist ? sampleAt(lapDist, tSec) : undefined;
          absHits.push({
            lap: lapIdx,
            tSec,
            lapDistance: ld,
            durationS: len / freq,
          });
        }
      } else {
        i++;
      }
    }
  }

  const lapRows: LapRow[] = laps.map((lap) => {
    const sMax = speed ? statsOver(speed, lap).max : NaN;
    const rMax = rpm ? statsOver(rpm, lap).max : NaN;
    const absInLap = absHits.filter((h) => h.lap === lap.index);
    let hasAlarm = false;
    for (const ac of alarmChannels) {
      const { from, to } = lapRange(ac, lap);
      for (let i = from; i <= to; i++) {
        const v = ac.values[i];
        if (isValid(v) && Math.round(v) === 1) {
          hasAlarm = true;
          break;
        }
      }
      if (hasAlarm) break;
    }
    return {
      lap: lap.index,
      tStart: lap.tStart,
      tEnd: lap.tEnd,
      durationS: lap.duration,
      maxSpeed: Number.isFinite(sMax) ? sMax : undefined,
      maxRpm: Number.isFinite(rMax) ? rMax : undefined,
      absCount: absInLap.length,
      hasAbs: absInLap.length > 0,
      hasAlarm,
      isOutLap: false, // filled below
      isFastest: false, // filled below
      brakes: tempCornerStats(ch, "log brkdisctemp", lap),
      tyres: tempCornerStats(ch, "tpms temp", lap),
    };
  });

  // Out-lap detection: duration > 1.5 × median of all lap durations.
  const durations = lapRows.map((r) => r.durationS).filter((d) => Number.isFinite(d) && d > 0);
  if (durations.length >= 3) {
    const sorted = [...durations].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    for (const r of lapRows) {
      if (r.durationS > median * 1.5) r.isOutLap = true;
    }
  }

  // Fastest among non-out-laps.
  let bestIdx = -1;
  let bestT = Infinity;
  lapRows.forEach((r, idx) => {
    if (r.isOutLap) return;
    if (r.durationS > 0 && r.durationS < bestT) {
      bestT = r.durationS;
      bestIdx = idx;
    }
  });
  if (bestIdx >= 0) lapRows[bestIdx].isFastest = true;

  /* ----- 3. Setup changes ----- */
  const setupChanges: SetupChange[] = [];
  const setupSpecs: Array<{ key: SetupChannelKey; nm: string; label: string }> = [
    { key: "brkbias", nm: "log brkbias", label: "Brake Bias" },
    { key: "mappos", nm: "ecu mappos", label: "Engine Map" },
    { key: "tc", nm: "stw rt01 tc lat", label: "TC Map" },
  ];
  for (const spec of setupSpecs) {
    const c = findChannel(ch, spec.nm);
    if (!c) continue;
    const v = c.values;
    const freq = c.freq || 1;
    // Find first stable level.
    let i = 0;
    let prevLevel: number | undefined;
    let runStart = 0;
    let runVal = NaN;
    let runLen = 0;
    while (i < v.length) {
      const x = v[i];
      if (!isValid(x)) {
        i++;
        continue;
      }
      const rounded = Math.round(x * 100) / 100; // stable to 2 decimals
      if (runLen === 0 || rounded !== runVal) {
        // close previous run if long enough
        if (runLen >= MIN_STABLE_SAMPLES) {
          if (prevLevel === undefined) {
            prevLevel = runVal;
          } else if (runVal !== prevLevel) {
            const tSec = runStart / freq;
            setupChanges.push({
              id: `${spec.key}-${setupChanges.length}`,
              channel: spec.key,
              channelLabel: spec.label,
              lap: lapIndexAt(tSec, laps),
              tSec,
              prev: prevLevel,
              next: runVal,
            });
            prevLevel = runVal;
          }
        }
        runStart = i;
        runVal = rounded;
        runLen = 1;
      } else {
        runLen++;
      }
      i++;
    }
    // close trailing run
    if (runLen >= MIN_STABLE_SAMPLES && prevLevel !== undefined && runVal !== prevLevel) {
      const tSec = runStart / freq;
      setupChanges.push({
        id: `${spec.key}-${setupChanges.length}`,
        channel: spec.key,
        channelLabel: spec.label,
        lap: lapIndexAt(tSec, laps),
        tSec,
        prev: prevLevel,
        next: runVal,
      });
    }
  }
  setupChanges.sort((a, b) => a.tSec - b.tSec);

  return {
    conditions,
    laps: lapRows,
    absHits,
    setupChanges,
    has: {
      speed: !!speed,
      rpm: !!rpm,
      abs: !!absCh,
      lapDistance: !!lapDist,
      brakes:
        !!findChannel(ch, "log brkdisctemp fl") ||
        !!findChannel(ch, "log brkdisctemp fr") ||
        !!findChannel(ch, "log brkdisctemp rl") ||
        !!findChannel(ch, "log brkdisctemp rr"),
      tyres:
        !!findChannel(ch, "tpms temp fl") ||
        !!findChannel(ch, "tpms temp fr") ||
        !!findChannel(ch, "tpms temp rl") ||
        !!findChannel(ch, "tpms temp rr"),
      brkbias: !!findChannel(ch, "log brkbias"),
      mappos: !!findChannel(ch, "ecu mappos"),
      tc: !!findChannel(ch, "stw rt01 tc lat"),
    },
  };
}

function meanValid(arr: Float32Array): number | undefined {
  let sum = 0;
  let n = 0;
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i];
    if (!isValid(v)) continue;
    sum += v;
    n++;
  }
  return n === 0 ? undefined : sum / n;
}

function lapIndexAt(tSec: number, laps: Lap[]): number {
  for (const lap of laps) {
    if (tSec >= lap.tStart && tSec <= lap.tEnd) return lap.index;
  }
  if (laps.length === 0) return 0;
  if (tSec < laps[0].tStart) return laps[0].index;
  return laps[laps.length - 1].index;
}
