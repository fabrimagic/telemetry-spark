// Brake Management — per-stint evolution of disc temperatures.
//
// For each VALID lap we compute, per disc (FL/FR/RL/RR), the max and mean
// during the lap window, skipping sentinel/non-physical samples. We also
// surface per-lap axle (front-rear) and side (left-right) imbalances since
// the thermal balance evolves through a stint and that evolution is the
// engineering signal we want to expose.
//
// We intentionally do NOT invent any optimal operating window for the discs:
// the optimal window is not declared in the file. The ONLY threshold we
// surface is the toolset's own alarm range, when `hasSignificantAlarmRange`
// is true for the matching disc channel.

import type { Channel, LdFile } from "@/lib/ld/types";
import type { LapRow } from "@/lib/ld/stintAnalysis";
import type { ToolsetDisplayMeta } from "@/lib/toolset/types";
import { resolveChannel, type LogicalKey } from "@/lib/ld/channelResolver";
import { findAlarmRange, type ToolsetAlarmRange } from "@/lib/ld/toolsetMeta";

export type WheelKey = "fl" | "fr" | "rl" | "rr";

export interface BrakeLapPoint {
  lap: number;
  /** Per-corner max disc temperature in the lap; undefined when channel absent
   *  or no valid samples in the lap window. */
  flMax?: number; frMax?: number; rlMax?: number; rrMax?: number;
  flAvg?: number; frAvg?: number; rlAvg?: number; rrAvg?: number;
  /** Per-lap imbalances (max), computed only when both sides are present. */
  axleDelta?: number; // (frontMax avg) - (rearMax avg)
  sideDelta?: number; // (leftMax avg)  - (rightMax avg)
}

export interface BrakeAvailability { fl: boolean; fr: boolean; rl: boolean; rr: boolean }

export interface BrakeManagement {
  hasAny: boolean;
  available: BrakeAvailability;
  reason: Partial<Record<WheelKey, string>>;
  /** Resolved channel names per wheel (for tooltip / display). */
  channelName: Partial<Record<WheelKey, string>>;
  /** Per valid lap data (max + avg per corner + imbalances). */
  perLap: BrakeLapPoint[];
  /** Toolset alarm range per corner, only when `hasSignificantAlarmRange`. */
  alarmRange: Partial<Record<WheelKey, ToolsetAlarmRange>>;
  summary: {
    /** Max delta from first to last valid lap (per corner). */
    totalMaxDelta: Partial<Record<WheelKey, number>>;
    /** Mean per-lap axle / side imbalance across the stint. */
    axleDeltaAvg?: number;
    sideDeltaAvg?: number;
    /** Initial and final per-lap axle delta, useful to show the trend. */
    axleDeltaFirst?: number;
    axleDeltaLast?: number;
  };
}

const WHEELS: WheelKey[] = ["fl", "fr", "rl", "rr"];

function isValid(v: number): boolean {
  return Number.isFinite(v) && v !== -1;
}

function windowStats(c: Channel, tStart: number, tEnd: number): { max: number; avg: number; n: number } {
  const freq = c.freq || 1;
  const from = Math.max(0, Math.floor(tStart * freq));
  const to = Math.min(c.values.length - 1, Math.ceil(tEnd * freq));
  let sum = 0;
  let n = 0;
  let max = -Infinity;
  for (let i = from; i <= to; i++) {
    const v = c.values[i];
    if (!isValid(v)) continue;
    sum += v;
    n++;
    if (v > max) max = v;
  }
  return { max: n === 0 ? NaN : max, avg: n === 0 ? NaN : sum / n, n };
}

function mean(xs: number[]): number | undefined {
  if (xs.length === 0) return undefined;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

export function buildBrakeManagement(
  file: LdFile,
  lapRows: LapRow[],
  toolsetMeta: ToolsetDisplayMeta[] | undefined,
): BrakeManagement {
  const channels = file.channels;
  const validLaps = lapRows.filter((l) => l.isValidLap);

  const chPer: Record<WheelKey, Channel | undefined> = {
    fl: resolveChannel(channels, "brakeDiscTemp.fl" as LogicalKey),
    fr: resolveChannel(channels, "brakeDiscTemp.fr" as LogicalKey),
    rl: resolveChannel(channels, "brakeDiscTemp.rl" as LogicalKey),
    rr: resolveChannel(channels, "brakeDiscTemp.rr" as LogicalKey),
  };

  const available: BrakeAvailability = { fl: false, fr: false, rl: false, rr: false };
  const reason: Partial<Record<WheelKey, string>> = {};
  const channelName: Partial<Record<WheelKey, string>> = {};
  const alarmRange: Partial<Record<WheelKey, ToolsetAlarmRange>> = {};

  const rawMax: Record<WheelKey, Array<number | undefined>> = { fl: [], fr: [], rl: [], rr: [] };
  const rawAvg: Record<WheelKey, Array<number | undefined>> = { fl: [], fr: [], rl: [], rr: [] };

  for (const w of WHEELS) {
    const ch = chPer[w];
    if (!ch) {
      reason[w] = "canale assente";
      rawMax[w] = validLaps.map(() => undefined);
      rawAvg[w] = validLaps.map(() => undefined);
      continue;
    }
    channelName[w] = ch.name;
    const r = findAlarmRange(toolsetMeta, ch.name);
    if (r) alarmRange[w] = r;

    let anyValid = false;
    for (const lap of validLaps) {
      const s = windowStats(ch, lap.tStart, lap.tEnd);
      if (s.n > 0) {
        anyValid = true;
        rawMax[w].push(s.max);
        rawAvg[w].push(s.avg);
      } else {
        rawMax[w].push(undefined);
        rawAvg[w].push(undefined);
      }
    }
    if (!anyValid) {
      reason[w] = "nessun campione valido";
      continue;
    }
    available[w] = true;
  }

  const perLap: BrakeLapPoint[] = validLaps.map((lap, i) => {
    const row: BrakeLapPoint = { lap: lap.lap };
    for (const w of WHEELS) {
      if (!available[w]) continue;
      row[`${w}Max` as const] = rawMax[w][i];
      row[`${w}Avg` as const] = rawAvg[w][i];
    }
    // Per-lap imbalances on MAX values, computed only when at least one corner per side/axle is present.
    const front: number[] = [];
    const rear: number[] = [];
    const left: number[] = [];
    const right: number[] = [];
    if (available.fl && row.flMax !== undefined) { front.push(row.flMax); left.push(row.flMax); }
    if (available.fr && row.frMax !== undefined) { front.push(row.frMax); right.push(row.frMax); }
    if (available.rl && row.rlMax !== undefined) { rear.push(row.rlMax); left.push(row.rlMax); }
    if (available.rr && row.rrMax !== undefined) { rear.push(row.rrMax); right.push(row.rrMax); }
    if (front.length > 0 && rear.length > 0) {
      row.axleDelta =
        front.reduce((a, b) => a + b, 0) / front.length -
        rear.reduce((a, b) => a + b, 0) / rear.length;
    }
    if (left.length > 0 && right.length > 0) {
      row.sideDelta =
        left.reduce((a, b) => a + b, 0) / left.length -
        right.reduce((a, b) => a + b, 0) / right.length;
    }
    return row;
  });

  // Summary
  const totalMaxDelta: Partial<Record<WheelKey, number>> = {};
  for (const w of WHEELS) {
    if (!available[w]) continue;
    const defined = rawMax[w].filter((v): v is number => v !== undefined);
    if (defined.length >= 2) totalMaxDelta[w] = defined[defined.length - 1] - defined[0];
  }
  const axleDeltas = perLap.map((p) => p.axleDelta).filter((v): v is number => v !== undefined);
  const sideDeltas = perLap.map((p) => p.sideDelta).filter((v): v is number => v !== undefined);

  return {
    hasAny: WHEELS.some((w) => available[w]),
    available,
    reason,
    channelName,
    perLap,
    alarmRange,
    summary: {
      totalMaxDelta,
      axleDeltaAvg: mean(axleDeltas),
      sideDeltaAvg: mean(sideDeltas),
      axleDeltaFirst: axleDeltas[0],
      axleDeltaLast: axleDeltas[axleDeltas.length - 1],
    },
  };
}
