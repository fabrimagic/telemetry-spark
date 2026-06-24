import type { ChannelCategory } from "@/lib/ld/types";

/**
 * Categorize a toolset configuration channel name. Tolerant of toolset
 * conventions (log_, cfg_, set_ prefixes) and keyword-based matching.
 */
export function categorizeToolset(rawName: string): ChannelCategory {
  let n = rawName.trim().toLowerCase();
  n = n.replace(/^(log|cfg|set|raw|calc)_/, "");

  if (n.startsWith("tpms") || n.includes("tyre") || n.includes("tire")) return "Gomme";
  if (
    n.includes("brake") ||
    n.includes("brk") ||
    n.includes("caliper") ||
    n.startsWith("abs") ||
    n.includes("pbrake")
  )
    return "Freni";
  if (
    n.startsWith("ride") ||
    n.startsWith("susp") ||
    n.startsWith("arb") ||
    n.startsWith("dms") ||
    n.includes("damper") ||
    n.includes("spring") ||
    n.includes("rideheight")
  )
    return "Sospensioni";
  if (
    n.startsWith("imu") ||
    n.startsWith("sclu") ||
    n.includes("yaw") ||
    n.includes("gyro") ||
    n.includes(" acc") ||
    n.includes("accel") ||
    n.includes("roll") ||
    n.includes("pitch")
  )
    return "Dinamica";
  if (n.startsWith("gps") || n.includes("latitude") || n.includes("longitude")) return "GPS";
  if (n.startsWith("lap") || n.includes("laptime") || n.includes("beacon") || n.includes("loop"))
    return "Giro";
  if (n.startsWith("ecu") || n.includes("rpm") || n.includes("nmot") || n.includes("engine"))
    return "Motore";
  if (n.includes("fuel")) return "Altro"; // no Carburante in existing enum — keep "Altro" but tag-friendly
  if (n.includes("light")) return "Altro";
  if (
    n.startsWith("stw") ||
    n.startsWith("fuse") ||
    n.startsWith("flexray") ||
    n.startsWith("can") ||
    n.startsWith("pcu") ||
    n.startsWith("ccu") ||
    n.includes("voltage") ||
    n.includes("current")
  )
    return "Elettronica";
  if (
    n.startsWith("pth") ||
    n.includes("cockpit") ||
    n.includes("evap") ||
    n.includes("ambient") ||
    n.includes("air") ||
    n.includes("temp")
  )
    return "Ambiente";
  return "Altro";
}
