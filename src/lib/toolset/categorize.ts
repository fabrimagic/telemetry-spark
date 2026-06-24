import type { ChannelCategory } from "@/lib/ld/types";

/**
 * Categorize a toolset configuration channel name. More tolerant than the
 * .ld categorize() because toolset names usually have prefixes like `log_`,
 * `cfg_`, `tpms_`, `ecu_`, etc.
 */
export function categorizeToolset(rawName: string): ChannelCategory {
  let n = rawName.trim().toLowerCase();
  // Strip a single leading "namespace_" prefix to expose the inner keyword.
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
    n.includes("spring")
  )
    return "Sospensioni";
  if (
    n.startsWith("imu") ||
    n.startsWith("sclu") ||
    n.includes("yaw") ||
    n.includes("gyro") ||
    n.includes(" acc") ||
    n.includes("accel")
  )
    return "Dinamica";
  if (n.startsWith("gps") || n.includes("latitude") || n.includes("longitude")) return "GPS";
  if (n.startsWith("lap") || n.includes("laptime")) return "Giro";
  if (n.startsWith("ecu") || n.includes("rpm") || n.includes("nmot") || n.includes("engine"))
    return "Motore";
  if (
    n.startsWith("can") ||
    n.startsWith("pcu") ||
    n.startsWith("stw") ||
    n.includes("voltage") ||
    n.includes("current")
  )
    return "Elettronica";
  if (n.includes("air") || n.includes("cockpit") || n.includes("ambient") || n.includes("temp"))
    return "Ambiente";
  return "Altro";
}
