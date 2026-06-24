import type { ChannelCategory } from "@/lib/ld/types";

export interface ToolsetPart {
  name: string;
  size: number;
  compressedSize: number;
  method: number;
  methodLabel: string;
  extracted: boolean;
  reason?: string;
}

export interface ToolsetCanBus {
  id: number;
  label: string;
}


export interface ToolsetChannelEntry {
  name: string;
  description?: string;
  category: ChannelCategory;
}

export interface ToolsetContentType {
  key: string;
  contentType: string;
}

/** Display/alarm metadata for a single channel, decoded from a <dash:Channel> XAML block. */
export interface ToolsetDisplayMeta {
  sourceName: string;
  category: ChannelCategory;
  quantity?: string;
  userUnit?: string;
  decimalPlaces?: number;
  minimum?: number;
  maximum?: number;
  alarmMinimum?: number;
  alarmMaximum?: number;
  alarmEnabled?: boolean;
  /** True when (min, max) is something other than the default 0..1000 placeholder. */
  hasSignificantRange: boolean;
}

/** Physical I/O sensor wiring: human description + hardware port + internal name. */
export interface ToolsetIoSensor {
  name: string;
  description: string;
  port: string; // "Input 03" / "Digital 01"
  category: ChannelCategory;
}

export interface ToolsetFile {
  fileName: string;
  byteLength: number;
  parts: ToolsetPart[];
  contentTypes: ToolsetContentType[];
  deviceHint?: string;
  canBuses: ToolsetCanBus[];
  channels: ToolsetChannelEntry[];
  /** Display/alarm metadata per unique SourceName (last-wins). */
  displayMeta: ToolsetDisplayMeta[];
  /** Total number of <dash:Channel> blocks found (may exceed unique SourceNames). */
  dashChannelBlocks: number;
  /** Physical I/O sensors wired through Input/Digital ports. */
  ioSensors: ToolsetIoSensor[];
  /** Raw textual calibration hints (gain, mV/G, mV per bar, etc.). */
  calibrationHints: string[];
  alarms: string[];
  versions: string[];
  notExtracted: string[];
  setupStringCount: number;
  setupBinaryPresent: boolean;
}

export type ToolsetWorkerMessage =
  | { type: "progress"; pct: number; stage: string }
  | { type: "result"; file: ToolsetFile }
  | { type: "error"; message: string };
