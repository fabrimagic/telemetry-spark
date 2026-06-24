import type { ChannelCategory } from "@/lib/ld/types";

/** A single part inside the OPC (zip) container. */
export interface ToolsetPart {
  name: string;
  /** Uncompressed size in bytes, from central directory. */
  size: number;
  compressedSize: number;
  /** Standard ZIP compression method id (0 = STORE, 8 = DEFLATE, 14 = LZMA, …). */
  method: number;
  methodLabel: string;
  /** True if we were able to read its contents in-browser. */
  extracted: boolean;
  /** Human-readable reason when not extracted. */
  reason?: string;
}

export interface ToolsetCanBus {
  /** Bus number as found in the binary (e.g. 1..8). */
  id: number;
  /** Domain label (e.g. "Antrieb", "Chassis"). May be empty when only "CAN N" appears. */
  label: string;
  /** Channels heuristically associated to this bus via substring match. */
  channelCount: number;
}

export interface ToolsetChannelEntry {
  name: string;
  description?: string;
  category: ChannelCategory;
}

export interface ToolsetContentType {
  /** A part name or extension defined in [Content_Types].xml. */
  key: string;
  contentType: string;
}

export interface ToolsetFile {
  fileName: string;
  byteLength: number;
  /** All parts found in the OPC central directory. */
  parts: ToolsetPart[];
  /** Entries parsed from [Content_Types].xml. Empty when the file is missing/unparseable. */
  contentTypes: ToolsetContentType[];
  /** Best-effort device hint string (e.g. "Porsche", "Badenia") found in setup.binary. */
  deviceHint?: string;
  /** Discovered CAN buses, sorted by id. */
  canBuses: ToolsetCanBus[];
  /** Discovered configuration channels (name + optional description). Deduplicated by name. */
  channels: ToolsetChannelEntry[];
  /** Alarm / diagnostic strings found in setup.binary (deduplicated). */
  alarms: string[];
  /** Hardware / Software / Firmware version strings. */
  versions: string[];
  /** Human-readable list of things present in the package but not decoded. */
  notExtracted: string[];
  /** Total readable strings found in setup.binary (diagnostic counter). */
  setupStringCount: number;
  /** True when setup.binary was present and readable. */
  setupBinaryPresent: boolean;
}

export type ToolsetWorkerMessage =
  | { type: "progress"; pct: number; stage: string }
  | { type: "result"; file: ToolsetFile }
  | { type: "error"; message: string };
