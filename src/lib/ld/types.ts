// MoTeC .ld telemetry types — see plan/spec for binary layout.

export type ChannelBadge = "special" | "verify";

export interface Channel {
  /** Index in original descriptor list. */
  idx: number;
  name: string;
  unit: string;
  freq: number;
  nSamples: number;
  /** Raw decoded numeric type byte-size from header (2 or 4). */
  size: number;
  /** Raw firmware fields, kept for debugging / table. */
  shift: number;
  mult: number;
  scale: number;
  dec: number;
  /** Converted physical values in a Float32Array (length === nSamples). */
  values: Float32Array;
  /** Per-channel min/max/avg cached (NaN-safe; empty channel => NaN). */
  min: number;
  max: number;
  avg: number;
  /** Badges to render in UI. */
  badges: ChannelBadge[];
  /** Free-text notes shown in tooltip (verify reasons, dynamic warnings). */
  notes: string[];
  category: ChannelCategory;
  /** Whether this channel is empty (nSamples 0). */
  empty: boolean;

}

export type ChannelCategory =
  | "Motore"
  | "Freni"
  | "Gomme"
  | "Sospensioni"
  | "Dinamica"
  | "GPS"
  | "Giro"
  | "Elettronica"
  | "Ambiente"
  | "Altro";

export interface SessionMeta {
  device: string;
  date: string;
  time: string;
  car?: string;
  track?: string;
  totalLaps?: number;
  fastestLap?: number;
  fastestTime?: string;
}

export interface Lap {
  /** Session-visible progressive index (1..N), aligned with .ldx numbering. */
  index: number;
  /** Lap time in seconds (derived from samples). */
  duration: number;
  /** Start sample time (seconds since file start, on a 1Hz-ish global axis). */
  tStart: number;
  tEnd: number;
  /** Absolute car-side counter from the "Lap Number" channel (debug/reference). */
  absoluteIndex?: number;
}

export interface LdFile {
  fileName: string;
  meta: SessionMeta;
  channels: Channel[];
  laps: Lap[];
  /** Bytes parsed. */
  byteLength: number;
}

export interface ParseProgress {
  type: "progress";
  pct: number;
  stage: string;
}

export interface ParseResult {
  type: "result";
  file: LdFile;
}

export interface ParseError {
  type: "error";
  message: string;
}

export type WorkerMessage = ParseProgress | ParseResult | ParseError;
