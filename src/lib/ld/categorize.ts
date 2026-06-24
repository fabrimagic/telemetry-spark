import type { ChannelCategory } from "./types";

export function categorize(rawName: string): ChannelCategory {
  const n = rawName.trim().toLowerCase();
  if (n.startsWith("ecu ")) return "Motore";
  if (
    n.includes("brake") ||
    n.includes("pbrake") ||
    n.includes("caliper") ||
    n.includes("brkdisc") ||
    n.startsWith("abs")
  )
    return "Freni";
  if (n.startsWith("tpms")) return "Gomme";
  if (
    n.startsWith("susp") ||
    n.startsWith("rideheight") ||
    n.startsWith("arb") ||
    n.startsWith("dms")
  )
    return "Sospensioni";
  if (
    n.startsWith("imu") ||
    n.startsWith("sclu") ||
    n.includes("yaw") ||
    n.includes(" acc")
  )
    return "Dinamica";
  if (n.startsWith("gps")) return "GPS";
  if (n.startsWith("lap") || n.includes("lap time")) return "Giro";
  if (n.startsWith("can") || n.startsWith("pcu") || n.startsWith("stw"))
    return "Elettronica";
  if (n.startsWith("pth") || n.includes("air") || n.includes("cockpit"))
    return "Ambiente";
  return "Altro";
}
