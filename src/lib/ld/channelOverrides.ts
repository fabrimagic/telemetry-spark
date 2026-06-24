// Special channel conversions applied AFTER base formula.
// We never invent factors: "verify" channels keep the base value.

import type { ChannelBadge } from "./types";

const DIVIDE_BY: Record<string, number> = {
  rpm: 2.778,
  "ecu nmot": 2.778,
};

const VERIFY_NAMES = new Set([
  "gps speed",
  "sclu yaw rate",
  "imu gyrox",
  "imu gyroy",
  "imu gyroz",
  "sclu fa yaw rate",
  "sclu fa roll rate",
  "sclu fa pitch rate",
  "sclu ra yaw rate",
  "sclu ra roll rate",
  "sclu ra pitch rate",
]);

/** Static verify notes for GPS channels with known scaling/sentinel issues. */
const GPS_VERIFY_NOTES: Record<string, string> = {
  "gps latitude":
    "valori fuori range gradi (±90°), codifica raw da verificare; confrontare con log gps lat già in gradi",
  "gps longitude":
    "valori fuori range gradi (±180°), codifica raw da verificare; confrontare con log gps lon già in gradi",
  "gps altitude":
    "sospetto overflow int16 sentinella (±32768)",
};

/** Channels eligible for the dynamic "stuck on multiples of 2.778" runtime check. */
export const SCLU_RATE_CHANNELS = new Set([
  "sclu yaw rate",
  "sclu pitch rate",
  "sclu roll rate",
  "sclu fa pitch rate",
  "sclu fa roll rate",
  "sclu fa yaw rate",
  "sclu ra pitch rate",
  "sclu ra roll rate",
  "sclu ra yaw rate",
]);

export interface OverrideResult {
  factor: number; // multiply value by this after base formula
  badges: ChannelBadge[];
  notes: string[];
}

export function getOverride(rawName: string, mult: number): OverrideResult {
  const name = rawName.trim().toLowerCase();
  const badges: ChannelBadge[] = [];
  const notes: string[] = [];
  let factor = 1;

  if (DIVIDE_BY[name] !== undefined) {
    factor = 1 / DIVIDE_BY[name];
    badges.push("special");
  }

  // Rate channels with mult==36 are uncalibrated → flag, don't fudge.
  if (mult === 36 && VERIFY_NAMES.has(name)) {
    badges.push("verify");
  }
  if (name === "gps speed") {
    badges.push("verify");
  }

  if (GPS_VERIFY_NOTES[name]) {
    if (!badges.includes("verify")) badges.push("verify");
    notes.push(GPS_VERIFY_NOTES[name]);
  }

  return { factor, badges, notes };
}

/**
 * Runtime-only check for SCLU rate channels: returns true when the decoded
 * values appear stuck on a small set of discrete levels coincident with
 * multiples of 2.778 (within tolerance). Pure data heuristic — never call
 * for non-SCLU-rate channels (see SCLU_RATE_CHANNELS).
 */
export function isStuckOnMultiplesOf2778(values: Float32Array): boolean {
  if (values.length === 0) return false;
  const STEP = 2.778;
  const TOL = 0.15; // absolute tolerance around each multiple
  const MAX_DISTINCT = 8;
  const buckets = new Set<number>();
  let checked = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (!Number.isFinite(v)) continue;
    checked++;
    const k = Math.round(v / STEP);
    if (Math.abs(v - k * STEP) > TOL) return false;
    buckets.add(k);
    if (buckets.size > MAX_DISTINCT) return false;
  }
  return checked > 0 && buckets.size > 0 && buckets.size <= MAX_DISTINCT;
}
