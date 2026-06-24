import type { Channel, Lap, LdFile } from "@/lib/ld/types";
import type { ToolsetDisplayMeta } from "@/lib/toolset/types";
import { resolveChannel } from "@/lib/ld/channelResolver";

export type DebriefSeverity = "alarm" | "diag" | "threshold" | "physical";

export interface DebriefEvent {
  id: string;
  severity: DebriefSeverity;
  channelName: string;
  category: string;
  lapIndex: number;
  tStart: number;
  tEnd: number;
  durationS: number;
  peakValue?: number;
  thresholdLabel?: string;
  message?: string;
}

/** Same normalization used elsewhere: trim + lowercase + collapse _/spaces into single space. */
export function norm(s: string): string {
  return s.trim().toLowerCase().replace(/[_\s]+/g, " ");
}

/** Minimum consecutive sample count to consider an event (filter glitches). */
const MIN_SAMPLES = 3;

function lapIndexAt(tSec: number, laps: Lap[]): number {
  for (const lap of laps) {
    if (tSec >= lap.tStart && tSec <= lap.tEnd) return lap.index;
  }
  // Fallback: nearest lap
  if (laps.length === 0) return 0;
  if (tSec < laps[0].tStart) return laps[0].index;
  return laps[laps.length - 1].index;
}

interface Interval {
  startIdx: number;
  endIdx: number;
  peak: number;
}

/** Generic boolean-active interval extractor; `isActive` decides per-sample state. */
function extractActiveIntervals(
  values: Float32Array,
  isActive: (v: number) => boolean,
): Interval[] {
  const out: Interval[] = [];
  let i = 0;
  const n = values.length;
  while (i < n) {
    if (isActive(values[i])) {
      const start = i;
      let peak = values[i];
      while (i < n && isActive(values[i])) {
        if (Math.abs(values[i]) > Math.abs(peak)) peak = values[i];
        i++;
      }
      out.push({ startIdx: start, endIdx: i - 1, peak });
    } else {
      i++;
    }
  }
  return out;
}


export function buildSessionDebrief(
  file: LdFile,
  toolsetMeta: ToolsetDisplayMeta[] = [],
): DebriefEvent[] {
  const events: DebriefEvent[] = [];
  const laps = file.laps;

  const metaByName = new Map<string, ToolsetDisplayMeta>();
  for (const d of toolsetMeta) {
    metaByName.set(norm(d.sourceName), d);
  }

  let seq = 0;
  const mkId = (sev: string, ch: string) => `${sev}-${seq++}-${ch}`;

  const pushInterval = (
    c: Channel,
    severity: DebriefSeverity,
    iv: Interval,
    extra: Partial<DebriefEvent> = {},
  ) => {
    const samples = iv.endIdx - iv.startIdx + 1;
    if (samples < MIN_SAMPLES && severity !== "physical") return;
    const freq = c.freq || 1;
    const tStart = iv.startIdx / freq;
    const tEnd = (iv.endIdx + 1) / freq;
    const durationS = tEnd - tStart;
    events.push({
      id: mkId(severity, c.name),
      severity,
      channelName: c.name,
      category: c.category,
      lapIndex: lapIndexAt(tStart, laps),
      tStart,
      tEnd,
      durationS,
      ...extra,
    });
  };

  // 1) Native alarm/warn/lamp/mil channels — strict boolean state, ignore sentinel -1.
  const COUNTER_TOKENS = ["milisecond", "second", "minute", "hour", "counter", "timer", "distance"];
  for (const c of file.channels) {
    if (c.empty || c.nSamples === 0) continue;
    const nm = norm(c.name);
    // Exclude continuous/counter channels even if name partially matches.
    if (c.category === "GPS") continue;
    if (COUNTER_TOKENS.some((t) => nm.includes(t))) continue;
    const isAlarm =
      nm.startsWith("alarm ") ||
      nm.startsWith("warn ") ||
      nm.endsWith(" lamp") ||
      nm.endsWith(" mil") ||
      nm === "abs lamp" ||
      nm === "abs mil";
    if (!isAlarm) continue;
    const intervals = extractActiveIntervals(c.values, (v) => {
      if (v === -1) return false; // sentinel: not-valid
      return Math.round(v) === 1; // boolean active state only
    });
    for (const iv of intervals) {
      pushInterval(c, "alarm", iv, { peakValue: iv.peak });
    }
  }

  // 2) Diagnostic out-of-range:
  // Omitted: in this file format the "_diag / Out of range state" info exists as
  // toolset metadata only, with no corresponding logged channel in the .ld file
  // that we can verify. Skipped to avoid inventing data.

  // 3) Threshold violations — only toolset-defined alarmEnabled channels with a
  // significant range (skip default 0–1000 placeholder ranges).
  for (const c of file.channels) {
    if (c.empty || c.nSamples === 0) continue;
    const meta = metaByName.get(norm(c.name));
    if (!meta || !meta.alarmEnabled || !meta.hasSignificantAlarmRange) continue;
    const lo = meta.alarmMinimum;
    const hi = meta.alarmMaximum;
    if (lo === undefined && hi === undefined) continue;
    const intervals = extractActiveIntervals(c.values, (v) => {
      if (!Number.isFinite(v)) return false;
      if (v === -1) return false; // sentinel: not-valid sample
      if (lo !== undefined && v < lo) return true;
      if (hi !== undefined && v > hi) return true;
      return false;
    });
    const unit = meta.userUnit ? ` ${meta.userUnit}` : "";
    const loStr = lo !== undefined ? String(lo) : "−∞";
    const hiStr = hi !== undefined ? String(hi) : "+∞";
    const label = `soglia toolset: ${loStr}–${hiStr}${unit}`;
    for (const iv of intervals) {
      pushInterval(c, "threshold", iv, {
        peakValue: iv.peak,
        thresholdLabel: label,
      });
    }
  }

  // 4) Physical binary events — ABS Active transitions to active.
  const abs = resolveChannel(file.channels, "absActive");
  if (abs && !abs.empty) {
    let prev = 0;
    for (let i = 0; i < abs.values.length; i++) {
      const v = abs.values[i];
      const active = v !== -1 && Math.round(v) > 0 ? 1 : 0;
      if (active === 1 && prev === 0) {
        // find end of this active run
        let j = i;
        let peak = v;
        while (
          j < abs.values.length &&
          abs.values[j] !== -1 &&
          Math.round(abs.values[j]) > 0
        ) {
          if (Math.abs(abs.values[j]) > Math.abs(peak)) peak = abs.values[j];
          j++;
        }
        pushInterval(abs, "physical", { startIdx: i, endIdx: j - 1, peak }, {
          peakValue: peak,
        });
        i = j;
        prev = 0;
      } else {
        prev = active;
      }
    }
  }

  events.sort((a, b) => a.lapIndex - b.lapIndex || a.tStart - b.tStart);
  return events;
}
