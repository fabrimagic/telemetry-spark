// Engine Health — per-stint evolution of engine vitals.
//
// For each VALID lap we compute mean + max of the engine channels resolved
// via the logical resolver:
//   - water temp (engineCoolantTemp)
//   - oil temp   (engineOilTemp)
//   - oil pressure   (engineOilPressure)
//   - water pressure (engineWaterPressure)
//   - rail pressure  (engineRailPressure)
//   - fuel pressure  (fuelPressure)
//
// We do NOT invent operating windows. The ONLY thresholds we surface come
// from the toolset's declared alarm range when `hasSignificantAlarmRange`
// is true for the matching channel. When a channel is missing, the metric
// is simply omitted from the panel.

import type { Channel, LdFile } from "@/lib/ld/types";
import type { LapRow } from "@/lib/ld/stintAnalysis";
import type { ToolsetDisplayMeta } from "@/lib/toolset/types";
import { resolveChannel, type LogicalKey } from "@/lib/ld/channelResolver";
import { findAlarmRange, type ToolsetAlarmRange } from "@/lib/ld/toolsetMeta";

export type EngineMetricKey =
  | "waterTemp" | "oilTemp"
  | "oilPress"  | "waterPress" | "railPress" | "fuelPress";

export interface EngineLapPoint {
  lap: number;
  waterTempAvg?: number; waterTempMax?: number;
  oilTempAvg?: number;   oilTempMax?: number;
  oilPressAvg?: number;  oilPressMax?: number;
  waterPressAvg?: number;waterPressMax?: number;
  railPressAvg?: number; railPressMax?: number;
  fuelPressAvg?: number; fuelPressMax?: number;
}

export interface EngineMetricInfo {
  key: EngineMetricKey;
  label: string;
  unit: string;
  /** Group on chart: "temp" (°C) or "press" (bar). */
  group: "temp" | "press";
  available: boolean;
  channelName?: string;
  alarmRange?: ToolsetAlarmRange;
  /** Per valid lap (avg & max). */
  perLapAvg: Array<number | undefined>;
  perLapMax: Array<number | undefined>;
  /** Stint summary. */
  firstAvg?: number;
  lastAvg?: number;
  deltaAvg?: number;
  peakMax?: number;
  /** Laps (lap numbers) where MAX crossed the toolset alarm bounds. */
  alarmLaps: number[];
}

export interface EngineHealth {
  hasAny: boolean;
  metrics: Record<EngineMetricKey, EngineMetricInfo>;
  /** Stint-level summary helpers for the UI. */
  validLapNumbers: number[];
}

const SPECS: Array<{ key: EngineMetricKey; logical: LogicalKey; label: string; unit: string; group: "temp" | "press" }> = [
  { key: "waterTemp",  logical: "engineCoolantTemp",   label: "Acqua",         unit: "°C",  group: "temp" },
  { key: "oilTemp",    logical: "engineOilTemp",       label: "Olio",          unit: "°C",  group: "temp" },
  { key: "oilPress",   logical: "engineOilPressure",   label: "Pressione olio",   unit: "bar", group: "press" },
  { key: "waterPress", logical: "engineWaterPressure", label: "Pressione acqua",  unit: "bar", group: "press" },
  { key: "railPress",  logical: "engineRailPressure",  label: "Pressione rail",   unit: "bar", group: "press" },
  { key: "fuelPress",  logical: "fuelPressure",        label: "Pressione fuel",   unit: "bar", group: "press" },
];

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

export function buildEngineHealth(
  file: LdFile,
  lapRows: LapRow[],
  toolsetMeta: ToolsetDisplayMeta[] | undefined,
): EngineHealth {
  const channels = file.channels;
  const validLaps = lapRows.filter((l) => l.isValidLap);
  const lapNumbers = validLaps.map((l) => l.lap);

  const metrics = {} as Record<EngineMetricKey, EngineMetricInfo>;

  for (const spec of SPECS) {
    const ch = resolveChannel(channels, spec.logical);
    const info: EngineMetricInfo = {
      key: spec.key,
      label: spec.label,
      unit: spec.unit,
      group: spec.group,
      available: false,
      perLapAvg: validLaps.map(() => undefined),
      perLapMax: validLaps.map(() => undefined),
      alarmLaps: [],
    };
    if (ch) {
      info.channelName = ch.name;
      const alarm = findAlarmRange(toolsetMeta, ch.name);
      if (alarm) info.alarmRange = alarm;

      let any = false;
      for (let i = 0; i < validLaps.length; i++) {
        const lap = validLaps[i];
        const s = windowStats(ch, lap.tStart, lap.tEnd);
        if (s.n > 0) {
          any = true;
          info.perLapAvg[i] = s.avg;
          info.perLapMax[i] = s.max;
          if (alarm && (s.max > alarm.max || s.max < alarm.min)) {
            info.alarmLaps.push(lap.lap);
          }
        }
      }
      info.available = any;
      if (any) {
        const avgs = info.perLapAvg.filter((v): v is number => v !== undefined);
        const maxs = info.perLapMax.filter((v): v is number => v !== undefined);
        info.firstAvg = avgs[0];
        info.lastAvg = avgs[avgs.length - 1];
        if (info.firstAvg !== undefined && info.lastAvg !== undefined) {
          info.deltaAvg = info.lastAvg - info.firstAvg;
        }
        info.peakMax = Math.max(...maxs);
      }
    }
    metrics[spec.key] = info;
  }

  const hasAny = SPECS.some((s) => metrics[s.key].available);
  return { hasAny, metrics, validLapNumbers: lapNumbers };
}
