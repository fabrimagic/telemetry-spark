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

export interface OverrideResult {
  factor: number; // multiply value by this after base formula
  badges: ChannelBadge[];
}

export function getOverride(rawName: string, mult: number): OverrideResult {
  const name = rawName.trim().toLowerCase();
  const badges: ChannelBadge[] = [];
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

  return { factor, badges };
}
