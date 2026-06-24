import type { Channel, LdFile } from "@/lib/ld/types";
import type { LapRow } from "@/lib/ld/stintAnalysis";
import { resolveChannel, type LogicalKey } from "@/lib/ld/channelResolver";

export type WheelKey = "fl" | "fr" | "rl" | "rr";

export interface TyreLapPoint {
  lap: number;
  /** undefined when the wheel sensor is unavailable. */
  fl?: number;
  fr?: number;
  rl?: number;
  rr?: number;
}

export interface WheelAvailability {
  fl: boolean;
  fr: boolean;
  rl: boolean;
  rr: boolean;
}

export interface TyreEvolutionSeries {
  available: boolean;
  channelsFound: WheelAvailability;
  sensorAvailable: WheelAvailability;
  /** Reason string per wheel when unavailable (e.g. "channel missing", "always zero", "stuck"). */
  unavailableReason: Partial<Record<WheelKey, string>>;
  /** Per valid lap, avg value for each wheel (undefined if sensor unavailable). */
  perLap: TyreLapPoint[];
}

export interface TyreEvolutionSummary {
  /** Warm-up estimated as number of initial laps where temperature rises before stabilising.
   *  Computed only from wheels with valid temperature data. undefined if not estimable. */
  warmupLaps?: number;
  /** For each available wheel, total temp delta from first to last valid lap. */
  totalTempDelta: Partial<Record<WheelKey, number>>;
  /** Mean axle delta (front avg - rear avg) across valid laps; uses only available wheels. */
  axleDeltaAvg?: number;
  /** Mean side delta (left avg - right avg) across valid laps; uses only available wheels. */
  sideDeltaAvg?: number;
}

export interface TyreEvolution {
  hasTpms: boolean;
  temp: TyreEvolutionSeries;
  press: TyreEvolutionSeries;
  summary: TyreEvolutionSummary;
}

const WHEELS: WheelKey[] = ["fl", "fr", "rl", "rr"];


function isValid(v: number): boolean {
  return Number.isFinite(v) && v !== -1;
}

function avgWindow(c: Channel, tStart: number, tEnd: number): { avg: number; n: number; nonZero: number } {
  const freq = c.freq || 1;
  const from = Math.max(0, Math.floor(tStart * freq));
  const to = Math.min(c.values.length - 1, Math.ceil(tEnd * freq));
  let sum = 0;
  let n = 0;
  let nonZero = 0;
  for (let i = from; i <= to; i++) {
    const v = c.values[i];
    if (!isValid(v)) continue;
    sum += v;
    n++;
    if (Math.abs(v) > 1e-6) nonZero++;
  }
  return { avg: n === 0 ? NaN : sum / n, n, nonZero };
}

function variance(xs: number[]): number {
  if (xs.length === 0) return 0;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return xs.reduce((a, b) => a + (b - m) * (b - m), 0) / xs.length;
}

function mean(xs: number[]): number | undefined {
  if (xs.length === 0) return undefined;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

interface RawSeries {
  channelFound: boolean;
  perLap: Array<number | undefined>;
  nonZeroFraction: number;
}

function buildRawSeries(
  channels: Channel[],
  baseKey: "tyreTemp" | "tyrePress",
  validLaps: LapRow[],
): Record<WheelKey, RawSeries> {
  const out = {} as Record<WheelKey, RawSeries>;
  for (const w of WHEELS) {
    const ch = resolveChannel(channels, `${baseKey}.${w}` as LogicalKey);
    if (!ch) {
      out[w] = { channelFound: false, perLap: validLaps.map(() => undefined), nonZeroFraction: 0 };
      continue;
    }
    let totalN = 0;
    let totalNonZero = 0;
    const perLap = validLaps.map((lap) => {
      const s = avgWindow(ch, lap.tStart, lap.tEnd);
      totalN += s.n;
      totalNonZero += s.nonZero;
      return s.n > 0 ? s.avg : undefined;
    });
    out[w] = {
      channelFound: true,
      perLap,
      nonZeroFraction: totalN > 0 ? totalNonZero / totalN : 0,
    };
  }
  return out;
}

function assessTemp(raw: Record<WheelKey, RawSeries>): {
  sensorAvailable: WheelAvailability;
  reasons: Partial<Record<WheelKey, string>>;
} {
  const sensorAvailable = { fl: false, fr: false, rl: false, rr: false } as WheelAvailability;
  const reasons: Partial<Record<WheelKey, string>> = {};
  for (const w of WHEELS) {
    const r = raw[w];
    if (!r.channelFound) {
      reasons[w] = "canale assente";
      continue;
    }
    const defined = r.perLap.filter((v): v is number => v !== undefined);
    if (defined.length === 0) {
      reasons[w] = "nessun campione valido";
      continue;
    }
    // Temperature should be physical (>5°C in any realistic on-track stint) and not stuck at 0.
    if (r.nonZeroFraction < 0.05) {
      reasons[w] = "temperatura sempre nulla";
      continue;
    }
    const maxVal = Math.max(...defined);
    if (maxVal < 5) {
      reasons[w] = "valori non plausibili";
      continue;
    }
    sensorAvailable[w] = true;
  }
  return { sensorAvailable, reasons };
}

function assessPress(
  raw: Record<WheelKey, RawSeries>,
  tempAvailable: WheelAvailability,
): { sensorAvailable: WheelAvailability; reasons: Partial<Record<WheelKey, string>> } {
  const sensorAvailable = { fl: false, fr: false, rl: false, rr: false } as WheelAvailability;
  const reasons: Partial<Record<WheelKey, string>> = {};
  // Reference variance across wheels whose temperature sensor is available
  const refVariances: number[] = [];
  for (const w of WHEELS) {
    if (!tempAvailable[w]) continue;
    const defined = raw[w].perLap.filter((v): v is number => v !== undefined);
    if (defined.length >= 2) refVariances.push(variance(defined));
  }
  const refVarMean = mean(refVariances) ?? 0;
  for (const w of WHEELS) {
    const r = raw[w];
    if (!r.channelFound) {
      reasons[w] = "canale assente";
      continue;
    }
    const defined = r.perLap.filter((v): v is number => v !== undefined);
    if (defined.length === 0) {
      reasons[w] = "nessun campione valido";
      continue;
    }
    if (r.nonZeroFraction < 0.05) {
      reasons[w] = "pressione sempre nulla";
      continue;
    }
    // Treat as stuck if temp sensor is unavailable AND variance is dramatically lower than the reference.
    const v = defined.length >= 2 ? variance(defined) : 0;
    if (!tempAvailable[w] && refVarMean > 0 && v < refVarMean * 0.05) {
      reasons[w] = "pressione costante (sensore non rappresentativo)";
      continue;
    }
    sensorAvailable[w] = true;
  }
  return { sensorAvailable, reasons };
}

function toSeries(
  raw: Record<WheelKey, RawSeries>,
  validLaps: LapRow[],
  sensorAvailable: WheelAvailability,
  reasons: Partial<Record<WheelKey, string>>,
): TyreEvolutionSeries {
  const channelsFound: WheelAvailability = {
    fl: raw.fl.channelFound,
    fr: raw.fr.channelFound,
    rl: raw.rl.channelFound,
    rr: raw.rr.channelFound,
  };
  const anyChannel = WHEELS.some((w) => channelsFound[w]);
  const perLap: TyreLapPoint[] = validLaps.map((lap, i) => {
    const row: TyreLapPoint = { lap: lap.lap };
    for (const w of WHEELS) {
      if (sensorAvailable[w]) row[w] = raw[w].perLap[i];
    }
    return row;
  });
  return {
    available: anyChannel,
    channelsFound,
    sensorAvailable,
    unavailableReason: reasons,
    perLap,
  };
}

function buildSummary(
  temp: TyreEvolutionSeries,
  press: TyreEvolutionSeries,
): TyreEvolutionSummary {
  void press;
  const summary: TyreEvolutionSummary = { totalTempDelta: {} };
  const pts = temp.perLap;
  if (pts.length === 0) return summary;

  // Per-wheel total delta (first defined → last defined)
  for (const w of WHEELS) {
    if (!temp.sensorAvailable[w]) continue;
    const defined = pts
      .map((p) => p[w])
      .filter((v): v is number => v !== undefined);
    if (defined.length >= 2) {
      summary.totalTempDelta[w] = defined[defined.length - 1] - defined[0];
    }
  }

  // Warm-up: average across available wheels, count initial laps where avg keeps rising
  // (then stabilises within ±0.5°C/lap).
  const avgPerLap = pts.map((p) => {
    const vals = WHEELS
      .filter((w) => temp.sensorAvailable[w])
      .map((w) => p[w])
      .filter((v): v is number => v !== undefined);
    return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : undefined;
  });
  if (avgPerLap.length >= 2 && avgPerLap[0] !== undefined) {
    let warmup = 0;
    for (let i = 1; i < avgPerLap.length; i++) {
      const prev = avgPerLap[i - 1];
      const cur = avgPerLap[i];
      if (prev === undefined || cur === undefined) break;
      if (cur - prev > 0.5) warmup = i;
      else break;
    }
    if (warmup > 0) summary.warmupLaps = warmup;
  }

  // Axle & side deltas across valid laps (using only available wheels)
  const axleDeltas: number[] = [];
  const sideDeltas: number[] = [];
  for (const p of pts) {
    const front: number[] = [];
    const rear: number[] = [];
    const left: number[] = [];
    const right: number[] = [];
    if (temp.sensorAvailable.fl && p.fl !== undefined) { front.push(p.fl); left.push(p.fl); }
    if (temp.sensorAvailable.fr && p.fr !== undefined) { front.push(p.fr); right.push(p.fr); }
    if (temp.sensorAvailable.rl && p.rl !== undefined) { rear.push(p.rl); left.push(p.rl); }
    if (temp.sensorAvailable.rr && p.rr !== undefined) { rear.push(p.rr); right.push(p.rr); }
    if (front.length > 0 && rear.length > 0) {
      axleDeltas.push(
        front.reduce((a, b) => a + b, 0) / front.length -
          rear.reduce((a, b) => a + b, 0) / rear.length,
      );
    }
    if (left.length > 0 && right.length > 0) {
      sideDeltas.push(
        left.reduce((a, b) => a + b, 0) / left.length -
          right.reduce((a, b) => a + b, 0) / right.length,
      );
    }
  }
  summary.axleDeltaAvg = mean(axleDeltas);
  summary.sideDeltaAvg = mean(sideDeltas);
  return summary;
}

export function buildTyreEvolution(file: LdFile, lapRows: LapRow[]): TyreEvolution {
  const ch = file.channels;
  const validLaps = lapRows.filter((l) => l.isValidLap);

  const tempRaw = buildRawSeries(ch, "tpms temp", validLaps);
  const pressRaw = buildRawSeries(ch, "tpms press", validLaps);

  const hasTpms = WHEELS.some(
    (w) => tempRaw[w].channelFound || pressRaw[w].channelFound,
  );

  const tempAssess = assessTemp(tempRaw);
  const pressAssess = assessPress(pressRaw, tempAssess.sensorAvailable);

  const temp = toSeries(tempRaw, validLaps, tempAssess.sensorAvailable, tempAssess.reasons);
  const press = toSeries(pressRaw, validLaps, pressAssess.sensorAvailable, pressAssess.reasons);

  return {
    hasTpms,
    temp,
    press,
    summary: buildSummary(temp, press),
  };
}
